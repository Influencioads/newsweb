"""The e-paper admin and public HTTP surface: permissions, page count, PDF flow."""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import seed_permissions, seed_roles  # noqa: E402
from app.db.seed_content import seed_categories  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.audio import AudioAsset  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    AudioStatus,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.epaper import EpaperAsset, EpaperEdition, EpaperPage, EpaperPageArticle  # noqa: E402
from app.models.geo import District  # noqa: E402
from app.models.media import Media  # noqa: E402
from app.models.setting import AppSetting  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service, epaper_service, settings_service, tts_service  # noqa: E402

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    permissions = seed_permissions(session)
    seed_roles(session, permissions)
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


@pytest.fixture(autouse=True)
def _isolate(db: Session) -> Iterator[None]:
    _purge(db)
    yield
    _purge(db)


def _purge(db: Session) -> None:
    for model in (
        EpaperPageArticle, EpaperPage, EpaperAsset, EpaperEdition, AudioAsset, Article, AppSetting
    ):
        db.query(model).delete()
    db.commit()
    db.expunge_all()
    settings_service.invalidate()


def staff_headers(db: Session, *, role: RoleKey, email: str) -> dict[str, str]:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        role_row = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
        user = User(email=email, name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE)
        db.add(user)
        db.flush()
        db.add(UserRole(user_id=user.id, role_id=role_row.id, scope_type=ScopeType.GLOBAL))
        db.flush()
    db.refresh(user)
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}


def publish_stories(db: Session, n: int) -> None:
    for i in range(n):
        db.add(
            Article(
                short_id=f"e{i:05d}",
                slug=f"epaper-story-{i}",
                title_te=f"వార్త {i}",
                summary_te="సారాంశం",
                word_count=120,
                status=ArticleStatus.PUBLISHED,
                workflow_state=WorkflowState.PUBLISHED,
                published_at=utcnow(),
            )
        )
    db.commit()


def today() -> str:
    return datetime.now(epaper_service.IST).date().isoformat()


def publish_edition(db: Session) -> EpaperEdition:
    edition = epaper_service.generate_daily(db, page_count=1)
    epaper_service.approve(db, edition, 1)
    epaper_service.publish(db, edition, 1)
    db.commit()
    return edition


def test_public_edition_never_carries_pdf_but_admin_does(client: TestClient, db: Session) -> None:
    publish_stories(db, 3)
    edition = publish_edition(db)
    db.add(
        EpaperAsset(
            edition_id=edition.id,
            kind="PDF",
            revision=edition.revision,
            status="READY",
            public_url="https://cdn.example/edition.pdf",
        )
    )
    db.commit()
    for path in (f"/api/v1/epaper/{today()}", "/api/v1/epaper/today"):
        body = client.get(path).json()
        assert (body["pdf_url"], body["pdf_status"], body["pdf_error"]) == (None, None, None)
    assert client.get("/api/v1/epaper/archive").json()["items"][0]["pdf_url"] is None
    assert client.get(f"/api/v1/epaper/{today()}/pdf", follow_redirects=False).status_code == 404
    desk = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
    admin = client.get(f"/api/v1/admin/epaper/by-date/{today()}", headers=desk).json()
    assert admin["pdf_url"] == "https://cdn.example/edition.pdf" and admin["pdf_status"] == "READY"


def test_public_article_carries_print_fields(client: TestClient, db: Session) -> None:
    district = District(state="TS", slug="epaper-warangal", name_te="వరంగల్", name_en="Warangal")
    hero = Media(
        filename="hero.jpg",
        mime="image/jpeg",
        storage_key="epaper-hero.jpg",
        cdn_url="https://cdn.example/hero.jpg",
        caption_te="ఫోటో వివరణ",
        credit="PTI",
    )
    db.add_all([district, hero])
    db.flush()
    db.add(
        Article(
            short_id="eprint",
            slug="epaper-print-story",
            title_te="ముద్రణ వార్త",
            summary_te="సారాంశం",
            body_plain="మొదటి పేరా.\nరెండవ పేరా.",
            byline_te="మా ప్రతినిధి",
            district_id=district.id,
            hero_media_id=hero.id,
            word_count=120,
            status=ArticleStatus.PUBLISHED,
            workflow_state=WorkflowState.PUBLISHED,
            published_at=utcnow(),
        )
    )
    db.commit()
    publish_edition(db)
    article = client.get(f"/api/v1/epaper/{today()}").json()["pages"][0]["articles"][0]
    assert article["body"] == ["మొదటి పేరా.", "రెండవ పేరా."]
    assert article["byline_te"] == "మా ప్రతినిధి" and article["dateline_te"] == "వరంగల్"
    assert article["hero_url"] == "https://cdn.example/hero.jpg"
    assert article["hero_caption_te"] == "ఫోటో వివరణ" and article["hero_credit"] == "PTI"


def test_audio_playlist_skips_a_story_whose_voice_is_off(client: TestClient, db: Session) -> None:
    """§20. Turning a story's voice off leaves its audio_asset_id in place, so
    the edition queue must ask the switch too — otherwise the radio advances
    straight into a file the story's own /audio route refuses to play."""
    publish_stories(db, 2)
    publish_edition(db)
    settings_service.set_many(db, {"epaper.audio_enabled": True}, actor_id=None)
    stories = db.scalars(select(Article).order_by(Article.short_id)).all()
    for story in stories:
        asset = AudioAsset(
            article_id=story.id,
            content_hash="upload-1",
            status=AudioStatus.READY,
            provider=tts_service.UPLOAD_PROVIDER,
            url=f"https://cdn.example/{story.short_id}.mp3",
        )
        db.add(asset)
        db.flush()
        story.audio_asset_id = asset.id
    db.commit()
    playlist = f"/api/v1/epaper/{today()}/audio"
    both = {t["short_id"] for t in client.get(playlist).json()["tracks"]}
    assert both == {s.short_id for s in stories}

    stories[1].voice_enabled = False
    db.commit()
    tracks = client.get(playlist).json()["tracks"]
    assert [t["short_id"] for t in tracks] == [stories[0].short_id]


def test_paragraphs_split_on_any_newline_strip_and_cap() -> None:
    assert epaper_service._paragraphs(None) == []
    assert epaper_service._paragraphs(" \n \r\n") == []
    text = " మొదటి పేరా \n\n \n రెండవ పేరా\r\nమూడవ పేరా\nనాలుగవ పేరా\n"
    assert epaper_service._paragraphs(text) == [
        "మొదటి పేరా", "రెండవ పేరా", "మూడవ పేరా", "నాలుగవ పేరా"
    ]
    big = "అ" * 3000
    assert epaper_service._paragraphs("\n".join([big] * 4)) == [big, big]
    # A single paragraph over the whole budget is cut, never dropped — the
    # story would otherwise reach the page with no body at all.
    huge = "అ" * (epaper_service.BODY_CHARS + 500)
    assert epaper_service._paragraphs(huge) == [huge[: epaper_service.BODY_CHARS]]


def test_admin_pdf_enqueues_background_job(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    publish_stories(db, 3)
    edition = epaper_service.generate_daily(db, page_count=1)
    epaper_service.approve(db, edition, 1)
    db.commit()
    calls: list[int] = []
    monkeypatch.setattr(epaper_service, "render_pdf_job", lambda edition_id, **_kw: calls.append(edition_id))
    desk = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
    response = client.post(f"/api/v1/admin/epaper/{edition.id}/pdf", headers=desk)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "PENDING"
    assert calls == [edition.id]
    dtp = staff_headers(db, role=RoleKey.DTP_OPERATOR, email="dtp@example.com")
    assert client.post(f"/api/v1/admin/epaper/{edition.id}/publish", headers=dtp).status_code == 403


def test_generate_accepts_page_count_and_regenerate_refuses_personal(
    client: TestClient, db: Session
) -> None:
    publish_stories(db, 12)
    desk = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
    response = client.post("/api/v1/admin/epaper/generate", json={"page_count": 2}, headers=desk)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["page_count"] == 2
    assert body["pages"][0]["slots"] and body["pages"][0]["grid"] == {"cols": 6, "rows": 6}
    assert body["pages"][0]["articles"][0]["slot"] == 0
    assert body["pages"][0]["articles"][0]["size"] == "lead"

    plan = client.get("/api/v1/admin/epaper/plan", headers=desk).json()
    assert plan["candidates"] == 12 and plan["default_page_count"] == 8

    page = body["pages"][0]
    patched = client.patch(
        f"/api/v1/admin/epaper/{body['id']}/pages/{page['id']}",
        json={"article_ids": [page["articles"][0]["id"], None, page["articles"][1]["id"]]},
        headers=desk,
    )
    assert patched.status_code == 200, patched.text
    assert [a["slot"] for a in patched.json()["articles"]] == [0, 2]

    listed = client.get(
        f"/api/v1/admin/epaper/{body['id']}/candidates", params={"page_id": page["id"]}, headers=desk
    ).json()["items"]
    assert listed and all(item["size"] in {"lead", "standard", "brief"} for item in listed)

    personal = EpaperEdition(
        title="mine", edition_date=datetime.now(epaper_service.IST).date(), edition_type="PERSONAL_9", owner_user_id=9
    )
    db.add(personal)
    db.commit()
    assert client.post(f"/api/v1/admin/epaper/{personal.id}/regenerate", headers=desk).status_code == 409
