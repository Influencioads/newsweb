"""Turn a device's GPS fix into our own district / mandal / locality ids.

**Why there are no coordinates in this codebase.** The obvious design is a
latitude and longitude on every mandal and a nearest-neighbour search. It is
wrong twice over: answering "which mandal is this point in" needs *polygons*,
not centroids, and a nearest-centroid match is wrong at exactly the places GPS
lands — boundaries. Sourcing, licensing and maintaining mandal boundary
geometry for two states that redraw their districts (Andhra Pradesh did in
2022) is a project, not a column. Google already maintains it.

So this asks Google what administrative area the point is in, and matches the
names it returns against the gazetteer we already have. The matcher is
`gazetteer_service.candidates`, which indexes every mandal name, its English
name and every `MandalAlias`, scopes to a district, and declines when two
distinct mandals match. None of that is written here.

**What is deliberately not stored.** The coordinates. They are rounded to a
cache key, exchanged for ids, and dropped. Nothing writes them to a row and
nothing logs them; a reader's exact position is not something this product
needs to own. `resolve` returns ids, and the caller decides what to do with
them — the reader still confirms the location in the picker before anything is
saved, which is the honest UX for a guess.

**Failure is normal.** No key, no network, a point outside the two states, a
mandal that is not in the gazetteer yet: all of them return None and the client
falls back to the manual picker, which works. Google being down must not
produce an error screen.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.core.redis_client import cache_get, cache_set
from app.models.geo import District, Locality
from app.services import gazetteer_service
from app.telugu.normalize import normalize_text

logger = get_logger(__name__)

_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json"
_TIMEOUT = 6.0

#: ~110 m. Fine enough that a village resolves to one key, coarse enough that
#: the second reader standing in it costs nothing.
_PRECISION = 3
_CACHE_TTL = 60 * 60 * 24 * 30

#: The only states this product covers. A point outside them is not matched at
#: all: "Guntur" and "Nizamabad" name places in other states too, and a
#: confidently wrong district is worse than no answer.
_STATES = {"andhra pradesh": "AP", "telangana": "TS"}

#: level_2 is the district, level_3 the mandal/taluk, `locality` the town.
_RESULT_TYPES = "administrative_area_level_2|administrative_area_level_3|locality"


@dataclass(frozen=True)
class ResolvedPlace:
    state_code: str | None = None
    district_id: int | None = None
    mandal_id: int | None = None
    locality_id: int | None = None

    @property
    def matched(self) -> bool:
        return self.district_id is not None


def _norm(value: str | None) -> str:
    """Compare-ready: NFC, collapsed spaces, case-folded, no trailing noun."""
    text = normalize_text(value or "").casefold()
    for suffix in (" district", " taluk", " taluka", " mandal", " tehsil"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
    return text.strip()


def _components(results: list[dict]) -> dict[str, str]:
    """Flatten Google's per-result component lists into {type: long_name}.

    Later results are coarser, so the first value for a type wins.
    """
    out: dict[str, str] = {}
    for result in results:
        for component in result.get("address_components", []):
            for kind in component.get("types", []):
                out.setdefault(kind, component.get("long_name", ""))
    return out


def _fetch(lat: float, lon: float) -> dict[str, str] | None:
    key = settings.GOOGLE_MAPS_API_KEY
    if not key:
        return None
    cache_key = f"geo:{round(lat, _PRECISION)}:{round(lon, _PRECISION)}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached or None
    try:
        response = httpx.get(
            _ENDPOINT,
            params={
                "latlng": f"{lat},{lon}",
                "key": key,
                "language": "en",
                "result_type": _RESULT_TYPES,
            },
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001 — the manual picker is the fallback
        logger.warning("geocode_failed", error=str(exc)[:200])
        return None

    status = payload.get("status")
    if status not in ("OK", "ZERO_RESULTS"):
        # OVER_QUERY_LIMIT / REQUEST_DENIED are configuration problems and
        # worth seeing in the log, but they are still not reader-facing errors.
        logger.warning("geocode_status", status=status)
        return None

    components = _components(payload.get("results", []))
    # Cache the miss too, so a point in the sea is asked about once.
    cache_set(cache_key, components, _CACHE_TTL)
    return components or None


def resolve(db: Session, lat: float, lon: float) -> ResolvedPlace:
    """District, and as far below it as the names can be matched with confidence.

    Each level is only attempted when the level above it resolved, so a bad
    district can never drag in a mandal from somewhere else.
    """
    components = _fetch(lat, lon)
    if not components:
        return ResolvedPlace()

    state_code = _STATES.get(_norm(components.get("administrative_area_level_1")))
    if state_code is None:
        return ResolvedPlace()

    district_name = _norm(components.get("administrative_area_level_2"))
    if not district_name:
        return ResolvedPlace(state_code=state_code)

    # 59 rows. A Python scan beats teaching SQL our normalisation rules.
    district = next(
        (
            d
            for d in db.scalars(
                select(District).where(
                    District.state == state_code, District.is_active.is_(True)
                )
            )
            if _norm(d.name_en) == district_name
        ),
        None,
    )
    if district is None:
        logger.info("geocode_district_unmatched", name=district_name[:60])
        return ResolvedPlace(state_code=state_code)

    place = ResolvedPlace(state_code=state_code, district_id=district.id)

    mandal_name = components.get("administrative_area_level_3") or ""
    if not mandal_name:
        return place

    # The gazetteer already indexes names, English names and every alias, and
    # already refuses when two distinct mandals match. Reuse that judgement
    # rather than writing a second, weaker one here.
    hits = gazetteer_service.candidates(
        db, title=mandal_name, summary="", district_id=district.id
    )
    unique = {hit.mandal_id for hit in hits}
    if len(unique) != 1:
        return place
    place = ResolvedPlace(
        state_code=state_code, district_id=district.id, mandal_id=unique.pop()
    )

    locality_name = _norm(components.get("locality"))
    if not locality_name:
        return place

    locality = next(
        (
            row
            for row in db.scalars(
                select(Locality).where(
                    Locality.mandal_id == place.mandal_id,
                    Locality.is_active.is_(True),
                )
            )
            if _norm(row.name_en) == locality_name
        ),
        None,
    )
    if locality is None:
        return place
    return ResolvedPlace(
        state_code=state_code,
        district_id=district.id,
        mandal_id=place.mandal_id,
        locality_id=locality.id,
    )
