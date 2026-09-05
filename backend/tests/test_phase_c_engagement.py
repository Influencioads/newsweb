"""Phase C integration tests — beacon dedup, likes/bookmarks, comments with
moderation, reports, follows and the following feed, reading history.

Same harness as test_phase_a_reader_platform: in-memory SQLite + real seeds,
real HTTP through the app with `get_db` overridden, Redis on its dev fallbacks.
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
from app.models.engagement import ReadingSession, Report  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.geo import District  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)

_counter = 0


def make_article(db: Session, *, title_te: str, category: Category | None = None,
                 district_id: int | None = None, minutes_ago: int = 5) -> Article:
    global _counter
    _counter += 1
    article = Article(
        short_id=f"e{_counter:05d}",
        slug=f"engagement-{_counter}",
        title_te=title_te,
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


def reader_headers(client: TestClient, phone: str) -> dict[str, str]:
    otp = client.post("/api/v1/auth/otp/request", json={"phone": phone}).json()["dev_otp"]
    r = client.post("/api/v1/auth/reader/otp/verify", json={"phone": phone, "otp": otp})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['tokens']['access_token']}"}


def staff_headers(db: Session, *, role: RoleKey) -> dict[str, str]:
    email = f"{role.value}-c@test.example.com"
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        role_row = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
        user = User(
            email=email, name_te="మోడరేటర్", name_en="Moderator", status=UserStatus.ACTIVE
        )
        db.add(user)
        db.flush()
        db.add(UserRole(user_id=user.id, role_id=role_row.id, scope_type=ScopeType.GLOBAL))
        db.flush()
    db.refresh(user)
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}


def cat(db: Session, slug: str) -> Category:
    return db.execute(select(Category).where(Category.slug == slug)).scalar_one()


# --------------------------------------------------------------------------- #
# beacon (§3.1, §8)
# --------------------------------------------------------------------------- #
class TestBeacon:
    def test_views_dedupe_per_viewer_per_day(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="వ్యూ కౌంట్ పరీక్ష")
        db.commit()

        for _ in range(3):
            r = client.post(
                "/api/v1/public/events",
                json={"anon_id": "device-1", "events": [{"short_id": article.short_id, "type": "view"}]},
            )
            assert r.status_code == 202

        # A second device is a second reader.
        client.post(
            "/api/v1/public/events",
            json={"anon_id": "device-2", "events": [{"short_id": article.short_id, "type": "view"}]},
        )
        db.expire_all()
        assert db.get(Article, article.id).view_count == 2

    def test_read_seconds_accumulate_and_scroll_keeps_max(
        self, client: TestClient, db: Session
    ) -> None:
        article = make_article(db, title_te="రీడింగ్ సెషన్ పరీక్ష")
        db.commit()

        client.post(
            "/api/v1/public/events",
            json={
                "anon_id": "device-3",
                "events": [
                    {"short_id": article.short_id, "type": "view"},
                    {"short_id": article.short_id, "type": "read", "value": 15},
                    {"short_id": article.short_id, "type": "scroll", "value": 40},
                ],
            },
        )
        client.post(
            "/api/v1/public/events",
            json={
                "anon_id": "device-3",
                "events": [
                    {"short_id": article.short_id, "type": "read", "value": 900},
                    {"short_id": article.short_id, "type": "scroll", "value": 25},
                ],
            },
        )
        session = db.execute(
            select(ReadingSession).where(
                ReadingSession.article_id == article.id,
                ReadingSession.viewer_key == "anon:device-3",
            )
        ).scalar_one()
        assert session.seconds == 15 + 120  # the 900 s heartbeat is capped
        assert session.max_scroll_pct == 40  # later, smaller scroll does not shrink it

    def test_beacon_rejects_stateful_types(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="లైక్ ఇంజెక్షన్ పరీక్ష")
        db.commit()
        r = client.post(
            "/api/v1/public/events",
            json={"anon_id": "device-4", "events": [{"short_id": article.short_id, "type": "like"}]},
        )
        assert r.status_code == 202
        assert r.json()["accepted"] == 0
        db.expire_all()
        assert db.get(Article, article.id).like_count == 0


# --------------------------------------------------------------------------- #
# likes & bookmarks
# --------------------------------------------------------------------------- #
class TestLikesBookmarks:
    def test_like_is_idempotent_and_counted(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="లైక్ పరీక్ష")
        db.commit()
        headers = reader_headers(client, "9848010001")

        assert client.post(f"/api/v1/articles/{article.short_id}/like", headers=headers).json()["like_count"] == 1
        assert client.post(f"/api/v1/articles/{article.short_id}/like", headers=headers).json()["like_count"] == 1

        flags = client.get(f"/api/v1/articles/{article.short_id}/me", headers=headers).json()
        assert flags["liked"] is True

        assert client.delete(f"/api/v1/articles/{article.short_id}/like", headers=headers).json()["like_count"] == 0

    def test_like_requires_auth(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="అనామక లైక్")
        db.commit()
        assert client.post(f"/api/v1/articles/{article.short_id}/like").status_code == 401

    def test_bookmarks_roundtrip(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="బుక్‌మార్క్ పరీక్ష")
        db.commit()
        headers = reader_headers(client, "9848010002")

        client.post(f"/api/v1/articles/{article.short_id}/bookmark", headers=headers)
        saved = client.get("/api/v1/users/me/bookmarks", headers=headers).json()
        assert any(a["short_id"] == article.short_id for a in saved["articles"])

        client.delete(f"/api/v1/articles/{article.short_id}/bookmark", headers=headers)
        saved = client.get("/api/v1/users/me/bookmarks", headers=headers).json()
        assert all(a["short_id"] != article.short_id for a in saved["articles"])


# --------------------------------------------------------------------------- #
# comments & moderation
# --------------------------------------------------------------------------- #
class TestComments:
    def test_comment_lifecycle(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="వ్యాఖ్యల పరీక్ష")
        db.commit()
        headers = reader_headers(client, "9848010003")

        created = client.post(
            f"/api/v1/articles/{article.short_id}/comments",
            json={"body": "మంచి కథనం!"},
            headers=headers,
        )
        assert created.status_code == 201, created.text
        comment_id = created.json()["id"]

        # Visible publicly, and the article counter moved.
        public = client.get(f"/api/v1/public/articles/{article.short_id}/comments").json()
        assert public["total_visible"] == 1
        assert public["comments"][0]["body"] == "మంచి కథనం!"

        # A reply to a reply flattens to the top-level thread.
        reply = client.post(
            f"/api/v1/articles/{article.short_id}/comments",
            json={"body": "నిజమే", "parent_id": comment_id},
            headers=headers,
        ).json()
        nested = client.post(
            f"/api/v1/articles/{article.short_id}/comments",
            json={"body": "అవును", "parent_id": reply["id"]},
            headers=headers,
        ).json()
        assert nested["parent_id"] == comment_id

        # Author deletes own comment.
        assert (
            client.delete(f"/api/v1/comments/{nested['id']}", headers=headers).status_code == 200
        )
        public = client.get(f"/api/v1/public/articles/{article.short_id}/comments").json()
        assert all(c["id"] != nested["id"] for c in public["comments"])

    def test_moderator_hides_a_comment(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="మోడరేషన్ పరీక్ష")
        db.commit()
        reader = reader_headers(client, "9848010004")
        moderator = staff_headers(db, role=RoleKey.MODERATOR)

        comment_id = client.post(
            f"/api/v1/articles/{article.short_id}/comments",
            json={"body": "దాచవలసిన వ్యాఖ్య"},
            headers=reader,
        ).json()["id"]

        r = client.patch(
            f"/api/v1/cms/moderation/comments/{comment_id}",
            json={"hide": True},
            headers=moderator,
        )
        assert r.status_code == 200, r.text

        public = client.get(f"/api/v1/public/articles/{article.short_id}/comments").json()
        assert public["comments"] == []
        assert public["total_visible"] == 0

    def test_moderation_requires_permission(self, client: TestClient, db: Session) -> None:
        reader = reader_headers(client, "9848010005")
        assert client.get("/api/v1/cms/moderation/comments", headers=reader).status_code == 403


# --------------------------------------------------------------------------- #
# reports
# --------------------------------------------------------------------------- #
class TestReports:
    def test_report_lands_in_queue_and_closes(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="రిపోర్ట్ పరీక్ష")
        db.commit()
        reader = reader_headers(client, "9848010006")
        moderator = staff_headers(db, role=RoleKey.MODERATOR)

        r = client.post(
            f"/api/v1/articles/{article.short_id}/report",
            json={"reason": "misinformation", "note": "తప్పుడు సమాచారం"},
            headers=reader,
        )
        assert r.status_code == 202
        # Repeat report by the same reader does not stack the queue.
        client.post(
            f"/api/v1/articles/{article.short_id}/report",
            json={"reason": "misinformation"},
            headers=reader,
        )

        queue = client.get(
            "/api/v1/cms/moderation/reports", params={"status": "open"}, headers=moderator
        ).json()
        mine = [
            item for item in queue["items"]
            if item["target"]["kind"] == "article" and item["target"]["short_id"] == article.short_id
        ]
        assert len(mine) == 1
        assert mine[0]["target"]["title_te"] == "రిపోర్ట్ పరీక్ష"

        closed = client.post(
            f"/api/v1/cms/moderation/reports/{mine[0]['id']}/close",
            json={"dismiss": False, "note": "సరిచేశాం"},
            headers=moderator,
        )
        assert closed.status_code == 200
        assert closed.json()["status"] == "resolved"
        report = db.get(Report, mine[0]["id"])
        assert report is not None and report.resolved_by is not None

    def test_bad_reason_is_rejected(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="తప్పు కారణం")
        db.commit()
        r = client.post(
            f"/api/v1/articles/{article.short_id}/report", json={"reason": "dislike"}
        )
        assert r.status_code == 422


# --------------------------------------------------------------------------- #
# follows & following feed (§12)
# --------------------------------------------------------------------------- #
class TestFollows:
    def test_following_feed_matches_only_followed_things(
        self, client: TestClient, db: Session
    ) -> None:
        cinema = cat(db, "cinema")
        sports = cat(db, "sports")
        guntur = db.execute(select(District).where(District.slug == "guntur")).scalar_one()

        followed_cat = make_article(db, title_te="సినిమా ఫాలో", category=cinema)
        followed_place = make_article(db, title_te="గుంటూరు ఫాలో", district_id=guntur.id)
        make_article(db, title_te="సంబంధం లేని క్రీడలు", category=sports)
        db.commit()

        headers = reader_headers(client, "9848010007")
        assert client.post(
            "/api/v1/follow", json={"target_type": "category", "slug": "cinema"}, headers=headers
        ).json()["following"] is True
        client.post(
            "/api/v1/follow", json={"target_type": "district", "slug": "guntur"}, headers=headers
        )

        follows = client.get("/api/v1/users/me/follows", headers=headers).json()["follows"]
        assert {f["slug"] for f in follows} == {"cinema", "guntur"}

        feed = client.get("/api/v1/users/me/following", headers=headers).json()
        ids = {a["short_id"] for a in feed["articles"]}
        assert followed_cat.short_id in ids
        assert followed_place.short_id in ids
        assert all(a["category"] is None or a["category"]["slug"] != "sports" for a in feed["articles"])

        # Unfollow the category — its story leaves the feed.
        client.request(
            "DELETE",
            "/api/v1/follow",
            json={"target_type": "category", "slug": "cinema"},
            headers=headers,
        )
        feed = client.get("/api/v1/users/me/following", headers=headers).json()
        ids = {a["short_id"] for a in feed["articles"]}
        assert followed_cat.short_id not in ids
        assert followed_place.short_id in ids

    def test_unknown_slug_is_404(self, client: TestClient, db: Session) -> None:
        headers = reader_headers(client, "9848010008")
        r = client.post(
            "/api/v1/follow", json={"target_type": "category", "slug": "no-such"}, headers=headers
        )
        assert r.status_code == 404


# --------------------------------------------------------------------------- #
# reading history (§11)
# --------------------------------------------------------------------------- #
class TestHistory:
    def test_history_lists_read_articles_with_progress(
        self, client: TestClient, db: Session
    ) -> None:
        article = make_article(db, title_te="చరిత్ర పరీక్ష")
        db.commit()
        headers = reader_headers(client, "9848010009")

        client.post(
            "/api/v1/public/events",
            json={
                "events": [
                    {"short_id": article.short_id, "type": "view"},
                    {"short_id": article.short_id, "type": "read", "value": 30},
                    {"short_id": article.short_id, "type": "scroll", "value": 65},
                ]
            },
            headers=headers,
        )

        history = client.get("/api/v1/users/me/history", headers=headers).json()
        assert history["items"], "history must not be empty after reading"
        top = history["items"][0]
        assert top["article"]["short_id"] == article.short_id
        assert top["seconds"] == 30
        assert top["max_scroll_pct"] == 65
