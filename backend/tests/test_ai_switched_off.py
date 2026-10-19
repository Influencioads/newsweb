"""WowIndian: AI, crawling, rewriting and voice start switched off.

Every feature is present and has an on/off switch in CMS → Settings; each of
those starts off (`test_every_switch_starts_off`). Above them sits the
deployment kill switch `AI_ENABLED`. The tests below it turn that off and
check what it does:

* every automated-content setting reads False, whatever the database holds,
  and the settings screen refuses to switch one on;
* the routes that run those features answer 403 AI_FEATURES_DISABLED;
* the Celery schedule drops their jobs;
* the newsroom's own work — articles, taxonomy, the reader site — is untouched.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core import config  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_homepage_sections,
    seed_mandals,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.enums import RoleKey, ScopeType, UserStatus  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service, settings_service  # noqa: E402
from app.workers import celery_app  # noqa: E402

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
    categories = seed_categories(session)
    seed_homepage_sections(session, categories)
    seed_tags(session)
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
def _clean_settings_cache() -> Iterator[None]:
    """The settings cache is process-global and 30 s long — a test that writes a
    setting would otherwise leak into the next one."""
    settings_service.invalidate()
    yield
    settings_service.invalidate()


def staff_headers(db: Session, *, role: RoleKey, email: str,
                  district_id: int | None = None) -> dict[str, str]:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        role_row = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
        user = User(email=email, name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE)
        db.add(user)
        db.flush()
        db.add(UserRole(
            user_id=user.id, role_id=role_row.id,
            scope_type=ScopeType.DISTRICT if district_id else ScopeType.GLOBAL,
            scope_id=district_id,
        ))
        db.flush()
    db.refresh(user)
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}


@pytest.fixture(autouse=True)
def _ai_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config.settings, "AI_ENABLED", False)


def _admin(db: Session) -> dict[str, str]:
    return staff_headers(db, role=RoleKey.ADMIN, email="wow-admin@test.example.com")


def test_the_kill_switch_defaults_to_letting_settings_decide(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AI_ENABLED", raising=False)
    assert config.Settings(_env_file=None).AI_ENABLED is True


SETTINGS_SWITCHES = (
    "ai.enabled", "ai.auto_suggest", "ai.image_enabled", "ai.research_enabled",
    "crawl.enabled", "crawl.rewrite_enabled", "crawl.html_fallback_enabled",
    "crawl.open_licence_images",
    "voice.enabled", "voice.article_tts_enabled", "voice.auto_generate_on_publish",
    "voice.backfill_enabled",
    "bulletin.enabled", "bulletin.ai_script_enabled", "epaper.audio_enabled",
)


def test_every_switch_starts_off(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """A fresh WowIndian: the switches are on the settings screen, all off,
    and an admin can turn one on and back off."""
    monkeypatch.setattr(config.settings, "AI_ENABLED", True)
    for key in SETTINGS_SWITCHES:
        assert settings_service.SPECS[key].default is False, key

    admin = _admin(db)
    body = client.get("/api/v1/cms/settings", headers=admin).json()
    specs = {s["key"]: s for s in body["specs"]}
    for key in SETTINGS_SWITCHES:
        assert body["values"][key] is False, key
        assert specs[key]["locked"] is False, key

    r = client.patch("/api/v1/cms/settings", json={"values": {"crawl.enabled": True}}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["values"]["crawl.enabled"] is True
    r = client.patch("/api/v1/cms/settings", json={"values": {"crawl.enabled": False}}, headers=admin)
    assert r.json()["values"]["crawl.enabled"] is False


def test_a_stored_on_value_still_reads_off(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    # Written while the features were on — an old database carried across.
    monkeypatch.setattr(config.settings, "AI_ENABLED", True)
    settings_service.set_many(
        db, {"crawl.enabled": True, "voice.enabled": True, "ai.enabled": True}, None
    )
    db.commit()
    monkeypatch.setattr(config.settings, "AI_ENABLED", False)
    settings_service.invalidate()

    for key in ("crawl.enabled", "crawl.rewrite_enabled", "voice.enabled", "ai.enabled",
                "ai.auto_suggest", "bulletin.enabled", "epaper.audio_enabled"):
        assert settings_service.get_bool(db, key) is False, key
        assert settings_service.all_settings(db)[key] is False, key
    assert settings_service.ai_enabled(db) is False
    assert settings_service.voice_enabled(db) is False
    # Not a blanket "everything off": the newsroom's own switches keep their values.
    assert settings_service.get_bool(db, "epaper.enabled") is True
    assert settings_service.get_bool(db, "polls.enabled") is True


def test_the_settings_screen_cannot_switch_one_on(client: TestClient, db: Session) -> None:
    admin = _admin(db)
    for key in ("ai.enabled", "crawl.enabled", "crawl.rewrite_enabled", "voice.enabled",
                "bulletin.enabled", "epaper.audio_enabled"):
        r = client.patch("/api/v1/cms/settings", json={"values": {key: True}}, headers=admin)
        assert r.status_code == 422, (key, r.text)
        assert key in r.json()["error"]["details"]["keys"]

    # Ordinary settings still save.
    r = client.patch("/api/v1/cms/settings", json={"values": {"polls.enabled": False}}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["values"]["polls.enabled"] is False
    client.patch("/api/v1/cms/settings", json={"values": {"polls.enabled": True}}, headers=admin)

    specs = {s["key"]: s for s in client.get("/api/v1/cms/settings", headers=admin).json()["specs"]}
    assert specs["crawl.enabled"]["locked"] is True
    assert specs["polls.enabled"]["locked"] is False


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/v1/cms/ai/suggestions"),
        ("post", "/api/v1/cms/ai/suggestions/generate"),
        ("get", "/api/v1/cms/ai/drafts"),
        ("post", "/api/v1/cms/ai/assist"),
        ("get", "/api/v1/cms/sources"),
        ("post", "/api/v1/cms/ingestion/run"),
        ("get", "/api/v1/cms/ingestion/queue"),
        ("post", "/api/v1/cms/crawl/run"),
        ("post", "/api/v1/cms/ingestion/1/rewrite"),
        ("get", "/api/v1/cms/audio/assets"),
        ("post", "/api/v1/cms/audio/backfill"),
        ("post", "/api/v1/cms/articles/1/generate-audio"),
        ("get", "/api/v1/cms/bulletins"),
        ("post", "/api/v1/cms/bulletins/run"),
    ],
)
def test_automated_content_routes_refuse(client: TestClient, db: Session, method: str, path: str) -> None:
    r = getattr(client, method)(path, headers=_admin(db), **({"json": {}} if method == "post" else {}))
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "AI_FEATURES_DISABLED"


def test_the_newsroom_still_works(client: TestClient, db: Session) -> None:
    admin = _admin(db)
    for path in ("/api/v1/cms/articles", "/api/v1/cms/taxonomy", "/api/v1/cms/settings",
                 "/api/v1/public/config", "/api/v1/public/home", "/api/v1/public/articles"):
        r = client.get(path, headers=admin)
        assert r.status_code == 200, (path, r.text)


def test_the_schedule_drops_the_automated_jobs() -> None:
    kept = celery_app.without_ai_jobs(celery_app.celery.conf.beat_schedule)
    tasks = {entry["task"] for entry in kept.values()}
    assert not any(t.startswith(("crawl.", "ai.", "voice.", "bulletin.", "epaper.audio")) for t in tasks)
    assert {"epaper.schedule", "notify.dispatch", "kyc.purge"} <= tasks
