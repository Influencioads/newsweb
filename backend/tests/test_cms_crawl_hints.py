"""What the review desk is told about a crawled story the AI filed.

The hints are only useful if they are true: a photo is badged "no watermark
found" only when the vision check said so, the AI's filing shows as names the
reviewer recognises, and "Mark breaking" on a story still in review neither
starts its clock early nor alerts a single reader.
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

from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import seed_districts, seed_permissions, seed_roles, seed_states  # noqa: E402
from app.db.seed_content import seed_categories  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    ContentPolicy,
    IngestStatus,
    MediaType,
    RoleKey,
    ScopeType,
    SourceBeat,
    SourceLicence,
    UserStatus,
    WorkflowState,
)
from app.models.geo import Mandal  # noqa: E402
from app.models.ingestion import ContentSource, IngestedItem, IngestedRewrite  # noqa: E402
from app.models.media import Media  # noqa: E402
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
    seed_roles(session, seed_permissions(session))
    seed_states(session)
    seed_districts(session)
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


@pytest.fixture(scope="module")
def headers(db: Session) -> dict[str, str]:
    role = db.scalar(select(Role).where(Role.key == RoleKey.EDITOR_IN_CHIEF.value))
    user = User(email="hints@test.local", name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE)
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=role.id, scope_type=ScopeType.GLOBAL))
    db.flush()
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}


_n = 0


def make_article(db: Session, *, hero: Media | None = None, **extra: object) -> Article:
    global _n
    _n += 1
    article = Article(
        short_id=f"hint{_n}",
        slug=f"hint-{_n}",
        title_te="క్రాల్ చేసిన కథనం",
        status=ArticleStatus.PENDING,
        workflow_state=WorkflowState.SUBMITTED,
        hero_media_id=hero.id if hero else None,
        **extra,
    )
    db.add(article)
    db.commit()
    return article


def make_media(db: Session, **extra: object) -> Media:
    media = Media(
        type=MediaType.IMAGE,
        filename="hero.webp",
        mime="image/webp",
        storage_provider="test",
        storage_key=f"images/test/{utcnow().timestamp()}.webp",
        **extra,
    )
    db.add(media)
    db.flush()
    return media


def crawled(db: Session, article: Article, **item_extra: object) -> IngestedItem:
    source = db.scalar(select(ContentSource).where(ContentSource.slug == "hint-src"))
    if source is None:
        source = ContentSource(
            slug="hint-src",
            name="Hint Source",
            feed_url="https://publisher.example.com/feed.xml",
            licence=SourceLicence.RSS_PUBLIC,
            content_policy=ContentPolicy.EXCERPT_ONLY,
            beat=SourceBeat.DISTRICT_LOCAL,
        )
        db.add(source)
        db.flush()
    item = IngestedItem(
        source_id=source.id,
        guid=f"hint-{article.id}",
        url="https://publisher.example.com/a1",
        title="వారి శీర్షిక",
        summary="సారాంశం",
        language="te",
        fetched_at=utcnow(),
        content_hash=f"hint-{article.id}",
        status=IngestStatus.IMPORTED,
        article_id=article.id,
        **item_extra,
    )
    db.add(item)
    db.flush()
    return item


def test_hero_flags_reach_the_article_and_the_pending_list(
    db: Session, client: TestClient, headers: dict[str, str]
) -> None:
    clean = make_media(db, source_type="syndicated", meta={"photo_check": {"verdict": "clean", "model": "m"}})
    unchecked = make_media(db, source_type="syndicated", meta={"photo_check": {"verdict": "unchecked", "model": None}})
    drawn = make_media(db, source_type="own", ai_generated=True)
    a_clean = make_article(db, hero=clean, breaking_suggested=True)
    a_unchecked = make_article(db, hero=unchecked)
    a_drawn = make_article(db, hero=drawn)
    a_none = make_article(db)

    hero = client.get(f"/api/v1/cms/articles/{a_clean.id}", headers=headers).json()["hero_media"]
    assert hero["checked"] is True and hero["ai_generated"] is False

    rows = {
        r["id"]: r
        for r in client.get(
            "/api/v1/cms/articles/pending", params={"limit": 100}, headers=headers
        ).json()["articles"]
    }
    # The pending list now carries the hero too, or its badges would be blind.
    assert rows[a_clean.id]["hero_media"]["checked"] is True
    assert rows[a_clean.id]["breaking_suggested"] is True
    assert rows[a_clean.id]["is_breaking"] is False
    # "unchecked" is not "clean": the badge must say it was not scanned.
    assert rows[a_unchecked.id]["hero_media"]["checked"] is False
    assert rows[a_drawn.id]["hero_media"]["ai_generated"] is True
    assert rows[a_drawn.id]["hero_media"]["checked"] is False
    assert rows[a_none.id]["hero_media"] is None
    assert rows[a_none.id]["breaking_suggested"] is False


def test_origin_shows_the_ai_filing_as_names_and_the_photo_verdicts(
    db: Session, client: TestClient, headers: dict[str, str]
) -> None:
    from app.models.content import Category
    from app.models.geo import District

    category = db.scalar(select(Category).where(Category.parent_id.is_(None)).limit(1))
    district = db.scalar(select(District).limit(1))
    mandal = Mandal(district_id=district.id, slug="hint-mandal", name_te="హింట్ మండలం", name_en="Hint Mandal")
    db.add(mandal)
    db.flush()

    article = make_article(db)
    photo_check = {
        "model": "google/gemini-vision",
        "candidates": [
            {"url": "https://publisher.example.com/a.jpg", "verdict": "watermark", "reason": "corner logo"},
            {"url": "https://publisher.example.com/b.jpg", "verdict": "clean", "reason": ""},
        ],
        "hero": "crawled",
    }
    item = crawled(db, article, photo_check=photo_check)
    db.add(
        IngestedRewrite(
            item_id=item.id,
            title_te="మా శీర్షిక",
            engine="fake",
            classification={
                "category_id": category.id,
                "subcategory_id": None,
                "district_id": district.id,
                "mandal_id": mandal.id,
                "tags": [{"name": "పోలవరం", "type": "place", "tag_id": None}],
                "breaking": True,
                "glyph_warning": False,
                "raw": {"category": "ignored"},
                "story_type": "governance",
                "editor_note": "మంత్రి స్పందన కోరండి.",
                "style_warnings": ["copied", "lede_too_long"],
                "refuse_screen": False,
            },
        )
    )
    db.commit()

    body = client.get(f"/api/v1/cms/articles/{article.id}/origin", headers=headers).json()
    ai = body["ai"]
    assert ai["category"]["name_te"] == category.name_te
    assert ai["subcategory"] is None
    assert ai["district"]["name_en"] == district.name_en
    assert ai["mandal"] == {"id": mandal.id, "name_te": "హింట్ మండలం", "name_en": "Hint Mandal"}
    assert ai["tags"] == [{"name": "పోలవరం", "type": "place"}]
    assert ai["breaking"] is True and ai["glyph_warning"] is False
    # The model's raw strings are debug data, not something to show a reviewer.
    assert "raw" not in ai
    assert body["photos"] == photo_check
    # The house-style pass, named for the desk.
    assert ai["story_type"]["key"] == "governance" and ai["story_type"]["name_te"]
    assert ai["editor_note"] == "మంత్రి స్పందన కోరండి."
    assert ai["style_warnings"] == ["copied", "lede_too_long"] and ai["refuse_screen"] is False

    # An item from before the feature: both keys present, both null.
    older = make_article(db)
    crawled(db, older)
    db.commit()
    body = client.get(f"/api/v1/cms/articles/{older.id}/origin", headers=headers).json()
    assert body["ai"] is None and body["photos"] is None


def test_marking_breaking_before_publish_leaves_the_window_to_publish(
    db: Session, client: TestClient, headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    pushed: list[int] = []
    monkeypatch.setattr(
        "app.services.notification_service.fan_out_for_article",
        lambda _db, a: pushed.append(a.id) or 0,
    )
    article = make_article(db, breaking_suggested=True)

    r = client.post(
        f"/api/v1/cms/articles/{article.id}/breaking",
        json={"minutes": 60, "repush": True},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_breaking"] is True
    # Counted from now it would be half spent by the time it went out; publish
    # applies the configured default from the moment it is live.
    assert r.json()["breaking_until"] is None
    # Nobody is alerted to a story that has not been approved.
    assert pushed == []
