"""Phase D integration tests — trending (decay + spam dedup), pins with
expiry, publish-time notification fan-out, campaigns, and analytics."""

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

from app.core.deps import build_principal  # noqa: E402
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
from app.models.audit import AuditLog  # noqa: E402
from app.models.content import Article, Category  # noqa: E402
from app.models.discovery import Pin  # noqa: E402
from app.models.engagement import ArticleEvent, Follow  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    EventType,
    FollowTargetType,
    NotificationKind,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.geo import District  # noqa: E402
from app.models.notify import Notification  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service, notification_service, trending_service, workflow_service  # noqa: E402

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
                 is_breaking: bool = False,
                 status: ArticleStatus = ArticleStatus.PUBLISHED) -> Article:
    global _counter
    _counter += 1
    article = Article(
        short_id=f"d{_counter:05d}",
        slug=f"discovery-{_counter}",
        title_te=title_te,
        category_id=category.id if category else None,
        district_id=district_id,
        is_breaking=is_breaking,
        status=status,
        workflow_state=WorkflowState.PUBLISHED if status == ArticleStatus.PUBLISHED else WorkflowState.APPROVED,
        published_at=utcnow() - timedelta(minutes=minutes_ago) if status == ArticleStatus.PUBLISHED else None,
    )
    db.add(article)
    db.flush()
    return article


def add_event(db: Session, article: Article, *, event_type: EventType,
              anon_id: str | None = None, user_id: int | None = None,
              hours_ago: float = 0, value: int | None = None) -> None:
    db.add(ArticleEvent(
        article_id=article.id, user_id=user_id, anon_id=anon_id,
        event_type=event_type, value=value,
        created_at=utcnow() - timedelta(hours=hours_ago),
    ))


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


def make_staff(db: Session, *, role: RoleKey, email: str) -> User:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        role_row = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
        user = User(email=email, name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE)
        db.add(user)
        db.flush()
        db.add(UserRole(user_id=user.id, role_id=role_row.id, scope_type=ScopeType.GLOBAL))
        db.flush()
    db.refresh(user)
    return user


def staff_headers(db: Session, *, role: RoleKey, email: str) -> dict[str, str]:
    user = make_staff(db, role=role, email=email)
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}


def reader_headers(client: TestClient, phone: str) -> tuple[dict[str, str], int]:
    otp = client.post("/api/v1/auth/otp/request", json={"phone": phone}).json()["dev_otp"]
    r = client.post("/api/v1/auth/reader/otp/verify", json={"phone": phone, "otp": otp})
    assert r.status_code == 200, r.text
    return (
        {"Authorization": f"Bearer {r.json()['tokens']['access_token']}"},
        r.json()["me"]["user"]["id"],
    )


def cat(db: Session, slug: str) -> Category:
    return db.execute(select(Category).where(Category.slug == slug)).scalar_one()


def district(db: Session, slug: str) -> District:
    return db.execute(select(District).where(District.slug == slug)).scalar_one()


# --------------------------------------------------------------------------- #
# trending (§8)
# --------------------------------------------------------------------------- #
class TestTrending:
    def test_dedup_decay_and_order(self, client: TestClient, db: Session) -> None:
        cinema = cat(db, "cinema")
        hot = make_article(db, title_te="హాట్ కథనం", category=cinema)
        spam = make_article(db, title_te="స్పామ్ కథనం", category=cinema)
        old = make_article(db, title_te="పాత కథనం", category=cinema, minutes_ago=3000)

        # Three genuine readers engage with `hot` recently.
        for i in range(3):
            add_event(db, hot, event_type=EventType.VIEW, anon_id=f"reader-{i}", hours_ago=1)
        add_event(db, hot, event_type=EventType.LIKE, user_id=None, anon_id="reader-0", hours_ago=1)

        # One person hammers refresh on `spam` ten times.
        for _ in range(10):
            add_event(db, spam, event_type=EventType.VIEW, anon_id="refresher", hours_ago=1)

        # `old` had five readers, but 40 hours ago.
        for i in range(5):
            add_event(db, old, event_type=EventType.VIEW, anon_id=f"early-{i}", hours_ago=40)
        db.commit()

        scored = trending_service.compute_trending(db)
        db.commit()
        assert scored >= 3

        r = client.get("/api/v1/public/trending")
        assert r.status_code == 200
        order = [a["short_id"] for a in r.json()["articles"]]
        assert order.index(hot.short_id) < order.index(spam.short_id), \
            "3 unique readers must outrank 10 refreshes by one person"
        assert order.index(hot.short_id) < order.index(old.short_id), \
            "recent engagement must outrank decayed engagement"

    def test_scoped_trending(self, client: TestClient, db: Session) -> None:
        r = client.get("/api/v1/public/trending", params={"category": "cinema"})
        assert r.status_code == 200
        assert r.json()["articles"], "category-scoped trending must have the cinema stories"

    def test_drafts_never_trend(self, client: TestClient, db: Session) -> None:
        draft = make_article(db, title_te="డ్రాఫ్ట్", status=ArticleStatus.DRAFT)
        for i in range(5):
            add_event(db, draft, event_type=EventType.VIEW, anon_id=f"cms-{i}")
        db.commit()
        trending_service.compute_trending(db)
        db.commit()
        r = client.get("/api/v1/public/trending")
        assert all(a["short_id"] != draft.short_id for a in r.json()["articles"])


# --------------------------------------------------------------------------- #
# pins (§9)
# --------------------------------------------------------------------------- #
class TestPins:
    def test_home_pin_takes_the_lead_and_expiry_releases_it(
        self, client: TestClient, db: Session
    ) -> None:
        pinned = make_article(db, title_te="పిన్ చేసిన కథనం", minutes_ago=5000)
        make_article(db, title_te="తాజా కథనం", minutes_ago=1)
        db.commit()
        editor = staff_headers(db, role=RoleKey.DESK_EDITOR, email="pins@test.example.com")

        r = client.post(
            "/api/v1/cms/pins",
            json={"article_id": pinned.id, "placement": "home", "duration_minutes": 360},
            headers=editor,
        )
        assert r.status_code == 201, r.text
        pin_id = r.json()["id"]

        home = client.get("/api/v1/public/home").json()
        assert home["lead"]["short_id"] == pinned.short_id, "an active home pin owns the lead slot"

        # §9/§1.3 — force-expire and the slot must release immediately.
        pin = db.get(Pin, pin_id)
        pin.ends_at = utcnow() - timedelta(minutes=1)
        db.commit()
        home = client.get("/api/v1/public/home").json()
        assert home["lead"]["short_id"] != pinned.short_id

        audit = db.execute(
            select(AuditLog).where(AuditLog.entity_type == "pin", AuditLog.entity_id == str(pin_id))
        ).scalars().all()
        assert audit, "§9 requires a pin audit trail"

    def test_pinning_requires_publish_permission(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="అనుమతి పరీక్ష")
        db.commit()
        reporter = staff_headers(db, role=RoleKey.REPORTER, email="pins-reporter@test.example.com")
        r = client.post(
            "/api/v1/cms/pins",
            json={"article_id": article.id, "placement": "home"},
            headers=reporter,
        )
        assert r.status_code == 403

    def test_unpin_ends_now(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="అన్‌పిన్ పరీక్ష")
        db.commit()
        editor = staff_headers(db, role=RoleKey.DESK_EDITOR, email="pins@test.example.com")
        pin_id = client.post(
            "/api/v1/cms/pins",
            json={"article_id": article.id, "placement": "home", "duration_minutes": 1440},
            headers=editor,
        ).json()["id"]
        r = client.delete(f"/api/v1/cms/pins/{pin_id}", headers=editor)
        assert r.status_code == 200
        pin = db.get(Pin, pin_id)
        db.refresh(pin)
        assert pin.ends_at <= utcnow()


# --------------------------------------------------------------------------- #
# notifications (§13)
# --------------------------------------------------------------------------- #
class TestNotifications:
    def test_publish_fan_out_breaking_local_topic_priority(
        self, client: TestClient, db: Session
    ) -> None:
        guntur = district(db, "guntur")
        _h, follower_id = reader_headers(client, "9848020001")
        db.add(Follow(user_id=follower_id, target_type=FollowTargetType.DISTRICT,
                      target_id=guntur.id, created_at=utcnow()))
        _h2, plain_id = reader_headers(client, "9848020002")
        db.commit()

        # A breaking Guntur story: both readers get exactly one notification —
        # the follower's is BREAKING (priority), not a second LOCAL.
        breaking = make_article(db, title_te="బ్రేకింగ్ గుంటూరు",
                                district_id=guntur.id, is_breaking=True)
        total = notification_service.fan_out_for_article(db, breaking)
        db.commit()
        assert total >= 2
        mine = db.execute(select(Notification).where(
            Notification.user_id == follower_id, Notification.article_id == breaking.id
        )).scalars().all()
        assert len(mine) == 1 and mine[0].kind == NotificationKind.BREAKING

        # A normal Guntur story notifies only the follower, as LOCAL.
        local = make_article(db, title_te="గుంటూరు వార్త", district_id=guntur.id)
        notification_service.fan_out_for_article(db, local)
        db.commit()
        follower_rows = db.execute(select(Notification).where(
            Notification.user_id == follower_id, Notification.article_id == local.id
        )).scalars().all()
        plain_rows = db.execute(select(Notification).where(
            Notification.user_id == plain_id, Notification.article_id == local.id
        )).scalars().all()
        assert len(follower_rows) == 1 and follower_rows[0].kind == NotificationKind.LOCAL
        assert plain_rows == []

    def test_publish_transition_triggers_fanout(self, client: TestClient, db: Session) -> None:
        guntur = district(db, "guntur")
        _h, follower_id = reader_headers(client, "9848020003")
        db.add(Follow(user_id=follower_id, target_type=FollowTargetType.DISTRICT,
                      target_id=guntur.id, created_at=utcnow()))

        author = make_staff(db, role=RoleKey.REPORTER, email="fanout-author@test.example.com")
        editor = make_staff(db, role=RoleKey.DESK_EDITOR, email="fanout-editor@test.example.com")
        article = make_article(db, title_te="వర్క్‌ఫ్లో ఫ్యాన్అవుట్",
                               district_id=guntur.id, status=ArticleStatus.DRAFT)
        article.status = ArticleStatus.PENDING
        article.workflow_state = WorkflowState.APPROVED
        article.author_id = author.id
        article.approved_by = editor.id
        db.commit()

        principal = build_principal(editor, "test-session")
        workflow_service.transition(db, principal, article, "publish", None)
        db.commit()

        rows = db.execute(select(Notification).where(
            Notification.user_id == follower_id, Notification.article_id == article.id
        )).scalars().all()
        assert len(rows) == 1, "publishing must fan out §13 notifications"

    def test_inbox_and_mark_read(self, client: TestClient, db: Session) -> None:
        headers, user_id = reader_headers(client, "9848020004")
        db.add(Notification(user_id=user_id, kind=NotificationKind.SYSTEM,
                            title_te="పరీక్ష ప్రకటన", created_at=utcnow()))
        db.commit()

        inbox = client.get("/api/v1/users/me/notifications", headers=headers).json()
        assert inbox["unread"] >= 1
        assert any(n["title_te"] == "పరీక్ష ప్రకటన" for n in inbox["items"])

        r = client.post("/api/v1/users/me/notifications/read", json={}, headers=headers)
        assert r.status_code == 200
        assert client.get("/api/v1/users/me/notifications", headers=headers).json()["unread"] == 0

    def test_campaign_send_and_permission(self, client: TestClient, db: Session) -> None:
        _h, follower_id = reader_headers(client, "9848020005")
        guntur = district(db, "guntur")
        db.add(Follow(user_id=follower_id, target_type=FollowTargetType.DISTRICT,
                      target_id=guntur.id, created_at=utcnow()))
        db.commit()

        editor = staff_headers(db, role=RoleKey.DESK_EDITOR, email="campaign@test.example.com")
        r = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "గుంటూరు ప్రత్యేక ప్రకటన", "audience": "district:guntur"},
            headers=editor,
        )
        assert r.status_code == 201, r.text
        assert r.json()["sent_count"] >= 1

        moderator = staff_headers(db, role=RoleKey.MODERATOR, email="mod-campaign@test.example.com")
        r2 = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "అనుమతి లేని ప్రకటన", "audience": "all"},
            headers=moderator,
        )
        assert r2.status_code == 403

    def test_device_registration(self, client: TestClient, db: Session) -> None:
        headers, _uid = reader_headers(client, "9848020006")
        r = client.post(
            "/api/v1/users/me/devices",
            json={"token": "fcm-token-abcdef123456", "platform": "android"},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["ok"] is True


# --------------------------------------------------------------------------- #
# analytics (§25)
# --------------------------------------------------------------------------- #
class TestAnalytics:
    def test_analytics_summary(self, client: TestClient, db: Session) -> None:
        article = make_article(db, title_te="విశ్లేషణ కథనం")
        db.commit()
        # Two readers produce reading sessions through the real beacon.
        for anon in ("stats-1", "stats-2"):
            client.post("/api/v1/public/events", json={
                "anon_id": anon,
                "events": [
                    {"short_id": article.short_id, "type": "view"},
                    {"short_id": article.short_id, "type": "read", "value": 45},
                ],
            })

        eic = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="analytics@test.example.com")
        r = client.get("/api/v1/cms/analytics", headers=eic)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dau"] >= 2
        assert body["reads_7d"] >= 2
        assert any(a["short_id"] == article.short_id for a in body["top_articles_7d"])

    def test_analytics_requires_permission(self, client: TestClient, db: Session) -> None:
        reporter = staff_headers(db, role=RoleKey.REPORTER, email="analytics-rep@test.example.com")
        assert client.get("/api/v1/cms/analytics", headers=reporter).status_code == 403
