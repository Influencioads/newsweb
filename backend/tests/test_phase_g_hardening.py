"""Phase G hardening tests — §27 rate limiting and §10.1 publish cache purge."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

import app.core.ratelimit as ratelimit  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import seed_districts, seed_mandals, seed_permissions, seed_roles, seed_states  # noqa: E402
from app.db.seed_content import seed_categories  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.enums import ArticleStatus, RoleKey, ScopeType, UserStatus, WorkflowState  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    permissions = seed_permissions(session)
    seed_roles(session, permissions)
    seed_states(session)
    districts = seed_districts(session)
    seed_mandals(session, districts)
    seed_categories(session)
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


@pytest.fixture()
def counting_limiter(monkeypatch: pytest.MonkeyPatch) -> dict[str, int]:
    """Replace the Redis counter with an in-memory one so limits actually bite
    in tests (Redis is down here, and the real counter fails open by design)."""
    counts: dict[str, int] = {}

    def fake_incr(key: str, _ttl: int) -> int:
        counts[key] = counts.get(key, 0) + 1
        return counts[key]

    monkeypatch.setattr(ratelimit, "incr_with_ttl", fake_incr)
    return counts


def make_published(db: Session, title: str) -> Article:
    article = Article(
        short_id=f"g{abs(hash(title)) % 99999:05d}",
        slug="hardening",
        title_te=title,
        status=ArticleStatus.PUBLISHED,
        workflow_state=WorkflowState.PUBLISHED,
        published_at=utcnow(),
    )
    db.add(article)
    db.commit()
    return article


class TestRateLimiting:
    def test_beacon_limited_per_client(
        self, client: TestClient, db: Session, counting_limiter: dict[str, int]
    ) -> None:
        article = make_published(db, "బీకన్ పరిమితి పరీక్ష")
        payload = {"anon_id": "rl-test", "events": [{"short_id": article.short_id, "type": "view"}]}
        for i in range(30):
            assert client.post("/api/v1/public/events", json=payload).status_code == 202, i
        blocked = client.post("/api/v1/public/events", json=payload)
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "RATE_LIMITED"

    def test_comment_limit_is_per_user(
        self, client: TestClient, db: Session, counting_limiter: dict[str, int]
    ) -> None:
        article = make_published(db, "వ్యాఖ్య పరిమితి పరీక్ష")
        otp = client.post("/api/v1/auth/otp/request", json={"phone": "9848060001"}).json()["dev_otp"]
        token = client.post(
            "/api/v1/auth/reader/otp/verify", json={"phone": "9848060001", "otp": otp}
        ).json()["tokens"]["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        for i in range(6):
            r = client.post(
                f"/api/v1/articles/{article.short_id}/comments",
                json={"body": f"వ్యాఖ్య సంఖ్య {i}"},
                headers=headers,
            )
            assert r.status_code == 201, r.text
        blocked = client.post(
            f"/api/v1/articles/{article.short_id}/comments",
            json={"body": "ఏడవ వ్యాఖ్య"},
            headers=headers,
        )
        assert blocked.status_code == 429
        # The key was the user id, not the IP — different limits per person.
        assert any(key.startswith("rl:comment:u:") for key in counting_limiter)

    def test_redis_outage_fails_open(self, client: TestClient, db: Session) -> None:
        """Without the patched counter the real one returns 0 (Redis is down in
        tests) — reader writes must keep working through a cache outage."""
        article = make_published(db, "విఫల-తెరుచు పరీక్ష")
        payload = {"anon_id": "outage", "events": [{"short_id": article.short_id, "type": "view"}]}
        for _ in range(35):
            assert client.post("/api/v1/public/events", json=payload).status_code == 202


class TestPublishCachePurge:
    def test_publish_purges_reader_caches(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        purged: list[str] = []
        monkeypatch.setattr(
            "app.core.redis_client.cache_delete_prefix", lambda prefix: purged.append(prefix) or 0
        )

        author = User(email="g-author@test.example.com", name_te="రచయిత", name_en="Author",
                      status=UserStatus.ACTIVE)
        editor = User(email="g-editor@test.example.com", name_te="ఎడిటర్", name_en="Editor",
                      status=UserStatus.ACTIVE)
        db.add_all([author, editor])
        db.flush()
        role = db.execute(select(Role).where(Role.key == RoleKey.DESK_EDITOR.value)).scalar_one()
        db.add(UserRole(user_id=editor.id, role_id=role.id, scope_type=ScopeType.GLOBAL))
        article = Article(
            short_id="gpurge", slug="purge-test", title_te="పర్జ్ పరీక్ష కథనం",
            status=ArticleStatus.PENDING, workflow_state=WorkflowState.APPROVED,
            author_id=author.id, approved_by=editor.id,
        )
        db.add(article)
        db.commit()
        db.refresh(editor)
        _s, access, _r, _e = auth_service.create_session(db, editor)
        db.commit()

        r = client.post(
            f"/api/v1/cms/articles/{article.id}/publish",
            json={"note": None},
            headers={"Authorization": f"Bearer {access}"},
        )
        assert r.status_code == 200, r.text
        assert "home:" in purged and "breaking" in purged and "trending:" in purged, \
            "§10.1: publishing must purge the reader caches, not wait out the TTL"
