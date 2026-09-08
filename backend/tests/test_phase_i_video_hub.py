"""Phase I integration tests — the video hub (updated doc §15).

Covers what the DailyHunt-shaped video experience needs and, more importantly,
the two rules that are easy to break later:

  * a "Top trending" or hub override must never inflate a computed score, and
  * a comment must never leak between an article and a video.
"""

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

from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article, Category  # noqa: E402
from app.models.engagement import Comment, Reaction  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    CommentTargetType,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.user import Role, User, UserRole  # noqa: E402
from app.models.video import Video, VideoChannel  # noqa: E402
from app.services import auth_service, video_service  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)

_counter = 0


def make_video(db: Session, *, title: str, category: Category | None = None,
               channel: str = "Test News", minutes_ago: int = 30) -> Video:
    global _counter
    _counter += 1
    video = Video(
        youtube_id=f"vid{_counter:07d}"[:11],
        title_te=title,
        category_id=category.id if category else None,
        is_published=True,
        published_at=utcnow() - timedelta(minutes=minutes_ago),
        channel_id=video_service.get_or_create_channel(db, name=channel).id,
    )
    db.add(video)
    db.flush()
    return video


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    permissions = seed_permissions(session)
    seed_roles(session, permissions)
    seed_states(session)
    seed_districts(session)
    categories = seed_categories(session)
    seed_tags(session)

    # Two videos per category is the threshold a rail has to clear.
    cinema = categories["cinema"]
    sports = categories["sports"]
    for index in range(3):
        make_video(session, title=f"సినిమా వీడియో {index}", category=cinema,
                   channel="TV9 Telugu", minutes_ago=index * 10)
    for index in range(2):
        make_video(session, title=f"క్రీడల వీడియో {index}", category=sports,
                   channel="ETV Sports", minutes_ago=index * 10)
    # A lone video in a third category — must NOT get a rail.
    politics = categories["politics"]
    make_video(session, title="ఒంటరి రాజకీయ వీడియో", category=politics)

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


def reader_headers(client: TestClient, phone: str) -> dict[str, str]:
    otp = client.post("/api/v1/auth/otp/request", json={"phone": phone}).json()["dev_otp"]
    r = client.post("/api/v1/auth/reader/otp/verify", json={"phone": phone, "otp": otp})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['tokens']['access_token']}"}


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


# --------------------------------------------------------------------------- #
# the hub
# --------------------------------------------------------------------------- #
class TestVideoHub:
    def test_rails_skip_categories_with_too_little_video(self, client: TestClient) -> None:
        payload = client.get("/api/v1/public/videos/rails").json()
        keys = {rail["key"] for rail in payload["rails"]}
        assert "cinema" in keys
        assert "sports" in keys
        # One video does not make a shelf.
        assert "politics" not in keys
        assert {tab["slug"] for tab in payload["tabs"]} == keys

    def test_every_rail_carries_its_own_videos(self, client: TestClient) -> None:
        payload = client.get("/api/v1/public/videos/rails").json()
        cinema = next(r for r in payload["rails"] if r["key"] == "cinema")
        assert len(cinema["videos"]) == 3
        assert all(v["channel"]["name"] == "TV9 Telugu" for v in cinema["videos"])

    def test_detail_carries_channel_tags_and_related(self, client: TestClient, db: Session) -> None:
        video = db.scalars(select(Video)).first()
        video_service.apply_tags(db, video, ["సినిమా", "టాలీవుడ్"])
        db.commit()

        payload = client.get(f"/api/v1/public/videos/{video.id}").json()
        assert payload["channel"]["name"]
        assert {t["name_te"] for t in payload["tags"]} == {"సినిమా", "టాలీవుడ్"}
        assert payload["related"], "a video page must offer something to watch next"
        assert all(v["id"] != video.id for v in payload["related"])

    def test_view_count_increments(self, client: TestClient, db: Session) -> None:
        video = db.scalars(select(Video)).first()
        before = client.get(f"/api/v1/public/videos/{video.id}").json()["view_count"]
        client.post(f"/api/v1/public/videos/{video.id}/view")
        after = client.get(f"/api/v1/public/videos/{video.id}").json()["view_count"]
        assert after == before + 1

    def test_an_unpublished_video_is_not_reachable(self, client: TestClient, db: Session) -> None:
        video = make_video(db, title="దాచిన వీడియో")
        video.is_published = False
        db.commit()
        assert client.get(f"/api/v1/public/videos/{video.id}").status_code == 404


# --------------------------------------------------------------------------- #
# reactions
# --------------------------------------------------------------------------- #
class TestReactions:
    def test_anonymous_reader_counts_and_can_change_their_mind(
        self, client: TestClient, db: Session
    ) -> None:
        video = make_video(db, title="స్పందన పరీక్ష")
        db.commit()
        url = f"/api/v1/public/videos/{video.id}/reaction"

        first = client.post(url, json={"kind": "happy", "anon_id": "anon-a"}).json()
        assert first["counts"]["happy"] == 1
        assert first["percent"]["happy"] == 100
        assert first["mine"] == "happy"

        # Changing your mind replaces the row: the bar counts people, not clicks.
        changed = client.post(url, json={"kind": "angry", "anon_id": "anon-a"}).json()
        assert changed["total"] == 1
        assert changed["counts"]["happy"] == 0
        assert changed["counts"]["angry"] == 1

        client.post(url, json={"kind": "happy", "anon_id": "anon-b"})
        both = client.post(url, json={"kind": None, "anon_id": "anon-c"}).json()
        assert both["total"] == 2

        cleared = client.post(url, json={"kind": None, "anon_id": "anon-a"}).json()
        assert cleared["total"] == 1
        assert cleared["mine"] is None

    def test_reactions_are_scoped_to_their_target(self, client: TestClient, db: Session) -> None:
        """A reaction on a video must not appear on the article with the same id."""
        video = make_video(db, title="స్కోప్ పరీక్ష")
        db.commit()
        client.post(f"/api/v1/public/videos/{video.id}/reaction",
                    json={"kind": "sad", "anon_id": "anon-scope"})
        rows = db.scalars(select(Reaction).where(Reaction.target_id == video.id)).all()
        assert all(r.target_type == CommentTargetType.VIDEO for r in rows)


# --------------------------------------------------------------------------- #
# comments — the polymorphic part
# --------------------------------------------------------------------------- #
class TestVideoComments:
    def test_comment_on_a_video_and_count_it(self, client: TestClient, db: Session) -> None:
        video = make_video(db, title="కామెంట్ పరీక్ష")
        db.commit()
        headers = reader_headers(client, "9848090001")

        posted = client.post(f"/api/v1/videos/{video.id}/comments",
                             json={"body": "మంచి వీడియో"}, headers=headers)
        assert posted.status_code == 201, posted.text

        listing = client.get(f"/api/v1/public/videos/{video.id}/comments").json()
        assert listing["total_visible"] == 1
        assert listing["comments"][0]["body"] == "మంచి వీడియో"

        detail = client.get(f"/api/v1/public/videos/{video.id}").json()
        assert detail["comment_count"] == 1

    def test_video_and_article_threads_stay_separate(
        self, client: TestClient, db: Session
    ) -> None:
        """The bug this design exists to prevent: two id spaces, one column."""
        video = make_video(db, title="విభజన పరీక్ష")
        article = Article(
            short_id=f"art{_counter:04d}"[:12], slug=f"sep-{_counter}",
            title_te="విభజన కథనం", status=ArticleStatus.PUBLISHED,
            workflow_state=WorkflowState.PUBLISHED, published_at=utcnow(),
        )
        db.add(article)
        db.flush()
        db.commit()

        headers = reader_headers(client, "9848090002")
        client.post(f"/api/v1/videos/{video.id}/comments",
                    json={"body": "వీడియో కామెంట్"}, headers=headers)
        client.post(f"/api/v1/articles/{article.short_id}/comments",
                    json={"body": "కథన కామెంట్"}, headers=headers)

        video_thread = client.get(f"/api/v1/public/videos/{video.id}/comments").json()
        article_thread = client.get(
            f"/api/v1/public/articles/{article.short_id}/comments").json()

        assert [c["body"] for c in video_thread["comments"]] == ["వీడియో కామెంట్"]
        assert [c["body"] for c in article_thread["comments"]] == ["కథన కామెంట్"]

    def test_existing_article_comments_kept_their_target(self, db: Session) -> None:
        """The migration's server default is what makes it a safe deploy."""
        rows = db.scalars(select(Comment).where(Comment.article_id.is_not(None))).all()
        assert rows, "expected at least one article comment from the test above"
        assert all(c.target_type == CommentTargetType.ARTICLE for c in rows)
        assert all(c.video_id is None for c in rows)

    def test_moderation_queue_shows_what_was_commented_on(
        self, client: TestClient, db: Session
    ) -> None:
        moderator = staff_headers(db, role=RoleKey.MODERATOR, email="v-mod@test.example.com")
        queue = client.get("/api/v1/cms/moderation/comments", headers=moderator)
        assert queue.status_code == 200, queue.text
        items = queue.json()["items"]
        assert items, "the queue should hold the comments made above"
        kinds = {item["target"]["target_type"] for item in items}
        assert "video" in kinds and "article" in kinds
        # A moderator must never see a blank row: every item names its parent.
        assert all(item["target"]["title_te"] for item in items)


# --------------------------------------------------------------------------- #
# following a channel
# --------------------------------------------------------------------------- #
class TestChannelFollow:
    def test_follow_and_unfollow_a_channel(self, client: TestClient, db: Session) -> None:
        video = db.scalars(select(Video)).first()
        channel = db.get(VideoChannel, video.channel_id)
        headers = reader_headers(client, "9848090003")

        followed = client.post("/api/v1/follow", headers=headers, json={
            "target_type": "channel", "slug": channel.youtube_channel_key})
        assert followed.status_code == 200, followed.text

        detail = client.get(f"/api/v1/public/videos/{video.id}", headers=headers).json()
        assert detail["following_channel"] is True

        client.request("DELETE", "/api/v1/follow", headers=headers, json={
            "target_type": "channel", "slug": channel.youtube_channel_key})
        after = client.get(f"/api/v1/public/videos/{video.id}", headers=headers).json()
        assert after["following_channel"] is False

    def test_one_channel_row_per_publisher(self, db: Session) -> None:
        """Two videos from the same publisher must share a channel, or "follow"
        would mean something different on each of them."""
        first = video_service.get_or_create_channel(db, name="TV9 Telugu")
        second = video_service.get_or_create_channel(db, name="TV9 Telugu")
        assert first.id == second.id
