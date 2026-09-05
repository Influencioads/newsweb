"""Phase A/B integration tests — locations, search, configurable home,
reader OTP signup, and preferences.

These run against an in-memory SQLite database with the real seed data
(roles, permissions, states, districts, mandals, categories, homepage
sections), exercising the actual HTTP surface through the FastAPI app with the
`get_db` dependency overridden. Redis is not required: the session registry,
OTP store and cache all use their development/test fallbacks.
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
from app.models.enums import ArticleStatus, RoleKey, ScopeType, UserStatus, WorkflowState  # noqa: E402
from app.models.geo import District, Locality, Mandal  # noqa: E402
from app.models.site import HomepageSection  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)

_short_counter = 0


def make_article(
    db: Session,
    *,
    title_te: str,
    category: Category | None = None,
    district_id: int | None = None,
    mandal_id: int | None = None,
    locality_id: int | None = None,
    minutes_ago: int = 5,
    body_plain: str | None = None,
    title_en: str | None = None,
) -> Article:
    global _short_counter
    _short_counter += 1
    article = Article(
        short_id=f"t{_short_counter:05d}",
        slug=f"test-article-{_short_counter}",
        title_te=title_te,
        title_en=title_en,
        body_plain=body_plain,
        category_id=category.id if category else None,
        district_id=district_id,
        mandal_id=mandal_id,
        locality_id=locality_id,
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
        # One shared session so test fixtures and requests see the same data.
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


def staff_token(db: Session, *, role: RoleKey = RoleKey.SUPER_ADMIN) -> str:
    role_row = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
    user = User(
        email=f"{role.value}@test.example.com",
        name_te="పరీక్ష",
        name_en="Test Staff",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=role_row.id, scope_type=ScopeType.GLOBAL))
    db.flush()
    db.refresh(user)
    _session, access, _refresh, _exp = auth_service.create_session(db, user)
    db.commit()
    return access


# --------------------------------------------------------------------------- #
# taxonomy & config
# --------------------------------------------------------------------------- #
class TestConfig:
    def test_config_lists_states_and_new_categories(self, client: TestClient) -> None:
        r = client.get("/api/v1/public/config")
        assert r.status_code == 200
        body = r.json()
        assert [s["code"] for s in body["states"]] == ["AP", "TS"]
        slugs = {c["slug"] for c in body["categories"]}
        # The updated doc §1.2 set is present.
        for required in (
            "jobs", "health", "lifestyle", "travel", "food", "crime",
            "devotional", "inspiring", "zero-to-hero", "best-deals",
        ):
            assert required in slugs, f"missing category {required}"

    def test_locations_tree_groups_districts_by_state(self, client: TestClient) -> None:
        r = client.get("/api/v1/public/locations")
        assert r.status_code == 200
        states = r.json()["states"]
        by_code = {s["code"]: s for s in states}
        assert len(by_code["AP"]["districts"]) == 26
        assert len(by_code["TS"]["districts"]) == 33

    def test_mandals_endpoint(self, client: TestClient, db: Session) -> None:
        district = db.execute(
            select(District).where(District.slug == "visakhapatnam")
        ).scalar_one()
        r = client.get(f"/api/v1/public/locations/{district.slug}/mandals")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# --------------------------------------------------------------------------- #
# local feed (§4 exact-first)
# --------------------------------------------------------------------------- #
class TestLocalFeed:
    def test_locality_stories_rank_above_district_stories(
        self, client: TestClient, db: Session
    ) -> None:
        district = db.execute(select(District).where(District.slug == "guntur")).scalar_one()
        mandal = Mandal(district_id=district.id, slug="tenali", name_te="తెనాలి", name_en="Tenali")
        db.add(mandal)
        db.flush()
        locality = Locality(
            mandal_id=mandal.id, slug="kolakaluru", name_te="కొలకలూరు",
            name_en="Kolakaluru", kind="village",
        )
        db.add(locality)
        db.flush()

        # District story is NEWER but the village story must still rank first.
        make_article(db, title_te="జిల్లా వార్త", district_id=district.id, minutes_ago=1)
        village = make_article(
            db,
            title_te="గ్రామ వార్త",
            district_id=district.id,
            mandal_id=mandal.id,
            locality_id=locality.id,
            minutes_ago=60,
        )
        db.commit()

        r = client.get(
            "/api/v1/public/local",
            params={"district": "guntur", "mandal": "tenali", "locality": "kolakaluru"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["district"]["slug"] == "guntur"
        assert body["locality"]["slug"] == "kolakaluru"
        assert body["articles"], "local feed must not be empty"
        assert body["articles"][0]["short_id"] == village.short_id

    def test_unknown_district_is_404(self, client: TestClient) -> None:
        r = client.get("/api/v1/public/local", params={"district": "nowhere"})
        assert r.status_code == 404


# --------------------------------------------------------------------------- #
# search (§10)
# --------------------------------------------------------------------------- #
class TestSearch:
    def test_search_finds_body_and_title_matches(self, client: TestClient, db: Session) -> None:
        cinema = db.execute(select(Category).where(Category.slug == "cinema")).scalar_one()
        hit = make_article(
            db,
            title_te="పోలవరం ప్రాజెక్టు పురోగతి",
            title_en="Polavaram project progress",
            category=cinema,
            body_plain="నీటిపారుదల శాఖ నివేదిక ప్రకారం పనులు వేగంగా జరుగుతున్నాయి",
        )
        make_article(db, title_te="వేరే కథనం", title_en="Unrelated story")
        db.commit()

        r = client.get("/api/v1/public/search", params={"q": "Polavaram"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] >= 1
        assert any(a["short_id"] == hit.short_id for a in body["articles"])

        # The category filter must narrow the result set.
        r2 = client.get("/api/v1/public/search", params={"q": "Polavaram", "category": "sports"})
        assert r2.status_code == 200
        assert all(a["short_id"] != hit.short_id for a in r2.json()["articles"])

    def test_search_is_logged_and_feeds_popular(self, client: TestClient, db: Session) -> None:
        for _ in range(3):
            assert client.get(
                "/api/v1/public/search", params={"q": "Polavaram"}
            ).status_code == 200
        r = client.get("/api/v1/public/search/meta")
        assert r.status_code == 200
        assert "polavaram" in r.json()["popular"]


# --------------------------------------------------------------------------- #
# configurable home (§23–24)
# --------------------------------------------------------------------------- #
class TestConfigurableHome:
    def _cinema(self, db: Session) -> Category:
        return db.execute(select(Category).where(Category.slug == "cinema")).scalar_one()

    def test_home_renders_enabled_sections_in_config_order(
        self, client: TestClient, db: Session
    ) -> None:
        # The broadsheet top (lead/secondary/mid/briefs) consumes the 17 newest
        # stories before sections are assembled, so give the page enough filler
        # that the older cinema stories are left for the cinema section block.
        for i in range(18):
            make_article(db, title_te=f"తాజా వార్త {i}", minutes_ago=1)
        cinema = self._cinema(db)
        for i in range(4):
            make_article(db, title_te=f"సినిమా కథనం {i}", category=cinema, minutes_ago=200 + i)
        db.commit()

        r = client.get("/api/v1/public/home")
        assert r.status_code == 200
        keys = [s["key"] for s in r.json()["sections"]]
        assert "cinema" in keys

    def test_disabling_a_section_removes_it_without_deploy(
        self, client: TestClient, db: Session
    ) -> None:
        section = db.execute(
            select(HomepageSection).where(HomepageSection.key == "cinema")
        ).scalar_one()
        token = staff_token(db)

        r = client.patch(
            f"/api/v1/cms/homepage/sections/{section.id}",
            json={"is_enabled": False},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text

        home = client.get("/api/v1/public/home").json()
        assert "cinema" not in [s["key"] for s in home["sections"]]

        # Re-enable for later tests.
        client.patch(
            f"/api/v1/cms/homepage/sections/{section.id}",
            json={"is_enabled": True},
            headers={"Authorization": f"Bearer {token}"},
        )

    def test_reorder_endpoint_rejects_unknown_ids(self, client: TestClient, db: Session) -> None:
        token = staff_token(db, role=RoleKey.ADMIN)
        r = client.put(
            "/api/v1/cms/homepage/sections/order",
            json={"ordered_ids": [999999]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 422

    def test_homepage_config_requires_permission(self, client: TestClient, db: Session) -> None:
        r = client.get("/api/v1/cms/homepage/sections")
        assert r.status_code == 401


# --------------------------------------------------------------------------- #
# reader accounts (§11)
# --------------------------------------------------------------------------- #
READER_PHONE = "9848099001"


class TestReaderAccounts:
    def _login(self, client: TestClient) -> dict:
        r1 = client.post("/api/v1/auth/otp/request", json={"phone": READER_PHONE})
        assert r1.status_code == 200, r1.text
        otp = r1.json()["dev_otp"]
        assert otp, "OTP_DEV_ECHO must be on in tests"
        r2 = client.post(
            "/api/v1/auth/reader/otp/verify",
            json={"phone": READER_PHONE, "otp": otp, "platform": "android"},
        )
        assert r2.status_code == 200, r2.text
        return r2.json()

    def test_first_otp_verify_registers_a_subscriber(
        self, client: TestClient, db: Session
    ) -> None:
        body = self._login(client)
        assert body["is_new_account"] is True
        assert body["me"]["roles"][0]["role_key"] == "subscriber"
        assert body["me"]["permissions"] == []

        user = db.execute(
            select(User).where(User.phone == f"91{READER_PHONE}")
        ).scalar_one()
        assert user.status == UserStatus.ACTIVE

    def test_second_login_is_not_a_new_account(self, client: TestClient) -> None:
        body = self._login(client)
        assert body["is_new_account"] is False

    def test_staff_otp_route_still_rejects_unknown_numbers(self, client: TestClient) -> None:
        r1 = client.post("/api/v1/auth/otp/request", json={"phone": "9848099002"})
        otp = r1.json()["dev_otp"]
        r2 = client.post("/api/v1/auth/otp/verify", json={"phone": "9848099002", "otp": otp})
        assert r2.status_code == 401

    def test_preferences_roundtrip_with_hierarchy_validation(
        self, client: TestClient, db: Session
    ) -> None:
        token = self._login(client)["tokens"]["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        r = client.get("/api/v1/users/me/preferences", headers=headers)
        assert r.status_code == 200
        assert r.json()["language"] == "te"

        # A mandal that belongs to another district must be rejected.
        r_bad = client.patch(
            "/api/v1/users/me/preferences",
            json={"district_slug": "guntur", "mandal_slug": "anakapalli-rural"},
            headers=headers,
        )
        assert r_bad.status_code == 422

        r_ok = client.patch(
            "/api/v1/users/me/preferences",
            json={
                "district_slug": "guntur",
                "mandal_slug": "tenali",
                "category_slugs": ["cinema", "sports"],
                "notify_local": False,
            },
            headers=headers,
        )
        assert r_ok.status_code == 200, r_ok.text
        prefs = r_ok.json()
        assert prefs["state"]["code"] == "AP"
        assert prefs["district"]["slug"] == "guntur"
        assert prefs["mandal"]["slug"] == "tenali"
        assert prefs["category_slugs"] == ["cinema", "sports"]
        assert prefs["notify_local"] is False

        # Clearing the district clears the mandal beneath it.
        r_clear = client.patch(
            "/api/v1/users/me/preferences",
            json={"district_slug": None},
            headers=headers,
        )
        assert r_clear.status_code == 200
        assert r_clear.json()["district"] is None
        assert r_clear.json()["mandal"] is None

    def test_unknown_category_slug_is_rejected(self, client: TestClient) -> None:
        token = self._login(client)["tokens"]["access_token"]
        r = client.patch(
            "/api/v1/users/me/preferences",
            json={"category_slugs": ["not-a-category"]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 422

    def test_preferences_require_auth(self, client: TestClient) -> None:
        assert client.get("/api/v1/users/me/preferences").status_code == 401
