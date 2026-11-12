"""Sign in with Google, and admins switching staff access off and on.

Same harness as test_site_content: in-memory SQLite with the real seed, the
FastAPI app with `get_db` overridden. Google's token endpoint is faked.
"""

from __future__ import annotations

import os
import time
from collections.abc import Iterator
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.seed import seed_homepage_sections, seed_permissions, seed_roles  # noqa: E402
from app.db.seed_content import seed_categories  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.enums import RoleKey, ScopeType, UserStatus  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service  # noqa: E402
from app.services import google_auth_service as google  # noqa: E402

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
CLIENT_ID = "test-client.apps.googleusercontent.com"


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    seed_roles(session, seed_permissions(session))
    seed_homepage_sections(session, seed_categories(session))
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


@pytest.fixture(scope="module")
def client(db: Session) -> Iterator[TestClient]:
    def _get_db() -> Iterator[Session]:
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def google_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID)
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "secret")
    monkeypatch.setattr(settings, "PASSWORD_LOGIN_ENABLED", False)


def _staff(db: Session, email: str, role: RoleKey) -> User:
    user = User(email=email, name_te="స్టాఫ్", name_en="Staff", status=UserStatus.ACTIVE)
    db.add(user)
    db.flush()
    role_row = db.scalar(select(Role).where(Role.key == role.value))
    db.add(UserRole(user_id=user.id, role_id=role_row.id, scope_type=ScopeType.GLOBAL, scope_id=None))
    db.commit()
    db.refresh(user)
    return user


def _bearer(db: Session, user: User) -> dict[str, str]:
    _, access, _, _ = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}


def _google_says(monkeypatch: pytest.MonkeyPatch, email: str, **extra: object) -> None:
    """Fake Google's token endpoint, echoing the nonce the flow sent."""

    class Reply:
        status_code = 200
        text = ""

        def __init__(self, token: str) -> None:
            self._token = token

        def json(self) -> dict:
            return {"id_token": self._token}

    def fake_post(url: str, data: dict, timeout: int) -> Reply:
        claims = {
            "iss": "https://accounts.google.com", "aud": CLIENT_ID, "exp": int(time.time()) + 300,
            "email": email, "email_verified": True, "name": "Google Person", "nonce": fake_post.nonce,
            **extra,
        }
        return Reply(jwt.encode(claims, "x", algorithm="HS256"))

    fake_post.nonce = ""
    monkeypatch.setattr(google.httpx, "post", fake_post)
    return fake_post


def _sign_in(client: TestClient, monkeypatch: pytest.MonkeyPatch, email: str, target: str, **extra: object) -> dict:
    """Run start -> callback -> exchange; return the final redirect's query (and tokens)."""
    fake = _google_says(monkeypatch, email, **extra)
    start = client.get(f"/api/v1/auth/google/start?target={target}&next=/admin/articles", follow_redirects=False)
    assert start.status_code == 302 and start.headers["location"].startswith(google.AUTH_URL)
    q = parse_qs(urlparse(start.headers["location"]).query)
    fake.nonce = q["nonce"][0]
    back = client.get(f"/api/v1/auth/google/callback?code=abc&state={q['state'][0]}", follow_redirects=False)
    assert back.status_code == 302
    out = {k: v[0] for k, v in parse_qs(urlparse(back.headers["location"]).query).items()}
    out["_location"] = back.headers["location"]
    if "ticket" in out:
        r = client.post("/api/v1/auth/google/exchange", json={"ticket": out["ticket"]})
        out["_exchange"] = r
    return out


class TestGoogleSignIn:
    def test_staff_signs_in_to_the_cms(self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        _staff(db, "editor@example.com", RoleKey.DESK_EDITOR)
        out = _sign_in(client, monkeypatch, "Editor@Example.com", "cms")
        assert out["_location"].startswith(f"{settings.APP_URL}/auth/google/done")
        assert out["next"] == "/admin/articles"
        r = out["_exchange"]
        assert r.status_code == 200, r.text
        assert r.json()["me"]["user"]["email"] == "editor@example.com"
        # A ticket works once.
        again = client.post("/api/v1/auth/google/exchange", json={"ticket": out["ticket"]})
        assert again.status_code == 400

    def test_unknown_address_is_not_let_into_the_cms(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        out = _sign_in(client, monkeypatch, "stranger@example.com", "cms")
        assert out.get("error") == "not_staff" and "ticket" not in out

    def test_reader_gets_an_account_on_first_sign_in(self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        out = _sign_in(client, monkeypatch, "reader@example.com", "app")
        assert out["_location"].startswith("wowindian://auth?")
        r = out["_exchange"]
        assert r.status_code == 200 and r.json()["is_new_account"] is True
        user = db.scalar(select(User).where(User.email == "reader@example.com"))
        assert [ur.role.key for ur in user.roles] == [RoleKey.SUBSCRIBER.value]
        # ...and a reader still cannot use it to reach the CMS.
        assert _sign_in(client, monkeypatch, "reader@example.com", "cms").get("error") == "not_staff"

    def test_unverified_email_and_disabled_accounts_are_refused(self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        assert _sign_in(client, monkeypatch, "x@example.com", "web", email_verified=False)["error"] == "email_not_verified"
        off = _staff(db, "off@example.com", RoleKey.REPORTER)
        off.status = UserStatus.DISABLED
        db.commit()
        assert _sign_in(client, monkeypatch, "off@example.com", "cms")["error"] == "account_disabled"

    def test_a_forged_state_or_missing_cookie_fails(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        _google_says(monkeypatch, "editor@example.com")
        r = client.get("/api/v1/auth/google/callback?code=abc&state=forged", follow_redirects=False)
        assert "error=expired" in r.headers["location"]

    def test_passwords_and_otp_are_closed(self, client: TestClient) -> None:
        r = client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "whatever123"})
        assert r.status_code == 403 and r.json()["error"]["code"] == "USE_GOOGLE_SIGN_IN"
        assert client.post("/api/v1/auth/otp/request", json={"phone": "9876543210"}).status_code == 403
        cfg = client.get("/api/v1/public/config").json()["auth"]
        assert cfg == {"google": True, "password": False}

    def test_passwords_stay_on_until_google_is_set_up(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "")
        r = client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "whatever123"})
        assert r.status_code != 403


class TestStaffAccess:
    def test_admin_adds_switches_off_and_removes_staff(self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        boss = _staff(db, "boss@example.com", RoleKey.SUPER_ADMIN)
        h = _bearer(db, boss)

        r = client.post("/api/v1/cms/users", json={"email": "New@Example.com", "name": "కొత్త", "role": "reporter"}, headers=h)
        assert r.status_code == 201, r.text
        new_id = r.json()["id"]
        assert client.post("/api/v1/cms/users", json={"email": "new@example.com", "name": "x", "role": "reporter"}, headers=h).status_code == 409
        assert client.post("/api/v1/cms/users", json={"email": "r@example.com", "name": "x", "role": "subscriber"}, headers=h).status_code == 422
        # The new person can now sign in with Google.
        assert _sign_in(client, monkeypatch, "new@example.com", "cms")["_exchange"].status_code == 200

        r = client.patch(f"/api/v1/cms/users/{new_id}", json={"status": "disabled"}, headers=h)
        assert r.status_code == 200 and r.json()["status"].lower() == "disabled"
        assert _sign_in(client, monkeypatch, "new@example.com", "cms")["error"] == "account_disabled"
        assert client.patch(f"/api/v1/cms/users/{new_id}", json={"status": "active"}, headers=h).status_code == 200

        assert client.delete(f"/api/v1/cms/users/{new_id}", headers=h).json() == {"removed": True}
        assert _sign_in(client, monkeypatch, "new@example.com", "cms")["error"] == "not_staff"

        staff = client.get("/api/v1/cms/users?kind=staff", headers=h).json()["items"]
        assert all(any(r["key"] != "subscriber" for r in u["roles"]) for u in staff)

    def test_no_one_can_lock_themselves_or_the_last_super_admin_out(self, client: TestClient, db: Session) -> None:
        boss = db.scalar(select(User).where(User.email == "boss@example.com"))
        h = _bearer(db, boss)
        assert client.patch(f"/api/v1/cms/users/{boss.id}", json={"status": "disabled"}, headers=h).status_code == 422
        assert client.delete(f"/api/v1/cms/users/{boss.id}", headers=h).status_code == 422

    def test_only_admins_manage_access(self, client: TestClient, db: Session) -> None:
        reporter = _staff(db, "rep2@example.com", RoleKey.REPORTER)
        h = _bearer(db, reporter)
        assert client.post("/api/v1/cms/users", json={"email": "z@example.com", "name": "z", "role": "reporter"}, headers=h).status_code == 403
