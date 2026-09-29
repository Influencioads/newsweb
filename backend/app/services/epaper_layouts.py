"""Page geometry for generated e-paper editions.

A page is a 6x6 grid. Each layout is a fixed list of slots; a slot has a
position in grid units and a *size* that says what kind of story fits there:

* ``lead``     — photo, headline, five lines of standfirst
* ``standard`` — small photo, headline, two lines
* ``brief``    — headline only

This module is the single source of truth. The web reader, the mobile app and
the PDF renderer all take the slot geometry from the page JSON rather than
keeping their own tables, so a layout added here shows up everywhere at once.

Slot index and article position are the same thing off by one: the story in
slot ``i`` is stored with ``position = i + 1``. Gaps are allowed — an empty
slot is simply a position nobody holds.
"""

from __future__ import annotations

from typing import NamedTuple

GRID_COLS, GRID_ROWS = 6, 6

#: A slot of a given size accepts a story of that size or bigger.
SIZE_RANK: dict[str, int] = {"brief": 0, "standard": 1, "lead": 2}

#: Word counts below which a story is not worth a lead / standard slot.
LEAD_WORDS, STANDARD_WORDS = 150, 60

#: Pages beyond the section templates are filled with whatever is left.
OVERFLOW_LAYOUT = "three_column"


class Slot(NamedTuple):
    x: int
    y: int
    w: int
    h: int
    size: str


def _row(y: int, size: str, h: int) -> tuple[Slot, ...]:
    """Three equal cells across the page at row ``y``."""
    return tuple(Slot(x, y, 2, h, size) for x in (0, 2, 4))


LAYOUTS: dict[str, tuple[Slot, ...]] = {
    "lead_grid": (
        Slot(0, 0, 4, 3, "lead"),
        Slot(4, 0, 2, 2, "standard"),
        Slot(4, 2, 2, 1, "brief"),
        *_row(3, "standard", 2),
        *_row(5, "brief", 1),
    ),
    "image_lead": (Slot(0, 0, 6, 3, "lead"), *_row(3, "standard", 2), *_row(5, "brief", 1)),
    "two_column": (
        Slot(0, 0, 3, 3, "lead"),
        Slot(3, 0, 3, 3, "lead"),
        *_row(3, "standard", 2),
        *_row(5, "brief", 1),
    ),
    "three_column": (
        *_row(0, "standard", 2),
        *_row(2, "standard", 2),
        *_row(4, "brief", 1),
        *_row(5, "brief", 1),
    ),
    "briefs": (
        *_row(0, "standard", 2),
        *_row(2, "brief", 1),
        *_row(3, "brief", 1),
        *_row(4, "brief", 1),
        *_row(5, "brief", 1),
    ),
    # Row 5 stays free for the Big Question poll strip.
    "breaking": (Slot(0, 0, 6, 3, "lead"), *_row(3, "standard", 2)),
}

LAYOUT_TYPES: tuple[str, ...] = tuple(LAYOUTS)


def slots_for(layout_type: str) -> tuple[Slot, ...]:
    """The slots of a layout; an unknown name falls back to the front-page grid."""
    return LAYOUTS.get(layout_type, LAYOUTS["lead_grid"])


def slot_count(layout_type: str) -> int:
    return len(slots_for(layout_type))


def size_class(article) -> str:  # type: ignore[no-untyped-def]
    """How big a slot a story deserves.

    ``word_count`` is filled by every ingest path, but older rows may carry the
    column default of 0, so the plain-text body is counted as a fallback.
    """
    words = article.word_count or len((article.body_plain or "").split())
    hero = article.hero_media_id is not None
    if hero and (words >= LEAD_WORDS or article.is_breaking):
        return "lead"
    if words >= STANDARD_WORDS or hero:
        return "standard"
    return "brief"


def size_rank(article) -> int:  # type: ignore[no-untyped-def]
    return SIZE_RANK[size_class(article)]
