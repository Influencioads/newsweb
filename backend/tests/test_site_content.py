"""Site content edited from the CMS: blocks, footer pages, WOW category cards.

Same harness as test_phase_a_reader_platform: in-memory SQLite with the real
seed, the FastAPI app with `get_db` overridden.
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

from app.db.base import Base  # noqa: E402
from app.db.seed import seed_homepage_sections, seed_permissions, seed_roles  # noqa: E402
from app.db.seed_content import seed_categories  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.enums import RoleKey, ScopeType, UserStatus  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service  # noqa: E402

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    seed_roles(session, seed_permissions(session))
    seed_homepage_sections(session, seed_categories(session))
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


def _auth(db: Session, role: RoleKey) -> dict[str, str]:
    role_row = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
    user = User(
        email=f"site-{role.value}@test.example.com",
        name_te="పరీక్ష",
        name_en="Test Staff",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=role_row.id, scope_type=ScopeType.GLOBAL))
    db.flush()
    db.refresh(user)
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}


@pytest.fixture(scope="module")
def admin(db: Session) -> dict[str, str]:
    return _auth(db, RoleKey.SUPER_ADMIN)


class TestBlocks:
    def test_config_carries_defaults_before_anything_is_saved(self, client: TestClient) -> None:
        content = client.get("/api/v1/public/config").json()["content"]
        assert content["brand"]["tagline_en"] == "Ordinary People. Extraordinary Stories."
        assert content["brand"]["logo_url"] == ""
        assert [s["id"] for s in content["radio"]["segments"]] == [
            "morning-mantra", "spoorthi", "wow-news", "mystery",
        ]
        assert content["nominate"]["categories"][0]["value"] == "social-service"

    def test_save_shows_on_the_site_and_reset_restores(
        self, client: TestClient, admin: dict
    ) -> None:
        r = client.put(
            "/api/v1/cms/site-content/home",
            json={"banner_tag_te": "ప్రతి కథలో వావ్!", "banner_tag_en": "A WOW in every story"},
            headers=admin,
        )
        assert r.status_code == 200, r.text
        home = client.get("/api/v1/public/config").json()["content"]["home"]
        assert home["banner_tag_en"] == "A WOW in every story"
        assert "home" in client.get("/api/v1/cms/site-content", headers=admin).json()["saved"]

        assert client.delete("/api/v1/cms/site-content/home", headers=admin).status_code == 200
        home = client.get("/api/v1/public/config").json()["content"]["home"]
        assert home["banner_tag_en"] == "Every Story Has a WOW!"

    def test_radio_segments_are_validated(self, client: TestClient, admin: dict) -> None:
        segment = {
            "id": "night", "te": "రాత్రి", "en": "Night", "icon": "sparkles",
            "tone": "blue", "categories": ["mystery"],
        }
        ok = client.put(
            "/api/v1/cms/site-content/radio",
            json={"image_url": "/media/radio.webp", "segments": [segment]},
            headers=admin,
        )
        assert ok.status_code == 200, ok.text
        radio = client.get("/api/v1/public/config").json()["content"]["radio"]
        assert radio["image_url"] == "/media/radio.webp"
        assert [s["id"] for s in radio["segments"]] == ["night"]

        for bad in (
            {"segments": [{**segment, "icon": "skull"}]},
            {"segments": [{**segment, "tone": "pink"}]},
            {"segments": [segment, segment]},
            {"segments": []},
            {"image_url": "javascript:alert(1)", "segments": [segment]},
        ):
            r = client.put("/api/v1/cms/site-content/radio", json=bad, headers=admin)
            assert r.status_code == 422, bad

    def test_story_shots_are_their_own_uploads(self, client: TestClient, admin: dict) -> None:
        assert client.get("/api/v1/public/config").json()["content"]["story_shots"] == {"shots": []}
        shot = {"id": "s1", "image_url": "/media/shot-1.webp", "title_en": "Village fair", "link": "/section/mystery"}
        r = client.put(
            "/api/v1/cms/site-content/story_shots",
            json={"shots": [shot, {"id": "s2", "image_url": "/media/shot-2.webp"}]},
            headers=admin,
        )
        assert r.status_code == 200, r.text
        shots = client.get("/api/v1/public/config").json()["content"]["story_shots"]["shots"]
        assert [s["id"] for s in shots] == ["s1", "s2"]
        assert shots[0]["link"] == "/section/mystery" and shots[1]["title_te"] == ""

        for bad in (
            {"shots": [shot, shot]},
            {"shots": [{**shot, "image_url": ""}]},
            {"shots": [{**shot, "image_url": "javascript:alert(1)"}]},
            {"shots": [{**shot, "link": "javascript:alert(1)"}]},
        ):
            r = client.put("/api/v1/cms/site-content/story_shots", json=bad, headers=admin)
            assert r.status_code == 422, bad
        assert client.delete("/api/v1/cms/site-content/story_shots", headers=admin).status_code == 200

    def test_author_names(self, client: TestClient, admin: dict) -> None:
        names = client.get("/api/v1/public/config").json()["content"]["authors"]["names"]
        assert names == ["సాయి మాసుల", "అజయ్ మారుతి", "ch.రాకేష్"]
        r = client.put("/api/v1/cms/site-content/authors", json={"names": [" సాయి మాసుల ", "కొత్త రచయిత"]}, headers=admin)
        assert r.status_code == 200, r.text
        assert r.json()["names"] == ["సాయి మాసుల", "కొత్త రచయిత"]
        for bad in ({"names": []}, {"names": ["  "]}, {"names": ["a", "a"]}):
            assert client.put("/api/v1/cms/site-content/authors", json=bad, headers=admin).status_code == 422, bad
        assert client.delete("/api/v1/cms/site-content/authors", headers=admin).status_code == 200

    def test_nominate_banner_picture(self, client: TestClient, admin: dict) -> None:
        assert client.get("/api/v1/public/config").json()["content"]["nominate"]["image_url"] == ""
        cats = client.get("/api/v1/public/config").json()["content"]["nominate"]["categories"]
        r = client.put(
            "/api/v1/cms/site-content/nominate",
            json={"image_url": "/media/banner.webp", "categories": cats},
            headers=admin,
        )
        assert r.status_code == 200, r.text
        assert client.get("/api/v1/public/config").json()["content"]["nominate"]["image_url"] == "/media/banner.webp"
        bad = client.put(
            "/api/v1/cms/site-content/nominate",
            json={"image_url": "javascript:alert(1)", "categories": cats},
            headers=admin,
        )
        assert bad.status_code == 422
        assert client.delete("/api/v1/cms/site-content/nominate", headers=admin).status_code == 200

    def test_link_preview_for_other_pages_has_a_full_image_address(self, client: TestClient) -> None:
        html = client.get("/_og/home").text
        assert '<meta property="og:image" content="http' in html
        assert "/og-default.png" in html

    def test_unknown_block_and_permissions(self, client: TestClient, db: Session, admin: dict) -> None:
        assert client.put("/api/v1/cms/site-content/nope", json={}, headers=admin).status_code == 404
        assert client.get("/api/v1/cms/site-content").status_code == 401
        reporter = _auth(db, RoleKey.REPORTER)
        r = client.put(
            "/api/v1/cms/site-content/contact",
            json={"grievance_email": "a@b.in"},
            headers=reporter,
        )
        assert r.status_code == 403

    def test_grievance_email_must_be_an_email(self, client: TestClient, admin: dict) -> None:
        bad = client.put(
            "/api/v1/cms/site-content/contact", json={"grievance_email": "nope"}, headers=admin
        )
        assert bad.status_code == 422
        good = client.put(
            "/api/v1/cms/site-content/contact",
            json={"grievance_email": "grievance@wowindian.in"},
            headers=admin,
        )
        assert good.status_code == 200


class TestPages:
    PAGE = {
        "te": {"title": "మా గురించి", "sections": [{"id": "who", "heading": "మేమెవరం", "body": ["ఒకటి", " ", "రెండు"]}]},
        "en": {"title": "About us", "sections": [{"id": "who", "heading": "Who we are", "body": ["One"]}]},
    }

    def test_page_is_404_until_saved_then_served(self, client: TestClient, admin: dict) -> None:
        assert client.get("/api/v1/public/pages/about").status_code == 404
        r = client.put("/api/v1/cms/pages/about", json=self.PAGE, headers=admin)
        assert r.status_code == 200, r.text
        page = client.get("/api/v1/public/pages/about").json()
        assert page["en"]["title"] == "About us"
        # Blank paragraphs are dropped.
        assert page["te"]["sections"][0]["body"] == ["ఒకటి", "రెండు"]
        assert page["updated_at"]
        assert "about" in client.get("/api/v1/cms/pages", headers=admin).json()["pages"]

        assert client.delete("/api/v1/cms/pages/about", headers=admin).status_code == 200
        assert client.get("/api/v1/public/pages/about").status_code == 404

    def test_only_known_pages(self, client: TestClient, admin: dict) -> None:
        assert client.put("/api/v1/cms/pages/home", json=self.PAGE, headers=admin).status_code == 404
        assert client.get("/api/v1/public/pages/home").status_code == 404
        dup = {**self.PAGE, "en": {"title": "x", "sections": [self.PAGE["en"]["sections"][0]] * 2}}
        assert client.put("/api/v1/cms/pages/terms", json=dup, headers=admin).status_code == 422


class TestCategoryCards:
    def test_seeded_wow_cards_reach_the_config(self, client: TestClient) -> None:
        cats = {c["slug"]: c for c in client.get("/api/v1/public/config").json()["categories"]}
        hero = cats["real-heroes"]
        assert hero["in_explore"] is True and hero["show_in_nav"] is True
        assert hero["icon"] == "medal"
        assert hero["tagline_en"] == "Success stories of extraordinary people"
        assert cats["national"]["in_explore"] is False

    def test_taxonomy_edits_the_card(self, client: TestClient, admin: dict) -> None:
        rows = client.get("/api/v1/cms/taxonomy", headers=admin).json()["categories"]
        mystery = next(c for c in rows if c["slug"] == "mystery")
        assert mystery["icon"] == "telescope"
        r = client.patch(
            f"/api/v1/cms/taxonomy/categories/{mystery['id']}",
            json={"tagline_en": "Secrets", "icon": "ghost", "in_explore": False},
            headers=admin,
        )
        assert r.status_code == 200, r.text
        cats = {c["slug"]: c for c in client.get("/api/v1/public/config").json()["categories"]}
        assert cats["mystery"]["icon"] == "ghost"
        assert cats["mystery"]["in_explore"] is False
        bad = client.patch(
            f"/api/v1/cms/taxonomy/categories/{mystery['id']}", json={"icon": "skull"}, headers=admin
        )
        assert bad.status_code == 422
