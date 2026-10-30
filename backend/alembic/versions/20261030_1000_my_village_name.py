"""My Village and WOW News become WOW category cards; My Village Story is renamed.

Data only. Lists `my-village-story` and `wow-news` as WOW category cards
(Explore WOW, drawer, footer chips) with a tagline and icon, unless an admin
already gave them a tagline. Renames the seeded `my-village-story` category, but only while it
still carries the seeded name — a name an admin set on the Taxonomy page is
left alone. The slug, and so every URL, stays the same.

Revision ID: a4c8e2f6b9d1
Revises: a7c3e9f1b2d4
Create Date: 2026-10-30 10:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a4c8e2f6b9d1"
down_revision: Union[str, None] = "a7c3e9f1b2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD = ("మై విలేజ్ స్టోరీ", "My Village Story")
_NEW = ("మై విలేజ్", "My Village")


def _rename(src: tuple[str, str], dst: tuple[str, str]) -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE categories SET name_te = :te, name_en = :en "
            "WHERE slug = 'my-village-story' AND name_te = :old_te AND name_en = :old_en"
        ),
        {"te": dst[0], "en": dst[1], "old_te": src[0], "old_en": src[1]},
    )


# slug: (tagline_te, tagline_en, icon) — the same as seed_content.WOW_CARDS.
CARDS: dict[str, tuple[str, str, str]] = {
    "my-village-story": ("మన ఊళ్ల కథలు.. మనుషులు..", "Stories of our villages.. and their people..", "sprout"),
    "wow-news": ("వావ్ అనిపించే వార్తలు", "News that makes you say WOW", "newspaper"),
}


def upgrade() -> None:
    _rename(_OLD, _NEW)
    conn = op.get_bind()
    for slug, (tagline_te, tagline_en, icon) in CARDS.items():
        conn.execute(
            sa.text(
                "UPDATE categories SET tagline_te = :te, tagline_en = :en, icon = :icon, "
                "in_explore = :yes WHERE slug = :slug AND tagline_te IS NULL"
            ),
            {"te": tagline_te, "en": tagline_en, "icon": icon, "yes": True, "slug": slug},
        )


def downgrade() -> None:
    _rename(_NEW, _OLD)
    op.get_bind().execute(
        sa.text(
            "UPDATE categories SET tagline_te = NULL, tagline_en = NULL, icon = NULL, in_explore = :no "
            "WHERE slug IN ('my-village-story', 'wow-news')"
        ),
        {"no": False},
    )
