"""Phase F integration tests — creator submissions (§17), the heuristic
assist engine (§18), and house ads (§26)."""

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
from app.models.content import Article, Category  # noqa: E402
from app.models.creator import AdCampaign  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
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
                 body_plain: str = "", minutes_ago: int = 60) -> Article:
    global _counter
    _counter += 1
    article = Article(
        short_id=f"f{_counter:05d}",
        slug=f"phase-f-{_counter}",
        title_te=title_te,
        body_plain=body_plain,
        category_id=category.id if category else None,
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


def reader_headers(client: TestClient, phone: str) -> dict[str, str]:
    otp = client.post("/api/v1/auth/otp/request", json={"phone": phone}).json()["dev_otp"]
    r = client.post("/api/v1/auth/reader/otp/verify", json={"phone": phone, "otp": otp})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['tokens']['access_token']}"}


BODY = (
    "గుంటూరు జిల్లాలో మా గ్రామంలో కొత్త గ్రంథాలయం ప్రారంభమైంది. "
    "యువత విరాళాలతో నిర్మించిన ఈ గ్రంథాలయంలో వెయ్యికి పైగా పుస్తకాలు ఉన్నాయి. "
    "ప్రతి ఆదివారం పిల్లలకు కథల కార్యక్రమం నిర్వహిస్తున్నారు."
)


# --------------------------------------------------------------------------- #
# creator submissions (§17)
# --------------------------------------------------------------------------- #
class TestSubmissions:
    def test_guidelines_gate(self, client: TestClient, db: Session) -> None:
        headers = reader_headers(client, "9848040001")
        r = client.post("/api/v1/users/me/submissions", json={
            "title_te": "మా ఊరి గ్రంథాలయం కథ",
            "body_te": BODY,
            "accept_guidelines": False,
        }, headers=headers)
        assert r.status_code == 422

    def test_submit_approve_creates_workflow_article_with_attribution(
        self, client: TestClient, db: Session
    ) -> None:
        headers = reader_headers(client, "9848040002")
        r = client.post("/api/v1/users/me/submissions", json={
            "title_te": "మా ఊరి గ్రంథాలయం విజయగాథ",
            "body_te": BODY,
            "category_slug": "inspiring",
            "district_slug": "guntur",
            "accept_guidelines": True,
        }, headers=headers)
        assert r.status_code == 201, r.text
        submission_id = r.json()["id"]

        mine = client.get("/api/v1/users/me/submissions", headers=headers).json()
        assert mine[0]["status"] == "pending"

        moderator = staff_headers(db, role=RoleKey.MODERATOR, email="sub-mod@test.example.com")
        queue = client.get("/api/v1/cms/moderation/submissions", headers=moderator).json()
        assert any(item["id"] == submission_id for item in queue["items"])

        approved = client.post(
            f"/api/v1/cms/moderation/submissions/{submission_id}/approve", headers=moderator
        )
        assert approved.status_code == 200, approved.text
        article_id = approved.json()["article_id"]

        article = db.get(Article, article_id)
        db.refresh(article)
        assert article.workflow_state == WorkflowState.SUBMITTED, \
            "approval enters the editorial queue — it never publishes directly"
        assert article.source_type == "contributed"
        assert article.byline_te, "§17: creator attribution travels on the byline"
        assert article.body and article.body["type"] == "doc"

        # A second decision on the same submission is refused.
        again = client.post(
            f"/api/v1/cms/moderation/submissions/{submission_id}/reject",
            json={"note": "late"}, headers=moderator,
        )
        assert again.status_code == 409

    def test_reject_returns_note_to_creator(self, client: TestClient, db: Session) -> None:
        headers = reader_headers(client, "9848040003")
        submission_id = client.post("/api/v1/users/me/submissions", json={
            "title_te": "తిరస్కరించదగిన కథనం ఇది",
            "body_te": BODY,
            "accept_guidelines": True,
        }, headers=headers).json()["id"]

        moderator = staff_headers(db, role=RoleKey.MODERATOR, email="sub-mod@test.example.com")
        r = client.post(
            f"/api/v1/cms/moderation/submissions/{submission_id}/reject",
            json={"note": "మూలాధారాలు లేవు"}, headers=moderator,
        )
        assert r.status_code == 200
        mine = client.get("/api/v1/users/me/submissions", headers=headers).json()
        rejected = next(s for s in mine if s["id"] == submission_id)
        assert rejected["status"] == "rejected"
        assert rejected["review_note"] == "మూలాధారాలు లేవు"

    def test_pending_cap(self, client: TestClient, db: Session) -> None:
        headers = reader_headers(client, "9848040004")
        for i in range(5):
            assert client.post("/api/v1/users/me/submissions", json={
                "title_te": f"వరుస సమర్పణ సంఖ్య {i} ఇది",
                "body_te": BODY,
                "accept_guidelines": True,
            }, headers=headers).status_code == 201
        r = client.post("/api/v1/users/me/submissions", json={
            "title_te": "ఆరవ సమర్పణ ఇది కాదు",
            "body_te": BODY,
            "accept_guidelines": True,
        }, headers=headers)
        assert r.status_code == 409

    def test_queue_requires_moderator(self, client: TestClient, db: Session) -> None:
        headers = reader_headers(client, "9848040005")
        assert client.get("/api/v1/cms/moderation/submissions", headers=headers).status_code == 403


# --------------------------------------------------------------------------- #
# assist engine (§18)
# --------------------------------------------------------------------------- #
class TestAssist:
    def test_duplicate_detection_flags_a_near_copy(self, client: TestClient, db: Session) -> None:
        cinema = db.execute(select(Category).where(Category.slug == "cinema")).scalar_one()
        original_body = (
            "పోలవరం ప్రాజెక్టు డయాఫ్రం వాల్ పనులు తుది దశకు చేరాయి. "
            "ముఖ్యమంత్రి బుధవారం క్షేత్రస్థాయిలో పరిశీలించనున్నారు. "
            "నిర్దేశిత గడువులోగా పనులు పూర్తి చేయాలని అధికారులను ఆదేశించారు."
        )
        original = make_article(
            db, title_te="పోలవరం డయాఫ్రం వాల్ పనులు తుది దశకు",
            category=cinema, body_plain=original_body,
        )
        db.commit()

        reporter = staff_headers(db, role=RoleKey.REPORTER, email="assist-rep@test.example.com")
        r = client.post("/api/v1/cms/ai/assist", json={
            "title_te": "పోలవరం డయాఫ్రం వాల్ పనులు తుది దశలో",
            "body_plain": original_body + " అదనపు వాక్యం ఒకటి.",
        }, headers=reporter)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["engine"] == "heuristic-v1"
        assert body["duplicates"], "a near-copy must be flagged"
        assert body["duplicates"][0]["short_id"] == original.short_id
        assert body["duplicates"][0]["similarity_percent"] > 60

    def test_tags_summary_and_seo_suggestions(self, client: TestClient, db: Session) -> None:
        reporter = staff_headers(db, role=RoleKey.REPORTER, email="assist-rep@test.example.com")
        text = (
            "అమరావతి రాజధాని నిర్మాణ పనులపై సమీక్ష జరిగింది. "
            "పోలవరం నీటిపారుదల పనులు కూడా చర్చకు వచ్చాయి. " * 5
        )
        r = client.post("/api/v1/cms/ai/assist", json={
            "title_te": "అమరావతి పనులపై సమీక్ష",
            "body_plain": text,
        }, headers=reporter)
        assert r.status_code == 200
        body = r.json()
        slugs = {t["slug"] for t in body["suggested_tags"]}
        assert "amaravati" in slugs and "polavaram" in slugs, \
            "existing tags occurring in the copy must be suggested"
        assert 0 < len(body["summary_te"].split()) <= 45
        assert len(body["seo"]["seo_title"]) <= 60
        assert len(body["seo"]["seo_description"]) <= 160

    def test_assist_requires_ai_use(self, client: TestClient, db: Session) -> None:
        moderator = staff_headers(db, role=RoleKey.MODERATOR, email="assist-mod@test.example.com")
        r = client.post("/api/v1/cms/ai/assist", json={"title_te": "పరీక్ష", "body_plain": "పరీక్ష"},
                        headers=moderator)
        assert r.status_code == 403


# --------------------------------------------------------------------------- #
# house ads (§26)
# --------------------------------------------------------------------------- #
class TestAds:
    def test_create_serve_click_and_targeting(self, client: TestClient, db: Session) -> None:
        manager = staff_headers(db, role=RoleKey.AD_MANAGER, email="ads@test.example.com")

        untargeted = client.post("/api/v1/cms/ads", json={
            "name": "సాధారణ బ్యానర్",
            "image_url": "https://ads.example.com/banner.png",
            "target_url": "https://example.com/offer",
            "placement": "top_banner",
        }, headers=manager)
        assert untargeted.status_code == 201, untargeted.text

        cinema_only = client.post("/api/v1/cms/ads", json={
            "name": "సినిమా ప్రకటన",
            "image_url": "https://ads.example.com/cinema.png",
            "target_url": "https://example.com/movie",
            "placement": "category",
            "category_slug": "cinema",
        }, headers=manager)
        assert cinema_only.status_code == 201
        cinema_id = cinema_only.json()["id"]

        served = client.get("/api/v1/public/ads", params={"placement": "top_banner"})
        assert served.status_code == 200
        ad = served.json()
        assert ad is not None and ad["label_te"] == "ప్రకటన", \
            "§26: the commercial label ships with the payload"

        # Category targeting: the cinema campaign never leaks into sports.
        for _ in range(6):
            in_sports = client.get(
                "/api/v1/public/ads", params={"placement": "category", "category": "sports"}
            ).json()
            assert in_sports is None or in_sports["id"] != cinema_id
        in_cinema = client.get(
            "/api/v1/public/ads", params={"placement": "category", "category": "cinema"}
        ).json()
        assert in_cinema is not None and in_cinema["id"] == cinema_id

        assert client.post(f"/api/v1/public/ads/{cinema_id}/click").status_code == 202
        rows = client.get("/api/v1/cms/ads", headers=manager).json()["items"]
        cinema_row = next(r for r in rows if r["id"] == cinema_id)
        assert cinema_row["impressions"] >= 1 and cinema_row["clicks"] >= 1

    def test_expired_campaign_never_serves(self, client: TestClient, db: Session) -> None:
        campaign = db.execute(
            select(AdCampaign).where(AdCampaign.placement == "top_banner")
        ).scalars().first()
        campaign.ends_at = utcnow() - timedelta(minutes=1)
        db.commit()
        served = client.get("/api/v1/public/ads", params={"placement": "top_banner"})
        assert served.json() is None

    def test_ads_crud_requires_permission(self, client: TestClient, db: Session) -> None:
        reporter = staff_headers(db, role=RoleKey.REPORTER, email="ads-rep@test.example.com")
        assert client.get("/api/v1/cms/ads", headers=reporter).status_code == 403
