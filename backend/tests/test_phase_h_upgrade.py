"""Phase H integration tests for the 37-section upgrade.

Covers the parts of §1–§35 that landed in this phase: the full article form,
the editable settings store, reader email accounts, article types and the
pending queue, breaking/pin duration control, server-side TTS, and the AI
pipeline.

The AI tests are the ones that matter most. Two of them exist specifically to
fail if anyone ever loosens the review gate:
`test_ai_draft_converts_to_submitted_never_published` and
`test_ai_publish_without_review_permission_does_not_exist`.
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
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.ai import AiArticleDraft, AiSuggestion  # noqa: E402
from app.models.content import Article, Category  # noqa: E402
from app.models.enums import (  # noqa: E402
    AiSuggestionStatus,
    ArticleStatus,
    ArticleType,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.geo import District, Mandal  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service, settings_service  # noqa: E402

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


BODY_TE = (
    "విజయవాడ నగరంలో కొత్త మెట్రో మార్గం పనులు ప్రారంభమయ్యాయి. "
    "మొదటి దశలో పన్నెండు స్టేషన్లు నిర్మిస్తారని అధికారులు తెలిపారు."
)


def body_doc(text: str) -> dict:
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


# --------------------------------------------------------------------------- #
# §1 / §2 — the complete article form
# --------------------------------------------------------------------------- #
class TestArticleForm:
    def test_every_spec_field_round_trips(self, client: TestClient, db: Session) -> None:
        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-editor@test.example.com")
        category = db.execute(select(Category).where(Category.slug == "andhra-pradesh")).scalar_one()
        district = db.execute(select(District).where(District.slug == "krishna")).scalar_one()
        mandal = db.execute(
            select(Mandal).where(Mandal.district_id == district.id)).scalars().first()

        payload = {
            "title_te": "విజయవాడలో మెట్రో పనులు ప్రారంభం",
            "title_en": "Metro work begins in Vijayawada",
            "sub_title_te": "మొదటి దశలో పన్నెండు స్టేషన్లు",
            "summary_te": "నగర రవాణాలో కీలక మార్పు.",
            "body": body_doc(BODY_TE),
            "category_id": category.id,
            "district_id": district.id,
            "mandal_id": mandal.id if mandal else None,
            "tags": ["మెట్రో", "విజయవాడ"],
            "byline_te": "మా ప్రతినిధి",
            "source_type": "own",
            "is_exclusive": True,
            "is_featured": True,
            "voice_enabled": True,
            "seo_title": "Vijayawada metro construction begins",
            "seo_description": "Phase one covers twelve stations.",
            "slug": "vijayawada-metro-work-begins",
        }
        created = client.post("/api/v1/cms/articles", json=payload, headers=editor)
        assert created.status_code == 201, created.text
        row = created.json()

        assert row["slug"] == "vijayawada-metro-work-begins"
        assert row["is_featured"] is True
        assert row["seo_title"] == "Vijayawada metro construction begins"
        assert row["mandal_id"] == (mandal.id if mandal else None)
        assert {t["name_te"] for t in row["tags"]} == {"మెట్రో", "విజయవాడ"}
        # §23 default for a globally-scoped desk editor.
        assert row["article_type"] == ArticleType.NORMAL.value

        fetched = client.get(f"/api/v1/cms/articles/{row['id']}", headers=editor).json()
        assert fetched["sub_title_te"] == "మొదటి దశలో పన్నెండు స్టేషన్లు"
        assert len(fetched["tags"]) == 2

    def test_mandal_outside_district_is_rejected(self, client: TestClient, db: Session) -> None:
        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-editor@test.example.com")
        krishna = db.execute(select(District).where(District.slug == "krishna")).scalar_one()
        other = db.execute(select(District).where(District.slug != "krishna")).scalars().first()
        foreign_mandal = db.execute(
            select(Mandal).where(Mandal.district_id == other.id)).scalars().first()
        if foreign_mandal is None:
            pytest.skip("seed has no second district with mandals")

        r = client.post("/api/v1/cms/articles", json={
            "title_te": "తప్పు మండలం పరీక్ష",
            "body": body_doc(BODY_TE),
            "district_id": krishna.id,
            "mandal_id": foreign_mandal.id,
        }, headers=editor)
        assert r.status_code == 422
        assert "mandal_id" in r.json()["error"]["details"]

    def test_subcategory_must_belong_to_its_parent(self, client: TestClient, db: Session) -> None:
        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-editor@test.example.com")
        parent = db.execute(select(Category).where(Category.slug == "cinema")).scalar_one()
        unrelated = db.execute(select(Category).where(Category.slug == "sports")).scalar_one()

        r = client.post("/api/v1/cms/articles", json={
            "title_te": "ఉప విభాగం పరీక్ష",
            "body": body_doc(BODY_TE),
            "category_id": parent.id,
            "subcategory_id": unrelated.id,
        }, headers=editor)
        assert r.status_code == 422
        assert "subcategory_id" in r.json()["error"]["details"]

    def test_youtube_url_links_a_video(self, client: TestClient, db: Session) -> None:
        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-editor@test.example.com")
        r = client.post("/api/v1/cms/articles", json={
            "title_te": "వీడియో జోడించిన కథనం",
            "body": body_doc(BODY_TE),
            "video_youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }, headers=editor)
        assert r.status_code == 201, r.text
        assert r.json()["video"]["youtube_id"] == "dQw4w9WgXcQ"

    def test_editor_options_expose_the_cascade(self, client: TestClient, db: Session) -> None:
        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-editor@test.example.com")
        options = client.get("/api/v1/cms/dashboard/editor-options", headers=editor).json()
        assert options["states"], "§2 needs a state level"
        assert all("parent_id" in c for c in options["categories"])
        assert all("state" in d for d in options["districts"])

        district = db.execute(select(District).where(District.slug == "krishna")).scalar_one()
        mandals = client.get("/api/v1/cms/dashboard/mandals",
                             params={"district_id": district.id}, headers=editor).json()
        assert "items" in mandals


# --------------------------------------------------------------------------- #
# §18 / §20 / §35 — editable settings
# --------------------------------------------------------------------------- #
class TestSettings:
    def test_defaults_are_off_until_an_admin_acts(self, client: TestClient, db: Session) -> None:
        admin = staff_headers(db, role=RoleKey.ADMIN, email="h-admin@test.example.com")
        body = client.get("/api/v1/cms/settings", headers=admin).json()
        assert body["values"]["ai.enabled"] is False
        assert body["values"]["voice.enabled"] is False
        assert body["values"]["feed.ratios"]["personal"] == 40

    def test_admin_can_change_a_setting(self, client: TestClient, db: Session) -> None:
        admin = staff_headers(db, role=RoleKey.ADMIN, email="h-admin@test.example.com")
        r = client.patch("/api/v1/cms/settings",
                         json={"values": {"voice.enabled": True}}, headers=admin)
        assert r.status_code == 200, r.text
        assert r.json()["values"]["voice.enabled"] is True

        client.patch("/api/v1/cms/settings",
                     json={"values": {"voice.enabled": False}}, headers=admin)

    def test_ratios_must_total_one_hundred(self, client: TestClient, db: Session) -> None:
        admin = staff_headers(db, role=RoleKey.ADMIN, email="h-admin@test.example.com")
        r = client.patch("/api/v1/cms/settings", json={"values": {
            "feed.ratios": {"personal": 50, "local": 25, "trending": 25, "breaking": 10}
        }}, headers=admin)
        assert r.status_code == 422
        assert "total 100" in str(r.json()["error"]["details"])

    def test_unknown_keys_are_refused(self, client: TestClient, db: Session) -> None:
        admin = staff_headers(db, role=RoleKey.ADMIN, email="h-admin@test.example.com")
        r = client.patch("/api/v1/cms/settings",
                         json={"values": {"ai.publish_without_review": True}}, headers=admin)
        assert r.status_code == 422

    def test_a_reporter_cannot_change_settings(self, client: TestClient, db: Session) -> None:
        reporter = staff_headers(db, role=RoleKey.REPORTER, email="h-reporter@test.example.com")
        r = client.patch("/api/v1/cms/settings",
                         json={"values": {"ai.enabled": True}}, headers=reporter)
        assert r.status_code == 403


# --------------------------------------------------------------------------- #
# §4 / §5 — reader accounts
# --------------------------------------------------------------------------- #
class TestReaderAccounts:
    def test_register_login_and_profile(self, client: TestClient, db: Session) -> None:
        r = client.post("/api/v1/auth/register", json={
            "name": "రమేష్",
            "email": "ramesh@reader.example.com",
            "password": "correct horse battery",
            "confirm_password": "correct horse battery",
        })
        assert r.status_code == 201, r.text
        assert r.json()["is_new_account"] is True
        token = r.json()["tokens"]["access_token"]

        me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
        assert me["user"]["email"] == "ramesh@reader.example.com"
        assert me["user"]["email_verified_at"] is None
        assert me["permissions"] == [] or "article.publish" not in me["permissions"]

        again = client.post("/api/v1/auth/login", json={
            "email": "ramesh@reader.example.com",
            "password": "correct horse battery",
        })
        assert again.status_code == 200, again.text

    def test_mismatched_confirmation_is_rejected(self, client: TestClient) -> None:
        r = client.post("/api/v1/auth/register", json={
            "name": "తప్పు",
            "email": "mismatch@reader.example.com",
            "password": "correct horse battery",
            "confirm_password": "different password",
        })
        assert r.status_code == 422

    def test_duplicate_email_is_rejected(self, client: TestClient) -> None:
        r = client.post("/api/v1/auth/register", json={
            "name": "రమేష్ 2",
            "email": "ramesh@reader.example.com",
            "password": "another good password",
            "confirm_password": "another good password",
        })
        assert r.status_code == 422

    def test_otp_reader_gets_phone_marked_verified(self, client: TestClient, db: Session) -> None:
        phone = "9848070001"
        otp = client.post("/api/v1/auth/otp/request", json={"phone": phone}).json()["dev_otp"]
        r = client.post("/api/v1/auth/reader/otp/verify", json={"phone": phone, "otp": otp})
        assert r.status_code == 200, r.text
        assert r.json()["me"]["user"]["phone_verified_at"] is not None


# --------------------------------------------------------------------------- #
# §7 / §23 / §25 — article types and the pending queue
# --------------------------------------------------------------------------- #
class TestPendingQueue:
    def test_queue_filters_by_type(self, client: TestClient, db: Session) -> None:
        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-editor@test.example.com")
        created = client.post("/api/v1/cms/articles", json={
            "title_te": "సమీక్ష కోసం పంపిన కథనం",
            "body": body_doc(BODY_TE),
        }, headers=editor)
        article_id = created.json()["id"]
        client.post(f"/api/v1/cms/articles/{article_id}/submit", json={}, headers=editor)

        queue = client.get("/api/v1/cms/articles/pending", headers=editor).json()
        assert any(a["id"] == article_id for a in queue["articles"])

        typed = client.get("/api/v1/cms/articles/pending",
                           params={"article_type": "NORMAL"}, headers=editor).json()
        assert all(a["article_type"] == "NORMAL" for a in typed["articles"])

        none_match = client.get("/api/v1/cms/articles/pending",
                                params={"article_type": "AI_SUGGESTED"}, headers=editor).json()
        assert none_match["total"] == 0

    def test_editors_cannot_hand_set_an_ai_type(self, client: TestClient, db: Session) -> None:
        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-editor@test.example.com")
        r = client.post("/api/v1/cms/articles", json={
            "title_te": "AI అని చెప్పుకునే కథనం",
            "body": body_doc(BODY_TE),
            "article_type": "AI_DRAFT",
        }, headers=editor)
        assert r.status_code == 422
        assert r.json()["error"]["details"]["article_type"] == "reserved"


# --------------------------------------------------------------------------- #
# §8 / §9 — pin presets, breaking duration
# --------------------------------------------------------------------------- #
class TestBreakingAndPins:
    def _published(self, client: TestClient, db: Session, title: str) -> dict:
        author = staff_headers(db, role=RoleKey.SUB_EDITOR, email="h-author@test.example.com")
        chief = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-chief@test.example.com")
        created = client.post("/api/v1/cms/articles", json={
            "title_te": title, "body": body_doc(BODY_TE),
        }, headers=author).json()
        client.post(f"/api/v1/cms/articles/{created['id']}/submit", json={}, headers=author)
        client.post(f"/api/v1/cms/articles/{created['id']}/approve", json={}, headers=chief)
        published = client.post(f"/api/v1/cms/articles/{created['id']}/publish",
                                json={}, headers=chief)
        assert published.status_code == 200, published.text
        return published.json()

    def test_five_minute_pin_reports_its_countdown(self, client: TestClient, db: Session) -> None:
        chief = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-chief@test.example.com")
        article = self._published(client, db, "పిన్ పరీక్ష కథనం")
        r = client.post("/api/v1/cms/pins", json={
            "article_id": article["id"], "placement": "home", "duration_minutes": 5,
        }, headers=chief)
        assert r.status_code == 201, r.text
        pin = r.json()
        assert 0 < pin["seconds_remaining"] <= 5 * 60

    def test_breaking_window_can_be_set_and_cleared(self, client: TestClient, db: Session) -> None:
        chief = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-chief@test.example.com")
        article = self._published(client, db, "బ్రేకింగ్ విండో పరీక్ష")

        opened = client.post(f"/api/v1/cms/articles/{article['id']}/breaking",
                             json={"minutes": 30}, headers=chief)
        assert opened.status_code == 200, opened.text
        assert opened.json()["is_breaking"] is True
        assert opened.json()["breaking_until"] is not None

        cleared = client.post(f"/api/v1/cms/articles/{article['id']}/breaking",
                              json={"clear": True}, headers=chief)
        assert cleared.json()["is_breaking"] is False
        assert cleared.json()["breaking_until"] is None

    def test_expired_breaking_window_leaves_the_ticker(
        self, client: TestClient, db: Session
    ) -> None:
        article = self._published(client, db, "గడువు ముగిసిన బ్రేకింగ్")
        row = db.get(Article, article["id"])
        row.is_breaking = True
        row.breaking_until = utcnow() - timedelta(minutes=1)
        db.commit()

        from app.core.redis_client import cache_delete_prefix

        cache_delete_prefix("breaking")
        ticker = client.get("/api/v1/public/breaking").json()
        assert all(item["short_id"] != row.short_id for item in ticker)


# --------------------------------------------------------------------------- #
# §19–21 — server-side TTS
# --------------------------------------------------------------------------- #
class TestVoice:
    def test_audio_is_unavailable_while_the_switch_is_off(
        self, client: TestClient, db: Session
    ) -> None:
        article = db.execute(select(Article).where(
            Article.status == ArticleStatus.PUBLISHED)).scalars().first()
        assert article is not None, "a published article is needed"
        r = client.get(f"/api/v1/public/articles/{article.short_id}/audio")
        assert r.status_code == 200
        body = r.json()
        assert body["available"] is False
        # Switched off means hidden, not "fall back to the device voice".
        assert body["fallback"] is None
        assert body["voice_enabled"] is False

    def test_no_provider_falls_back_to_the_device_voice(
        self, client: TestClient, db: Session
    ) -> None:
        admin = staff_headers(db, role=RoleKey.ADMIN, email="h-admin@test.example.com")
        client.patch("/api/v1/cms/settings",
                     json={"values": {"voice.enabled": True}}, headers=admin)
        settings_service.invalidate()

        article = db.execute(select(Article).where(
            Article.status == ArticleStatus.PUBLISHED)).scalars().first()
        r = client.get(f"/api/v1/public/articles/{article.short_id}/audio").json()
        # `local` cannot synthesise, so there is no file — but the reader still
        # gets a working Listen button through the device voice.
        assert r["available"] is False
        assert r["fallback"] == "device"
        assert r["voice_enabled"] is True

        client.patch("/api/v1/cms/settings",
                     json={"values": {"voice.enabled": False}}, headers=admin)
        settings_service.invalidate()

    def test_spoken_text_is_hashed_for_reuse(self, db: Session) -> None:
        from app.services import tts_service

        article = db.execute(select(Article).where(
            Article.status == ArticleStatus.PUBLISHED)).scalars().first()
        first = tts_service.content_hash(tts_service.spoken_text(article))
        second = tts_service.content_hash(tts_service.spoken_text(article))
        assert first == second, "§21 caching depends on a stable hash"

        article.title_te = article.title_te + " (సవరణ)"
        db.flush()
        assert tts_service.content_hash(tts_service.spoken_text(article)) != first


# --------------------------------------------------------------------------- #
# §15–18 — AI, and the gates around it
# --------------------------------------------------------------------------- #
class TestAi:
    def _enable_ai(self, client: TestClient, db: Session) -> dict[str, str]:
        admin = staff_headers(db, role=RoleKey.ADMIN, email="h-admin@test.example.com")
        client.patch("/api/v1/cms/settings",
                     json={"values": {"ai.enabled": True}}, headers=admin)
        settings_service.invalidate()
        return admin

    def test_ai_off_refuses_to_generate(self, client: TestClient, db: Session) -> None:
        admin = staff_headers(db, role=RoleKey.ADMIN, email="h-admin@test.example.com")
        client.patch("/api/v1/cms/settings",
                     json={"values": {"ai.enabled": False}}, headers=admin)
        settings_service.invalidate()
        r = client.post("/api/v1/cms/ai/suggestions/generate", json={}, headers=admin)
        assert r.status_code == 409

    def test_gap_analysis_produces_suggestions(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        admin = self._enable_ai(client, db)
        r = client.post("/api/v1/cms/ai/suggestions/generate", json={"limit": 5}, headers=admin)
        assert r.status_code == 201, r.text
        items = r.json()["items"]
        assert items, "the heuristic engine should always find a coverage gap"
        assert all(i["status"] == AiSuggestionStatus.NEW.value for i in items)
        # §17 — with no licensed feeds configured, nothing external is cited.
        assert all(i["sources"] == [] for i in items)

    def test_ai_draft_converts_to_submitted_never_published(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        admin = self._enable_ai(client, db)
        client.post("/api/v1/cms/ai/suggestions/generate", json={"limit": 3}, headers=admin)
        suggestion = db.execute(select(AiSuggestion)).scalars().first()
        assert suggestion is not None

        drafted = client.post(f"/api/v1/cms/ai/suggestions/{suggestion.id}/draft",
                              json={"notes": "ఎడిటర్ గమనికలు"}, headers=admin)
        assert drafted.status_code == 201, drafted.text
        draft_id = drafted.json()["id"]

        converted = client.post(f"/api/v1/cms/ai/drafts/{draft_id}/convert",
                                headers=admin)
        assert converted.status_code == 201, converted.text
        body = converted.json()

        # The whole point: it lands in review, flagged, and cannot be live.
        assert body["workflow_state"] == WorkflowState.SUBMITTED.value
        assert body["status"] != ArticleStatus.PUBLISHED.value

        article = db.get(Article, body["article_id"])
        assert article.ai_generated is True
        assert article.article_type == ArticleType.AI_DRAFT
        assert article.published_at is None

        draft = db.get(AiArticleDraft, draft_id)
        assert draft.requires_review is True

    def test_ai_publish_without_review_permission_does_not_exist(self, db: Session) -> None:
        """§15/§18 — the guarantee the whole AI design rests on."""
        from app.core.permissions import PERMISSIONS

        assert not any(p.key == "ai.publish_without_review" for p in PERMISSIONS)

        from app.models.user import Permission

        stored = db.execute(select(Permission).where(
            Permission.key == "ai.publish_without_review")).scalar_one_or_none()
        assert stored is None

    def test_no_ai_route_can_publish(self) -> None:
        """A stronger version of the rule above: no route under /cms/ai maps to
        a publish action at all, so the permission cannot be reached by URL."""
        ai_paths = [r.path for r in app.routes if "/cms/ai" in getattr(r, "path", "")]
        assert ai_paths, "the AI router should be mounted"
        assert not any("publish" in path for path in ai_paths)


# --------------------------------------------------------------------------- #
# §24 — the dashboard
# --------------------------------------------------------------------------- #
class TestDashboard:
    def test_fourteen_cards_are_present(self, client: TestClient, db: Session) -> None:
        chief = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-chief@test.example.com")
        stats = client.get("/api/v1/cms/dashboard", headers=chief).json()
        for key in ("total_articles", "drafts", "pending_review", "approved",
                    "published_today", "breaking_live", "returned_for_changes",
                    "scheduled", "total_users", "active_users_7d", "views_today",
                    "submissions_pending", "ai_suggestions_new", "ai_drafts_pending"):
            assert key in stats, f"§24 card missing: {key}"
        assert isinstance(stats["top_categories"], list)
        assert isinstance(stats["top_districts"], list)
        assert isinstance(stats["top_mandals"], list)

    def test_gallery_is_in_the_create_response(self, client: TestClient, db: Session) -> None:
        """The session runs with autoflush off, so a freshly-written gallery is
        invisible to the response serialiser unless the service flushes."""
        from app.models.media import Media

        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-editor@test.example.com")
        media = Media(type="image", filename="p.webp", mime="image/webp", bytes=10,
                      storage_provider="local", storage_key="img/p.webp")
        db.add(media)
        db.flush()

        created = client.post("/api/v1/cms/articles", json={
            "title_te": "గ్యాలరీ ఉన్న కథనం",
            "body": body_doc(BODY_TE),
            "hero_media_id": media.id,
            "gallery_media_ids": [media.id],
        }, headers=editor)
        assert created.status_code == 201, created.text
        assert len(created.json()["gallery"]) == 1, "gallery must round-trip on create"
        assert created.json()["hero_media"]["id"] == media.id

    def test_scheduling_then_publishing_now(self, client: TestClient, db: Session) -> None:
        """§1 — a future time schedules and stays hidden; a bare publish from
        SCHEDULED means "go now", not "re-read the stored time"."""
        from datetime import timezone

        author = staff_headers(db, role=RoleKey.SUB_EDITOR, email="h-author@test.example.com")
        chief = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="h-chief@test.example.com")
        created = client.post("/api/v1/cms/articles", json={
            "title_te": "షెడ్యూల్ పరీక్ష కథనం", "body": body_doc(BODY_TE),
        }, headers=author).json()
        aid = created["id"]
        client.post(f"/api/v1/cms/articles/{aid}/submit", json={}, headers=author)
        client.post(f"/api/v1/cms/articles/{aid}/approve", json={}, headers=chief)

        future = (utcnow() + timedelta(hours=2)).astimezone(timezone.utc).isoformat()
        scheduled = client.post(f"/api/v1/cms/articles/{aid}/publish",
                                json={"scheduled_at": future}, headers=chief)
        assert scheduled.status_code == 200, scheduled.text
        assert scheduled.json()["workflow_state"] == WorkflowState.SCHEDULED.value
        assert scheduled.json()["status"] == ArticleStatus.SCHEDULED.value

        short_id = scheduled.json()["short_id"]
        assert client.get(f"/api/v1/public/articles/{short_id}").status_code == 404

        now_live = client.post(f"/api/v1/cms/articles/{aid}/publish", json={}, headers=chief)
        assert now_live.status_code == 200, now_live.text
        assert now_live.json()["workflow_state"] == WorkflowState.PUBLISHED.value
        assert now_live.json()["scheduled_at"] is None
        assert client.get(f"/api/v1/public/articles/{short_id}").status_code == 200
