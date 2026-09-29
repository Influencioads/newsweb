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
from app.db import seed_content  # noqa: E402
from app.db.seed_content import seed_categories  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article, Category  # noqa: E402
from app.models.engagement import Follow  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    FollowTargetType,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.epaper import EpaperUserEdition, EpaperUserEditionPreference  # noqa: E402
from app.models.geo import District, Locality, Mandal  # noqa: E402
from app.models.notify import NotificationCampaign  # noqa: E402
from app.models.reader import UserPreference  # noqa: E402
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


# --------------------------------------------------------------------------- #
# category CRUD (admin Taxonomy page)
# --------------------------------------------------------------------------- #
class TestCategoryAdmin:
    """Each test makes its own categories: TestConfig relies on the seeded ones."""

    @pytest.fixture(scope="class")
    def auth(self, db: Session) -> dict[str, str]:
        # Editor-in-Chief holds taxonomy.manage and isn't used elsewhere here
        # (staff_token's email is per role).
        return {"Authorization": f"Bearer {staff_token(db, role=RoleKey.EDITOR_IN_CHIEF)}"}

    def _create(self, client: TestClient, auth: dict, slug: str, **extra) -> int:
        r = client.post(
            "/api/v1/cms/taxonomy/categories",
            json={"slug": slug, "name_te": f"{slug} te", "name_en": slug, **extra},
            headers=auth,
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def _reader(self, db: Session, email: str, slugs: list[str]) -> UserPreference:
        user = User(email=email, name_te="పాఠకుడు", name_en="Reader", status=UserStatus.ACTIVE)
        db.add(user)
        db.flush()
        prefs = UserPreference(user_id=user.id, category_slugs=slugs)
        db.add(prefs)
        db.commit()
        return prefs

    def test_create_top_level_appends_a_home_section(
        self, client: TestClient, db: Session, auth: dict
    ) -> None:
        cat_id = self._create(client, auth, "cat-agri", description_te="వ్యవసాయం")
        section = db.execute(
            select(HomepageSection).where(HomepageSection.key == "cat-agri")
        ).scalar_one()
        assert section.category_id == cat_id
        assert section.sort == max(db.execute(select(HomepageSection.sort)).scalars())

        rows = client.get("/api/v1/cms/taxonomy", headers=auth).json()["categories"]
        row = next(c for c in rows if c["id"] == cat_id)
        assert row["parent_id"] is None
        assert row["article_count"] == 0
        assert row["description_te"] == "వ్యవసాయం"
        assert row["sort"] == max(c["sort"] for c in rows)

        dup = client.post(
            "/api/v1/cms/taxonomy/categories",
            json={"slug": "cat-agri", "name_te": "x", "name_en": "x"},
            headers=auth,
        )
        assert dup.status_code == 422

    def test_sub_category_is_two_levels_only(
        self, client: TestClient, db: Session, auth: dict
    ) -> None:
        parent = self._create(client, auth, "cat-parent")
        sub = self._create(client, auth, "cat-sub", parent_id=parent)
        # A sub-category gets no home block of its own.
        assert db.execute(
            select(HomepageSection).where(HomepageSection.category_id == sub)
        ).scalar_one_or_none() is None
        # Its parent must be top-level, and a parent can't itself be nested.
        grandchild = client.post(
            "/api/v1/cms/taxonomy/categories",
            json={"slug": "cat-grand", "name_te": "x", "name_en": "x", "parent_id": sub},
            headers=auth,
        )
        assert grandchild.status_code == 422
        other = self._create(client, auth, "cat-other")
        nest = client.patch(
            f"/api/v1/cms/taxonomy/categories/{parent}",
            json={"parent_id": other},
            headers=auth,
        )
        assert nest.status_code == 422
        self_parent = client.patch(
            f"/api/v1/cms/taxonomy/categories/{other}",
            json={"parent_id": other},
            headers=auth,
        )
        assert self_parent.status_code == 422

    def test_reparent_refiles_its_stories(
        self, client: TestClient, db: Session, auth: dict
    ) -> None:
        parent = self._create(client, auth, "cat-p2")
        sub = self._create(client, auth, "cat-s2", parent_id=parent)
        story = make_article(db, title_te="ఉప విభాగ కథనం", category=db.get(Category, parent))
        story.subcategory_id = sub
        db.commit()
        # Promoted: the story is filed under it, with no sub-section.
        r = client.patch(
            f"/api/v1/cms/taxonomy/categories/{sub}",
            json={"parent_id": None},
            headers=auth,
        )
        assert r.status_code == 200, r.text
        db.refresh(story)
        assert (story.category_id, story.subcategory_id) == (sub, None)
        # Nested again: section = the new parent, sub-section = it.
        r = client.patch(
            f"/api/v1/cms/taxonomy/categories/{sub}",
            json={"parent_id": parent},
            headers=auth,
        )
        assert r.status_code == 200, r.text
        db.refresh(story)
        assert (story.category_id, story.subcategory_id) == (parent, sub)

    def test_sub_category_stays_out_of_nav_and_its_page_lists_its_stories(
        self, client: TestClient, db: Session, auth: dict
    ) -> None:
        parent = self._create(client, auth, "cat-p5")
        sub = self._create(client, auth, "cat-s5", parent_id=parent)
        assert db.get(Category, sub).show_in_nav is False
        story = make_article(db, title_te="ఉప పేజీ కథనం", category=db.get(Category, parent))
        story.subcategory_id = sub
        db.commit()
        for slug in ("cat-s5", "cat-p5"):
            r = client.get("/api/v1/public/articles", params={"category": slug})
            assert r.status_code == 200, r.text
            assert story.short_id in [a["short_id"] for a in r.json()["articles"]]

    def test_delete_sub_category_moves_stories_and_follows_to_sibling(
        self, client: TestClient, db: Session, auth: dict
    ) -> None:
        parent = self._create(client, auth, "cat-p7")
        gone = self._create(client, auth, "cat-s7a", parent_id=parent)
        keep = self._create(client, auth, "cat-s7b", parent_id=parent)
        story = make_article(db, title_te="తరలింపు", category=db.get(Category, parent))
        story.subcategory_id = gone
        a = self._reader(db, "follow-a@test.example.com", []).user_id
        b = self._reader(db, "follow-b@test.example.com", []).user_id
        kind = FollowTargetType.CATEGORY
        for uid, cid in ((a, gone), (b, gone), (b, keep)):
            db.add(Follow(user_id=uid, target_type=kind, target_id=cid, created_at=utcnow()))
        edition = EpaperUserEdition(user_id=a, name="నా పత్రిక")
        db.add(edition)
        db.flush()
        db.add(EpaperUserEditionPreference(
            user_edition_id=edition.id, preference_type="category", target_id=gone
        ))
        db.commit()

        r = client.delete(
            f"/api/v1/cms/taxonomy/categories/{gone}",
            params={"move_to": keep},
            headers=auth,
        )
        assert r.status_code == 200, r.text
        db.expire_all()
        assert (story.category_id, story.subcategory_id) == (parent, keep)
        follows = db.execute(
            select(Follow.user_id, Follow.target_id).where(Follow.user_id.in_([a, b]))
        ).all()
        assert sorted(follows) == sorted([(a, keep), (b, keep)])
        pref = db.execute(
            select(EpaperUserEditionPreference).where(
                EpaperUserEditionPreference.user_edition_id == edition.id
            )
        ).scalar_one()
        assert pref.target_id == keep

    def test_retired_slug_is_not_reseeded(
        self, client: TestClient, db: Session, auth: dict, monkeypatch
    ) -> None:
        renamed = self._create(client, auth, "cat-seed-a")
        assert client.patch(
            f"/api/v1/cms/taxonomy/categories/{renamed}", json={"slug": "cat-seed-a2"}, headers=auth
        ).status_code == 200
        dropped = self._create(client, auth, "cat-seed-b")
        assert client.delete(
            f"/api/v1/cms/taxonomy/categories/{dropped}", headers=auth
        ).status_code == 200
        parent = self._create(client, auth, "cat-seed-p")
        nav_sub = self._create(client, auth, "cat-seed-s", parent_id=parent, show_in_nav=True)

        monkeypatch.setattr(
            seed_content,
            "CATEGORIES",
            (
                ("cat-seed-a", "అ", "A", True),
                ("cat-seed-b", "బ", "B", True),
                ("cat-seed-new", "కొ", "New", True),
            ),
        )
        categories = seed_content.seed_categories(db)
        seed_homepage_sections(db, categories)
        db.commit()
        slugs = set(db.execute(select(Category.slug)).scalars())
        assert {"cat-seed-a", "cat-seed-b"}.isdisjoint(slugs)
        assert "cat-seed-new" in slugs
        # A sub-category in the nav still gets no home block of its own.
        assert db.execute(
            select(HomepageSection).where(HomepageSection.category_id == nav_sub)
        ).scalar_one_or_none() is None

    def test_patch_slug_rename_follows_section_and_reader_prefs(
        self, client: TestClient, db: Session, auth: dict
    ) -> None:
        cat_id = self._create(client, auth, "cat-old")
        prefs = self._reader(db, "rename-reader@test.example.com", ["cat-old", "cinema"])

        base = f"/api/v1/cms/taxonomy/categories/{cat_id}"
        assert client.patch(base, json={"name_te": ""}, headers=auth).status_code == 422
        assert client.patch(base, json={"slug": "cinema"}, headers=auth).status_code == 422

        r = client.patch(
            base,
            json={"slug": "cat-new", "name_en": "Renamed", "show_in_nav": False},
            headers=auth,
        )
        assert r.status_code == 200, r.text
        assert r.json()["slug"] == "cat-new"
        section = db.execute(
            select(HomepageSection).where(HomepageSection.category_id == cat_id)
        ).scalar_one()
        assert section.key == "cat-new"
        db.refresh(prefs)
        assert prefs.category_slugs == ["cat-new", "cinema"]

    def test_scheduled_pushes_follow_a_rename_and_cancel_on_a_bare_delete(
        self, client: TestClient, db: Session, auth: dict
    ) -> None:
        cat_id = self._create(client, auth, "cat-push")
        push = NotificationCampaign(
            title_te="షెడ్యూల్", audience="category:cat-push", status="scheduled"
        )
        db.add(push)
        db.commit()
        base = f"/api/v1/cms/taxonomy/categories/{cat_id}"
        assert client.patch(base, json={"slug": "cat-push2"}, headers=auth).status_code == 200
        db.refresh(push)
        assert (push.audience, push.status) == ("category:cat-push2", "scheduled")

        assert client.delete(base, headers=auth).status_code == 200
        db.refresh(push)
        assert push.status == "cancelled"

    def test_reorder(self, client: TestClient, db: Session, auth: dict) -> None:
        a = self._create(client, auth, "cat-ord-a")
        b = self._create(client, auth, "cat-ord-b")
        r = client.put(
            "/api/v1/cms/taxonomy/categories/order",
            json={"ordered_ids": [b, a]},
            headers=auth,
        )
        assert r.status_code == 200, r.text
        assert db.get(Category, b).sort == 0
        assert db.get(Category, a).sort == 1
        bad = client.put(
            "/api/v1/cms/taxonomy/categories/order",
            json={"ordered_ids": [999999]},
            headers=auth,
        )
        assert bad.status_code == 422

    def test_delete_refuses_content_then_moves_it(
        self, client: TestClient, db: Session, auth: dict
    ) -> None:
        cat_id = self._create(client, auth, "cat-del")
        cat = db.get(Category, cat_id)
        stories = [make_article(db, title_te=f"తొలగింపు {i}", category=cat) for i in range(2)]
        prefs = self._reader(db, "delete-reader@test.example.com", ["cat-del", "sports"])

        r = client.delete(f"/api/v1/cms/taxonomy/categories/{cat_id}", headers=auth)
        assert r.status_code == 409, r.text
        assert r.json()["error"]["details"]["counts"]["articles"] == 2
        assert db.get(Category, cat_id) is not None

        cinema = db.execute(select(Category).where(Category.slug == "cinema")).scalar_one()
        r = client.delete(
            f"/api/v1/cms/taxonomy/categories/{cat_id}",
            params={"move_to": cinema.id},
            headers=auth,
        )
        assert r.status_code == 200, r.text
        db.expire_all()
        assert db.get(Category, cat_id) is None
        assert all(db.get(Article, s.id).category_id == cinema.id for s in stories)
        assert db.execute(
            select(HomepageSection).where(HomepageSection.key == "cat-del")
        ).scalar_one_or_none() is None
        assert db.get(UserPreference, prefs.id).category_slugs == ["sports"]

        # An empty category needs no destination.
        empty = self._create(client, auth, "cat-empty")
        r = client.delete(f"/api/v1/cms/taxonomy/categories/{empty}", headers=auth)
        assert r.status_code == 200, r.text

    def test_delete_refuses_a_parent_with_children(
        self, client: TestClient, auth: dict
    ) -> None:
        parent = self._create(client, auth, "cat-p3")
        self._create(client, auth, "cat-s3", parent_id=parent)
        r = client.delete(f"/api/v1/cms/taxonomy/categories/{parent}", headers=auth)
        assert r.status_code == 409
        assert r.json()["error"]["details"]["children"] == 1

    def test_panchayat_is_a_system_category(self, client: TestClient, auth: dict) -> None:
        cat_id = self._create(client, auth, "panchayat")
        base = f"/api/v1/cms/taxonomy/categories/{cat_id}"
        assert client.delete(base, headers=auth).status_code == 409
        assert client.patch(base, json={"slug": "gp"}, headers=auth).status_code == 409
        parent = self._create(client, auth, "cat-p4")
        assert client.patch(base, json={"parent_id": parent}, headers=auth).status_code == 409
        # Its names are still the desk's to change.
        assert client.patch(base, json={"name_en": "Village"}, headers=auth).status_code == 200

    def test_writes_require_taxonomy_manage(self, client: TestClient, db: Session) -> None:
        desk = {"Authorization": f"Bearer {staff_token(db, role=RoleKey.DESK_EDITOR)}"}
        base = "/api/v1/cms/taxonomy/categories"
        body = {"slug": "cat-nope", "name_te": "x", "name_en": "x"}
        assert client.post(base, json=body, headers=desk).status_code == 403
        assert client.patch(f"{base}/1", json={"name_en": "x"}, headers=desk).status_code == 403
        assert client.delete(f"{base}/1", headers=desk).status_code == 403
        order = client.put(f"{base}/order", json={"ordered_ids": [1]}, headers=desk)
        assert order.status_code == 403
        # Viewing stays open to taxonomy.view.
        assert client.get("/api/v1/cms/taxonomy", headers=desk).status_code == 200

    def test_stale_interest_is_dropped_not_rejected(
        self, client: TestClient, db: Session, auth: dict
    ) -> None:
        cat_id = self._create(client, auth, "cat-hide")
        prefs = self._reader(db, "stale-reader@test.example.com", ["cat-hide", "cinema"])
        _s, access, _r, _e = auth_service.create_session(db, db.get(User, prefs.user_id))
        db.commit()
        reader = {"Authorization": f"Bearer {access}"}
        hide = client.patch(
            f"/api/v1/cms/taxonomy/categories/{cat_id}", json={"is_active": False}, headers=auth
        )
        assert hide.status_code == 200

        # The client sends back what it stored, hidden category included.
        r = client.patch(
            "/api/v1/users/me/preferences",
            json={"category_slugs": ["cat-hide", "cinema"]},
            headers=reader,
        )
        assert r.status_code == 200, r.text
        assert r.json()["category_slugs"] == ["cinema"]
        # A newly added unknown slug is still the client's mistake.
        bad = client.patch(
            "/api/v1/users/me/preferences",
            json={"category_slugs": ["cinema", "never-existed"]},
            headers=reader,
        )
        assert bad.status_code == 422
