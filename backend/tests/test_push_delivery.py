"""Push delivery: anonymous installs, audiences, scheduling, the Expo dispatch
and its stats. `_post` is always faked — nothing here may reach Expo."""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import create_engine, delete, select, update
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
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.engagement import Follow  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    FollowTargetType,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.geo import District  # noqa: E402
from app.models.notify import Notification, NotificationCampaign, PushDevice  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service, notification_service, settings_service  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
_counter = 0


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    seed_roles(session, seed_permissions(session))
    seed_states(session)
    seed_districts(session)
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
def clean(db: Session) -> None:
    """Each test starts with no devices and nothing waiting to be pushed."""
    settings_service.invalidate()
    db.execute(delete(PushDevice))
    db.execute(
        update(NotificationCampaign)
        .where(NotificationCampaign.status.in_(("scheduled", "queued")))
        .values(status="cancelled")
    )
    db.commit()


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """Every message handed to Expo; a token ending in 'dead]' is unregistered."""
    messages: list[dict] = []

    def fake_post(batch: list[dict], access_token: str) -> list[dict]:
        messages.extend(batch)
        return [
            {"status": "error", "details": {"error": "DeviceNotRegistered"}}
            if m["to"].endswith("dead]")
            else {"status": "ok", "id": "ticket"}
            for m in batch
        ]

    monkeypatch.setattr(notification_service, "_post", fake_post)
    return messages


def district(db: Session, slug: str) -> District:
    return db.execute(select(District).where(District.slug == slug)).scalar_one()


def other_district(db: Session) -> District:
    return db.execute(
        select(District).where(District.slug != "guntur").limit(1)
    ).scalar_one()


def editor_headers(db: Session) -> dict[str, str]:
    email = "push-editor@test.example.com"
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        role = db.execute(select(Role).where(Role.key == RoleKey.DESK_EDITOR.value)).scalar_one()
        user = User(email=email, name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE)
        db.add(user)
        db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id, scope_type=ScopeType.GLOBAL))
        db.flush()
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


def register(client: TestClient, token: str, district_slug: str | None = None,
             headers: dict[str, str] | None = None) -> None:
    r = client.post(
        "/api/v1/users/me/devices",
        json={"token": token, "platform": "android", "district_slug": district_slug},
        headers=headers or {},
    )
    assert r.status_code == 200, r.text


def make_article(db: Session, *, district_id: int | None = None,
                 is_breaking: bool = False) -> Article:
    global _counter
    _counter += 1
    article = Article(
        short_id=f"p-{_counter:04d}",  # a '-' inside, which the app must not split on
        slug=f"push-{_counter}",
        title_te="పుష్ కథనం",
        district_id=district_id,
        is_breaking=is_breaking,
        status=ArticleStatus.PUBLISHED,
        workflow_state=WorkflowState.PUBLISHED,
        published_at=utcnow(),
    )
    db.add(article)
    db.flush()
    return article


class TestPushDelivery:
    def test_anonymous_install_registers_with_its_district(
        self, client: TestClient, db: Session
    ) -> None:
        register(client, "ExponentPushToken[anon-guntur]", "guntur")
        device = db.execute(
            select(PushDevice).where(PushDevice.token == "ExponentPushToken[anon-guntur]")
        ).scalar_one()
        assert device.user_id is None
        assert device.district_id == district(db, "guntur").id

        # Signing in claims the token; signing out hands it back.
        headers, user_id = reader_headers(client, "9848030001")
        register(client, "ExponentPushToken[anon-guntur]", "guntur", headers)
        db.refresh(device)
        assert device.user_id == user_id
        register(client, "ExponentPushToken[anon-guntur]", None)
        db.refresh(device)
        assert device.user_id is None and device.district_id is None

    def test_all_counts_tickets_prunes_dead_tokens_and_reaches_anonymous(
        self, client: TestClient, db: Session, sent: list[dict]
    ) -> None:
        headers, _uid = reader_headers(client, "9848030002")
        register(client, "ExponentPushToken[signed-in]", None, headers)
        register(client, "ExponentPushToken[anon-ok]")
        register(client, "ExponentPushToken[anon-dead]")
        article = make_article(db)
        db.commit()

        r = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "అందరికీ ప్రకటన", "audience": "all", "short_id": article.short_id},
            headers=editor_headers(db),
        )
        assert r.status_code == 201, r.text
        assert r.json()["status"] == "queued"
        campaign_id = r.json()["id"]

        notification_service.dispatch_due(db)
        campaign = db.get(NotificationCampaign, campaign_id)
        db.refresh(campaign)
        assert {m["to"] for m in sent} == {
            "ExponentPushToken[signed-in]",
            "ExponentPushToken[anon-ok]",
            "ExponentPushToken[anon-dead]",
        }
        assert sent[0]["data"] == {"campaign_id": campaign_id, "short_id": article.short_id}
        assert (campaign.status, campaign.devices) == ("sent", 3)
        assert (campaign.push_ok, campaign.push_failed) == (2, 1)
        assert db.scalar(
            select(PushDevice.id).where(PushDevice.token == "ExponentPushToken[anon-dead]")
        ) is None

        # The inbox carries the short id, whole.
        inbox = client.get("/api/v1/users/me/notifications", headers=headers).json()
        assert any(n["short_id"] == article.short_id for n in inbox["items"])

        log = client.get("/api/v1/cms/notifications", headers=editor_headers(db)).json()
        assert log["devices_registered"]["total"] == 2
        assert log["devices_registered"]["anonymous"] == 1
        row = next(c for c in log["items"] if c["id"] == campaign_id)
        assert (row["push_ok"], row["push_failed"]) == (2, 1)

    def test_district_audience_reaches_matching_anonymous_devices(
        self, client: TestClient, db: Session, sent: list[dict]
    ) -> None:
        register(client, "ExponentPushToken[in-guntur]", "guntur")
        register(client, "ExponentPushToken[elsewhere]", other_district(db).slug)
        r = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "గుంటూరు ప్రకటన", "audience": "district:guntur"},
            headers=editor_headers(db),
        )
        assert r.status_code == 201, r.text
        notification_service.dispatch_due(db)
        assert [m["to"] for m in sent] == ["ExponentPushToken[in-guntur]"]

    def test_tag_audience_is_validated(self, client: TestClient, db: Session) -> None:
        r = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "ట్యాగ్ ప్రకటన", "audience": "tag:no-such-tag"},
            headers=editor_headers(db),
        )
        assert r.status_code == 422

    def test_scheduled_campaign_waits_for_its_time(
        self, client: TestClient, db: Session, sent: list[dict]
    ) -> None:
        _h, follower = reader_headers(client, "9848030003")
        db.add(Follow(user_id=follower, target_type=FollowTargetType.DISTRICT,
                      target_id=district(db, "guntur").id, created_at=utcnow()))
        db.commit()
        register(client, "ExponentPushToken[scheduled]", "guntur")

        send_at = utcnow() + timedelta(hours=1)
        r = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "రేపటి ప్రకటన", "audience": "district:guntur",
                  "send_at": send_at.isoformat()},
            headers=editor_headers(db),
        )
        assert r.status_code == 201, r.text
        assert (r.json()["status"], r.json()["sent_count"]) == ("scheduled", 0)
        campaign_id = r.json()["id"]

        notification_service.dispatch_due(db)  # not due yet
        rows = select(Notification).where(Notification.campaign_id == campaign_id)
        assert db.execute(rows).scalars().all() == [] and sent == []

        notification_service.dispatch_due(db, now=send_at + timedelta(minutes=1))
        campaign = db.get(NotificationCampaign, campaign_id)
        db.refresh(campaign)
        assert campaign.status == "sent" and campaign.sent_count >= 1
        assert [n.user_id for n in db.execute(rows).scalars()] == [follower]
        assert [m["to"] for m in sent] == ["ExponentPushToken[scheduled]"]

    def test_cancel_a_scheduled_campaign(
        self, client: TestClient, db: Session, sent: list[dict]
    ) -> None:
        register(client, "ExponentPushToken[cancelled]")
        headers = editor_headers(db)
        send_at = utcnow() + timedelta(hours=1)
        campaign_id = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "రద్దయ్యే ప్రకటన", "audience": "all", "send_at": send_at.isoformat()},
            headers=headers,
        ).json()["id"]

        assert client.delete(f"/api/v1/cms/notifications/{campaign_id}", headers=headers).status_code == 200
        assert client.delete(f"/api/v1/cms/notifications/{campaign_id}", headers=headers).status_code == 409
        notification_service.dispatch_due(db, now=send_at + timedelta(minutes=1))
        assert sent == []
        assert db.get(NotificationCampaign, campaign_id).status == "cancelled"

    def test_opened_counter(self, client: TestClient, db: Session) -> None:
        campaign_id = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "తెరిచిన ప్రకటన", "audience": "all"},
            headers=editor_headers(db),
        ).json()["id"]
        for _ in range(2):
            assert client.post(f"/api/v1/notifications/{campaign_id}/opened").status_code == 200
        campaign = db.get(NotificationCampaign, campaign_id)
        db.refresh(campaign)
        assert campaign.opened == 2

    def test_publish_fan_out_pushes_anonymous_installs(
        self, client: TestClient, db: Session, sent: list[dict]
    ) -> None:
        guntur = district(db, "guntur")
        register(client, "ExponentPushToken[fan-guntur]", "guntur")
        register(client, "ExponentPushToken[fan-elsewhere]", other_district(db).slug)

        local = make_article(db, district_id=guntur.id)
        notification_service.fan_out_for_article(db, local)
        db.commit()
        notification_service.dispatch_due(db)
        assert [m["to"] for m in sent] == ["ExponentPushToken[fan-guntur]"]
        assert db.scalar(
            select(NotificationCampaign.audience).where(NotificationCampaign.article_id == local.id)
        ) == "auto:local"

        # Breaking reaches every anonymous install once — not again as local.
        sent.clear()
        breaking = make_article(db, district_id=guntur.id, is_breaking=True)
        notification_service.fan_out_for_article(db, breaking)
        db.commit()
        notification_service.dispatch_due(db)
        assert sorted(m["to"] for m in sent) == [
            "ExponentPushToken[fan-elsewhere]",
            "ExponentPushToken[fan-guntur]",
        ]
        assert all(m["data"]["short_id"] == breaking.short_id for m in sent)

    def test_only_expo_tokens_register(self, client: TestClient) -> None:
        r = client.post("/api/v1/users/me/devices", json={"token": "fcm-token-abcdef123456"})
        assert r.status_code == 422

    def test_other_projects_token_is_dropped_and_the_batch_resent(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        register(client, "ExponentPushToken[ours-1]")
        register(client, "ExponentPushToken[ours-2]")
        register(client, "ExponentPushToken[theirs]")
        calls: list[list[str]] = []

        def fake_post(batch: list[dict], access_token: str) -> list[dict]:
            to = [m["to"] for m in batch]
            calls.append(to)
            if "ExponentPushToken[theirs]" in to:
                request = httpx.Request("POST", notification_service.EXPO_PUSH_URL)
                response = httpx.Response(400, request=request, json={"errors": [{
                    "code": "PUSH_TOO_MANY_EXPERIENCE_IDS",
                    "details": {
                        "@us/app": ["ExponentPushToken[ours-1]", "ExponentPushToken[ours-2]"],
                        "@them/app": ["ExponentPushToken[theirs]"],
                    },
                }]})
                raise httpx.HTTPStatusError("400", request=request, response=response)
            return [{"status": "ok"} for _ in batch]

        monkeypatch.setattr(notification_service, "_post", fake_post)
        campaign_id = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "మిశ్రమ బ్యాచ్", "audience": "all"},
            headers=editor_headers(db),
        ).json()["id"]
        notification_service.dispatch_due(db)
        campaign = db.get(NotificationCampaign, campaign_id)
        db.refresh(campaign)
        assert calls[1] == ["ExponentPushToken[ours-1]", "ExponentPushToken[ours-2]"]
        assert (campaign.devices, campaign.push_ok, campaign.push_failed) == (3, 2, 1)
        assert db.scalar(
            select(PushDevice.id).where(PushDevice.token == "ExponentPushToken[theirs]")
        ) is None

    def test_a_past_send_at_is_refused_not_sent_now(
        self, client: TestClient, db: Session
    ) -> None:
        r = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "గడిచిన సమయం", "audience": "all",
                  "send_at": (utcnow() - timedelta(minutes=5)).isoformat()},
            headers=editor_headers(db),
        )
        assert r.status_code == 422

    def test_log_pins_scheduled_and_splits_auto_from_manual(
        self, client: TestClient, db: Session
    ) -> None:
        headers = editor_headers(db)
        scheduled_id = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "రేపటి షెడ్యూల్", "audience": "all",
                  "send_at": (utcnow() + timedelta(days=1)).isoformat()},
            headers=headers,
        ).json()["id"]
        # Publish-time alerts logged after it must not push it off page one.
        register(client, "ExponentPushToken[log-anon]")
        for _ in range(3):
            notification_service.fan_out_for_article(db, make_article(db, is_breaking=True))
        db.commit()

        page = client.get("/api/v1/cms/notifications?limit=2", headers=headers).json()
        assert page["items"][0]["id"] == scheduled_id and page["next_offset"] == 2
        manual = client.get("/api/v1/cms/notifications?source=manual", headers=headers).json()
        auto = client.get("/api/v1/cms/notifications?source=auto", headers=headers).json()
        assert not any(c["audience"].startswith("auto:") for c in manual["items"])
        assert auto["items"] and all(c["audience"].startswith("auto:") for c in auto["items"])

    def test_push_switched_off_sends_nothing(
        self, client: TestClient, db: Session, sent: list[dict]
    ) -> None:
        register(client, "ExponentPushToken[switched-off]")
        queued_id = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "ముందే క్యూలో", "audience": "all"},
            headers=editor_headers(db),
        ).json()["id"]

        settings_service.set_many(db, {"push.enabled": False}, None)
        db.commit()
        settings_service.invalidate()
        try:
            r = client.post(
                "/api/v1/cms/notifications",
                json={"title_te": "ఇన్‌బాక్స్ మాత్రమే", "audience": "all"},
                headers=editor_headers(db),
            )
            # Created while off: inbox-only, never queued, so no backlog later.
            assert r.json()["status"] == "sent"
            assert notification_service.dispatch_due(db) == {"released": 0, "pushed": 0}
            assert sent == []
            assert db.get(NotificationCampaign, queued_id).status == "queued"
        finally:
            settings_service.set_many(db, {"push.enabled": True}, None)
            db.commit()
            settings_service.invalidate()
