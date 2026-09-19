"""Turning a GPS fix into our own district / mandal / locality ids.

Most of these assert *degradation*: no key, a dead provider, a point in another
state or a mandal we have never heard of must all leave the reader with the
manual picker rather than an error screen.

Google is never called. Every test feeds `_fetch` the component dictionary a
real reverse-geocode would have produced.
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
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_mandals,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.geo import District, Locality, Mandal  # noqa: E402
from app.services import gazetteer_service, geocode_service  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, future=True
)

#: Seeded by `seed_mandals`, so these are real rows in every environment.
_DISTRICT_SLUG = "visakhapatnam"
_MANDAL_SLUG = "bheemunipatnam"


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    permissions = seed_permissions(session)
    seed_roles(session, permissions)
    seed_states(session)
    districts = seed_districts(session)
    seed_mandals(session, districts)

    mandal = session.scalars(
        select(Mandal).where(Mandal.slug == _MANDAL_SLUG)
    ).one()
    session.add(
        Locality(
            mandal_id=mandal.id,
            slug="thagarapuvalasa",
            name_te="తగరపువలస",
            name_en="Thagarapuvalasa",
            kind="town",
        )
    )
    session.commit()
    gazetteer_service.build_index(session, force=True)
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


def fake_fetch(monkeypatch: pytest.MonkeyPatch, components: dict | None) -> None:
    monkeypatch.setattr(
        geocode_service, "_fetch", lambda lat, lon: components
    )


def components(
    *, state="Andhra Pradesh", district="Visakhapatnam", mandal=None, locality=None
) -> dict:
    out = {"administrative_area_level_1": state}
    if district:
        out["administrative_area_level_2"] = district
    if mandal:
        out["administrative_area_level_3"] = mandal
    if locality:
        out["locality"] = locality
    return out


class TestResolution:
    def test_it_resolves_district_mandal_and_locality(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_fetch(
            monkeypatch,
            components(mandal="Bheemunipatnam", locality="Thagarapuvalasa"),
        )
        place = geocode_service.resolve(db, 17.89, 83.45)
        assert place.matched
        assert place.state_code == "AP"
        district = db.get(District, place.district_id)
        assert district.slug == _DISTRICT_SLUG
        assert db.get(Mandal, place.mandal_id).slug == _MANDAL_SLUG
        assert db.get(Locality, place.locality_id).slug == "thagarapuvalasa"

    def test_district_names_match_with_the_word_district_attached(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Google returns "Visakhapatnam district" as often as not."""
        fake_fetch(monkeypatch, components(district="Visakhapatnam District"))
        assert geocode_service.resolve(db, 17.7, 83.3).matched

    def test_an_unknown_mandal_keeps_the_district(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The gazetteer is incomplete by design — most mandals are not seeded
        yet. Falling back to the district is the right answer, not an error."""
        fake_fetch(monkeypatch, components(mandal="Somewhere Nobody Seeded"))
        place = geocode_service.resolve(db, 17.7, 83.3)
        assert place.matched
        assert place.mandal_id is None

    def test_an_unknown_locality_keeps_the_mandal(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_fetch(
            monkeypatch,
            components(mandal="Bheemunipatnam", locality="Nowhere At All"),
        )
        place = geocode_service.resolve(db, 17.89, 83.45)
        assert place.mandal_id is not None
        assert place.locality_id is None


class TestRefusals:
    def test_a_point_outside_the_two_states_is_not_matched(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Guntur and Nizamabad name places elsewhere too. A confidently wrong
        district is worse than no answer."""
        fake_fetch(monkeypatch, components(state="Karnataka", district="Bellary"))
        place = geocode_service.resolve(db, 15.1, 76.9)
        assert not place.matched
        assert place.state_code is None

    def test_no_provider_answer_is_not_an_error(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_fetch(monkeypatch, None)
        assert not geocode_service.resolve(db, 17.7, 83.3).matched

    def test_a_blank_key_short_circuits_before_any_network_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The default in every environment, including tests and fresh installs."""
        monkeypatch.setattr(geocode_service.settings, "GOOGLE_MAPS_API_KEY", "")

        def explode(*_args, **_kwargs):
            raise AssertionError("must not reach the network without a key")

        monkeypatch.setattr(geocode_service.httpx, "get", explode)
        assert geocode_service._fetch(17.7, 83.3) is None

    def test_a_provider_failure_degrades_instead_of_raising(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(geocode_service.settings, "GOOGLE_MAPS_API_KEY", "k")
        monkeypatch.setattr(geocode_service, "cache_get", lambda _k: None)

        def explode(*_args, **_kwargs):
            raise RuntimeError("provider down")

        monkeypatch.setattr(geocode_service.httpx, "get", explode)
        assert geocode_service._fetch(17.7, 83.3) is None


class TestEndpoint:
    def test_it_returns_200_and_matched_false_rather_than_an_error(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_fetch(monkeypatch, None)
        r = client.post("/api/v1/public/geo/resolve", json={"lat": 17.7, "lon": 83.3})
        assert r.status_code == 200, r.text
        assert r.json()["matched"] is False

    def test_it_returns_the_named_places(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_fetch(
            monkeypatch,
            components(mandal="Bheemunipatnam", locality="Thagarapuvalasa"),
        )
        body = client.post(
            "/api/v1/public/geo/resolve", json={"lat": 17.89, "lon": 83.45}
        ).json()
        assert body["matched"] is True
        assert body["district"]["slug"] == _DISTRICT_SLUG
        assert body["mandal"]["slug"] == _MANDAL_SLUG
        assert body["locality"]["slug"] == "thagarapuvalasa"

    def test_out_of_range_coordinates_are_rejected(self, client: TestClient) -> None:
        r = client.post("/api/v1/public/geo/resolve", json={"lat": 91, "lon": 0})
        assert r.status_code == 422

    def test_it_is_a_post_so_coordinates_never_reach_a_url(self) -> None:
        methods = {
            frozenset(r.methods)
            for r in app.routes
            if getattr(r, "path", "") == "/api/v1/public/geo/resolve"
        }
        assert methods == {frozenset({"POST"})}
