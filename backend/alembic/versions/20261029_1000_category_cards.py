"""WOW category cards come from the database: tagline, icon, "listed" flag.

The Explore WOW grid, the drawer's "Explore more" list and the footer chips
were a list in the website code (features/wow/categories.ts). These columns
let the desk edit that on the Taxonomy page instead. The existing WOW rows are
filled with the copy the code carried, so the site looks the same after the
upgrade; a row an admin already gave a tagline is left alone.

Revision ID: a7c3e9f1b2d4
Revises: f6b2d8e4a1c7
Create Date: 2026-10-29 10:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types  # noqa: F401 — registers the BigInteger compile hook

revision: str = "a7c3e9f1b2d4"
down_revision: Union[str, None] = "f6b2d8e4a1c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# slug: (tagline_te, tagline_en, icon) — as features/wow/categories.ts had them.
CARDS: dict[str, tuple[str, str, str]] = {
    "real-heroes": ("అసాధారణ వ్యక్తుల విజయ గాధలు", "Success stories of extraordinary people", "medal"),
    "jai-telugoda": ("మన తెలుగోళ్ల విజయగాథలు!", "Success stories of our Telugu people!", "flag"),
    "morning-mantra": ("రోజువారీ ప్రేరణ, స్ఫూర్తి, జ్ఞానం", "Daily motivation, inspiration and wisdom", "sunrise"),
    "startup-stories": ("కొత్త ఆలోచనలు.. సరికొత్త విజయాలు!", "New ideas.. brand-new successes!", "rocket"),
    "wow-tech": ("ఫ్యూచర్ గాడ్జెట్స్.. లేటెస్ట్ టెక్నాలజీ!", "Future gadgets.. latest technology!", "cpu"),
    "business-guru": ("వ్యాపారాలు.. సలహాలు", "Businesses.. and advice", "briefcase"),
    "local-hero": ("పల్లెలు, పట్టణాల్లోని అసాధారణ వ్యక్తులు", "Extraordinary people from villages and towns", "map-pin"),
    "zero-to-hero": ("జీరో నుండి హీరోగా", "From zero to hero", "trending-up"),
    "wow-idea": ("ఐడియాతో మొదలైన ఆవిష్కరణలు", "Innovations that began with an idea", "lightbulb"),
    "mystery": ("అద్భుతాలు.. రహస్యాలు..", "Wonders.. and secrets..", "telescope"),
    "wow-puranam": ("పురాణాలు.. ఇతిహాసాలు..", "Puranas.. and epics..", "scroll"),
}


def upgrade() -> None:
    op.add_column("categories", sa.Column("tagline_te", sa.String(200), nullable=True))
    op.add_column("categories", sa.Column("tagline_en", sa.String(200), nullable=True))
    op.add_column("categories", sa.Column("icon", sa.String(40), nullable=True))
    op.add_column(
        "categories",
        sa.Column("in_explore", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
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
    op.drop_column("categories", "in_explore")
    op.drop_column("categories", "icon")
    op.drop_column("categories", "tagline_en")
    op.drop_column("categories", "tagline_te")
