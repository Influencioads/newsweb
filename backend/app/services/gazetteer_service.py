"""Guessing which mandal a crawled story is about, and admitting when we cannot.

The brief asks for hourly coverage of every mandal in both Telugu states. There
are roughly 1,290 of them and nowhere near that many usable feeds — mandal-level
RSS essentially does not exist. So coverage is reached the only way it can be:
crawl district, state and national sources, and work out the mandal from the
words.

That is a guess, and this module is built to be honest about it rather than
accurate-sounding:

  * **Ambiguity is an outcome, not a tie to break.** Telugu mandal names collide
    across districts — కొత్తపేట, గాంధీనగర్, రామాపురం and చందాపూర్ each name
    several places, and some are ordinary words. Two distinct candidates means
    we return nothing and keep the district. Silently taking the first match is
    how a Nellore story ends up on a Karimnagar page, and nobody notices for a
    week.
  * **Only the headline and summary are searched.** Bylines, related-link rails
    and footers are full of place names that have nothing to do with the story.
  * **District scoping is the real accuracy lever.** With the source's district
    known, the candidate set drops from ~1,290 to ~20–50 and most collisions
    disappear. Expect roughly 60–75% correct on district-local feeds with
    aliases seeded, and close to nothing on national ones.
  * Confidence is stored alongside the answer, and the import form shows both
    with a one-click override. Nothing downstream may treat this as an
    assignment.

Matching is on normalised token unigrams and bigrams against an index built
once per run. Scanning 1,290 names × two languages × aliases with `str.find`
for every item would be thousands of calls per item; a dict lookup is about
120 hits and microseconds.
"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.enums import MandalMatchMethod
from app.models.geo import Mandal, MandalAlias
from app.telugu.normalize import normalize_text

logger = get_logger(__name__)

#: Long enough that a crawl pass reuses one index, short enough that a mandal
#: added in the admin screen starts matching within the quarter hour.
_TTL_SECONDS = 900.0

#: Names shorter than this are ordinary Telugu words as often as they are
#: places. The floor is configurable per deployment via `crawl.mandal_min_name_len`.
DEFAULT_MIN_NAME_LEN = 4

#: Names that are common nouns or appear in most political copy. Matching these
#: would tag half the state's news to one mandal.
_STOP_NAMES = frozenset(
    {
        "నగర్",
        "పురం",
        "పేట",
        "పల్లి",
        "గూడెం",
        "city",
        "town",
        "rural",
        "urban",
        "north",
        "south",
        "east",
        "west",
    }
)

_TOKEN = re.compile(r"[^\wఀ-౿]+", re.UNICODE)

#: Telugu is agglutinative: a place name in running copy almost never appears
#: bare. "కొత్తపేట" is written "కొత్తపేటలో" (in Kothapeta), "కొత్తపేటకు" (to
#: Kothapeta), "కొత్తపేట మండలంలో", and so on. Matching only the citation form
#: misses the large majority of real mentions, which is the difference between
#: this feature working and it quietly returning nothing.
#:
#: Longest first, so "లోని" is tried before "లో".
_SUFFIXES: tuple[str, ...] = (
    "మండలంలో",
    "పట్టణంలో",
    "మండలం",
    "పట్టణం",
    "గ్రామంలో",
    "గ్రామం",
    "జిల్లాలో",
    "జిల్లా",
    "నియోజకవర్గం",
    "లోంచి",
    "నుంచి",
    "నుండి",
    "లోని",
    "లోకి",
    "వద్ద",
    "కు",
    "కి",
    "లో",
    "పై",
    "తో",
    "ను",
    "లు",
    "ది",
    "న",
)

#: Never strip a suffix down past this, or "లోను" becomes "లో" becomes noise.
_MIN_STEM = 3


def _variants(key: str) -> set[str]:
    """A key plus the case-stripped stems it could be an inflection of."""
    out = {key}
    for suffix in _SUFFIXES:
        if key.endswith(suffix):
            stem = key[: -len(suffix)].strip()
            if len(stem) >= _MIN_STEM:
                out.add(stem)
                # One more pass catches stacked suffixes such as "మండలంలోని".
                for second in _SUFFIXES:
                    if stem.endswith(second):
                        inner = stem[: -len(second)].strip()
                        if len(inner) >= _MIN_STEM:
                            out.add(inner)
            break
    return out


_lock = threading.Lock()
_index: dict[str, set[int]] = {}
_meta: dict[int, tuple[int, str]] = {}  # mandal_id -> (district_id, name_te)
_built_at: float = 0.0


def _tokens(text: str) -> list[str]:
    normalised = normalize_text(text or "").casefold()
    return [t for t in _TOKEN.split(normalised) if t]


def _keys(text: str) -> set[str]:
    """Every form a mandal name could take in this text.

    Unigrams and bigrams — 'కొత్త పేట' and 'కొత్తపేట' both have to hit — each
    expanded into its case-stripped stems.
    """
    tokens = _tokens(text)
    base = set(tokens)
    base.update(f"{a} {b}" for a, b in zip(tokens, tokens[1:]))
    base.update(f"{a}{b}" for a, b in zip(tokens, tokens[1:]))

    keys: set[str] = set()
    for key in base:
        keys |= _variants(key)
    return keys


def _index_key(name: str) -> str | None:
    tokens = _tokens(name)
    if not tokens:
        return None
    return " ".join(tokens)


def invalidate() -> None:
    """Drop the index — called after a mandal or alias is edited, and by tests."""
    global _index, _meta, _built_at
    with _lock:
        _index, _meta, _built_at = {}, {}, 0.0


def build_index(db: Session, *, force: bool = False) -> None:
    """Load every active mandal name and alias into the lookup table."""
    global _index, _meta, _built_at
    with _lock:
        if not force and _index and (time.monotonic() - _built_at) < _TTL_SECONDS:
            return

    index: dict[str, set[int]] = {}
    meta: dict[int, tuple[int, str]] = {}

    def add(name: str, mandal_id: int) -> None:
        key = _index_key(name)
        if not key or key in _STOP_NAMES:
            return
        index.setdefault(key, set()).add(mandal_id)
        # A two-word name must also match when written closed up, which Telugu
        # copy does constantly.
        joined = key.replace(" ", "")
        if joined != key:
            index.setdefault(joined, set()).add(mandal_id)

    for mandal in db.scalars(select(Mandal).where(Mandal.is_active.is_(True))).all():
        meta[mandal.id] = (mandal.district_id, mandal.name_te)
        add(mandal.name_te, mandal.id)
        add(mandal.name_en, mandal.id)

    for alias in db.scalars(select(MandalAlias)).all():
        if alias.mandal_id in meta:
            add(alias.alias, alias.mandal_id)

    with _lock:
        _index, _meta, _built_at = index, meta, time.monotonic()
    logger.info("gazetteer_built", mandals=len(meta), keys=len(index))


@dataclass(frozen=True, slots=True)
class MandalHit:
    mandal_id: int
    district_id: int
    name: str
    in_title: bool


def candidates(
    db: Session,
    *,
    title: str,
    summary: str,
    district_id: int | None,
    min_name_len: int = DEFAULT_MIN_NAME_LEN,
) -> list[MandalHit]:
    """Every distinct mandal named in the headline or summary."""
    build_index(db)
    with _lock:
        index, meta = _index, _meta
    if not index:
        return []

    title_keys = _keys(title)
    summary_keys = _keys(summary)

    hits: dict[int, MandalHit] = {}
    for keys, in_title in ((title_keys, True), (summary_keys, False)):
        for key in keys:
            if len(key.replace(" ", "")) < min_name_len:
                continue
            for mandal_id in index.get(key, ()):
                entry = meta.get(mandal_id)
                if entry is None:
                    continue
                mandal_district, name = entry
                # Scoping to the source's district is what makes this usable:
                # it removes the same-name-different-district collisions that
                # are the dominant error mode.
                if district_id is not None and mandal_district != district_id:
                    continue
                existing = hits.get(mandal_id)
                if existing is None or (in_title and not existing.in_title):
                    hits[mandal_id] = MandalHit(
                        mandal_id=mandal_id,
                        district_id=mandal_district,
                        name=name,
                        in_title=in_title,
                    )
    return list(hits.values())


def resolve(
    db: Session,
    *,
    title: str,
    summary: str = "",
    district_id: int | None = None,
    min_name_len: int = DEFAULT_MIN_NAME_LEN,
) -> tuple[int | None, MandalMatchMethod, float]:
    """`(mandal_id, method, confidence)` for one item.

    Returns `AMBIGUOUS` with no id when more than one distinct mandal is named.
    A story that mentions two places is usually about neither of them
    specifically, and when it is, an editor can say which in one click.
    """
    found = candidates(
        db,
        title=title,
        summary=summary,
        district_id=district_id,
        min_name_len=min_name_len,
    )
    if not found:
        return None, MandalMatchMethod.NONE, 0.0
    if len(found) > 1:
        return None, MandalMatchMethod.AMBIGUOUS, 0.0

    hit = found[0]
    # A place named in the headline is what the story is about. A place named
    # only in the standfirst may just be where somebody said something.
    confidence = 0.85 if hit.in_title else 0.6
    return hit.mandal_id, MandalMatchMethod.KEYWORD, confidence


def district_of(db: Session, mandal_id: int | None) -> int | None:
    """The district a mandal belongs to, from the cached index."""
    if mandal_id is None:
        return None
    build_index(db)
    with _lock:
        entry = _meta.get(mandal_id)
    return entry[0] if entry else None
