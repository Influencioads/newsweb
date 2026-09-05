"""Phase E integration tests — YouTube-link videos, the short-news feed, and
the rule-based For You personalization (§3, §14, §15)."""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.errors import ValidationError  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_homepage_sections,
    seed_mandals,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article, Category  # noqa: E402
from app.models.engagement import ArticleEvent, ReadingSession  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    EventType,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.geo import District  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service  # noqa: E402
from app.services.video_service import parse_youtube_id  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)

_counter = 0


def make_article(db: Session, *, title_te: str, category: Category | None = None,
                 district_id: int | None = None, minutes_ago: int = 60,
                 summary_te: str | None = None) -> Article:
    global _counter
    _counter += 1
    article = Article(
        short_id=f"e{_counter:05d}",
        slug=f"phase-e-{_counter}",
        title_te=title_te,
        summary_te=summary_te,
        category_id=category.id if category else None,
        district_id=district_id,
        status=ArticleStatus.PUBLISHED,
        workflow_state=WorkflowState.PUBLISHED,
        published_at=utcnow() - timedelta(minutes=minutes_ago),
    )
    db.add(article)
    db.flush()
    return article


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


def reader(client: TestClient, phone: str) -> tuple[dict[str, str], int]:
    otp = client.post("/api/v1/auth/otp/request", json={"phone": phone}).json()["dev_otp"]
    r = client.post("/api/v1/auth/reader/otp/verify", json={"phone": phone, "otp": otp})
    assert r.status_code == 200, r.text
    return (
        {"Authorization": f"Bearer {r.json()['tokens']['access_token']}"},
        r.json()["me"]["user"]["id"],
    )


def cat(db: Session, slug: str) -> Category:
    return db.execute(select(Category).where(Category.slug == slug)).scalar_one()


# --------------------------------------------------------------------------- #
# YouTube link parsing (§15, product decision)
# --------------------------------------------------------------------------- #
class TestYoutubeParsing:
    @pytest.mark.parametrize("url", [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ?si=abc",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
        "https://www.youtube.com/live/dQw4w9WgXcQ",
        "dQw4w9WgXcQ",
    ])
    def test_every_editor_pasteable_shape_resolves(self, url: str) -> None:
        assert parse_youtube_id(url) == "dQw4w9WgXcQ"

    @pytest.mark.parametrize("url", [
        "https://vimeo.com/12345",
        "https://www.youtube.com/watch",
        "not a url at all",
        "https://example.com/watch?v=dQw4w9WgXcQ",
        "",
    ])
    def test_non_youtube_input_is_rejected(self, url: str) -> None:
        with pytest.raises(ValidationError):
            parse_youtube_id(url)


class TestVideos:
    def test_add_list_unpublish_flow(self, client: TestClient, db: Session) -> None:
        editor = staff_headers(db, role=RoleKey.DESK_EDITOR, email="videos@test.example.com")

        r = client.post("/api/v1/cms/videos", json={
            "youtube_url": "https://youtu.be/aqz-KE-bpKQ",
            "title_te": "పోలవరం డ్రోన్ దృశ్యాలు",
            "category_slug": "politics",
        }, headers=editor)
        assert r.status_code == 201, r.text
        video = r.json()
        assert video["youtube_id"] == "aqz-KE-bpKQ"
        assert video["thumbnail_url"].endswith("aqz-KE-bpKQ/hqdefault.jpg")
        assert "youtube-nocookie.com/embed/aqz-KE-bpKQ" in video["embed_url"]

        # Duplicate link is refused.
        dup = client.post("/api/v1/cms/videos", json={
            "youtube_url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
            "title_te": "నకిలీ వీడియో",
        }, headers=editor)
        assert dup.status_code == 422

        pub = client.get("/api/v1/public/videos").json()
        assert any(v["youtube_id"] == "aqz-KE-bpKQ" for v in pub["videos"])

        # Unpublish removes it from the public hub.
        r2 = client.patch(f"/api/v1/cms/videos/{video['id']}", json={"is_published": False},
                          headers=editor)
        assert r2.status_code == 200
        pub2 = client.get("/api/v1/public/videos").json()
        assert all(v["youtube_id"] != "aqz-KE-bpKQ" for v in pub2["videos"])

    def test_adding_requires_permission(self, client: TestClient, db: Session) -> None:
        moderator = staff_headers(db, role=RoleKey.MODERATOR, email="videos-mod@test.example.com")
        r = client.post("/api/v1/cms/videos", json={
            "youtube_url": "https://youtu.be/09839DpTctU",
            "title_te": "అనుమతి లేని వీడియో",
        }, headers=moderator)
        assert r.status_code == 403


# --------------------------------------------------------------------------- #
# short news (§14)
# --------------------------------------------------------------------------- #
class TestShortNews:
    def test_only_summarised_stories_appear(self, client: TestClient, db: Session) -> None:
        cinema = cat(db, "cinema")
        with_summary = make_article(
            db, title_te="సారాంశ కథనం", category=cinema,
            summary_te="రెండు లైన్ల సంక్షిప్త సారాంశం ఇక్కడ ఉంటుంది.",
        )
        without_summary = make_article(db, title_te="సారాంశం లేని కథనం", category=cinema)
        db.commit()

        r = client.get("/api/v1/public/short-news")
        assert r.status_code == 200
        ids = [a["short_id"] for a in r.json()["articles"]]
        assert with_summary.short_id in ids
        assert without_summary.short_id not in ids

    def test_category_filter(self, client: TestClient, db: Session) -> None:
        sports = cat(db, "sports")
        s = make_article(db, title_te="క్రీడల షార్ట్", category=sports,
                         summary_te="క్రీడా సారాంశం.")
        db.commit()
        r = client.get("/api/v1/public/short-news", params={"category": "sports"})
        ids = [a["short_id"] for a in r.json()["articles"]]
        assert s.short_id in ids
        assert all(a["category"]["slug"] == "sports" for a in r.json()["articles"])


# --------------------------------------------------------------------------- #
# For You (§3)
# --------------------------------------------------------------------------- #
class TestForYou:
    def test_requires_auth(self, client: TestClient) -> None:
        assert client.get("/api/v1/users/me/for-you").status_code == 401

    def test_interest_location_and_negative_feedback_shape_the_feed(
        self, client: TestClient, db: Session
    ) -> None:
        cinema, business, food = cat(db, "cinema"), cat(db, "business"), cat(db, "food")
        guntur = db.execute(select(District).where(District.slug == "guntur")).scalar_one()

        cinema_story = make_article(db, title_te="సినీ ప్రత్యేకం", category=cinema, minutes_ago=30)
        guntur_story = make_article(db, title_te="గుంటూరు అప్డేట్", category=business,
                                    district_id=guntur.id, minutes_ago=30)
        food_story = make_article(db, title_te="వంటల కథనం", category=food, minutes_ago=30)
        neutral = make_article(db, title_te="సాధారణ కథనం", category=business, minutes_ago=30)
        db.commit()

        headers, user_id = reader(client, "9848030001")

        # Their trail: reads three cinema stories; home district Guntur;
        # explicitly not interested in the food story.
        for i in range(3):
            old = make_article(db, title_te=f"పాత సినిమా {i}", category=cinema, minutes_ago=600)
            db.add(ReadingSession(article_id=old.id, viewer_key=f"user:{user_id}",
                                  user_id=user_id, day=utcnow().date(), seconds=60,
                                  max_scroll_pct=80, created_at=utcnow(), updated_at=utcnow()))
        db.add(ArticleEvent(article_id=food_story.id, user_id=user_id,
                            event_type=EventType.NOT_INTERESTED, created_at=utcnow()))
        db.commit()
        assert client.patch("/api/v1/users/me/preferences",
                            json={"district_slug": "guntur"}, headers=headers).status_code == 200

        r = client.get("/api/v1/users/me/for-you", headers=headers)
        assert r.status_code == 200
        order = [a["short_id"] for a in r.json()["articles"]]

        assert food_story.short_id not in order, "not-interested articles are excluded"
        assert order.index(cinema_story.short_id) < order.index(neutral.short_id), \
            "category interest must outrank a neutral story of the same age"
        assert order.index(guntur_story.short_id) < order.index(neutral.short_id), \
            "home-district stories must outrank a neutral story of the same age"

    def test_new_account_gets_latest_fallback(self, client: TestClient, db: Session) -> None:
        headers, _uid = reader(client, "9848030002")
        r = client.get("/api/v1/users/me/for-you", headers=headers)
        assert r.status_code == 200
        assert r.json()["articles"], "an empty profile degrades to the latest feed (§31)"
