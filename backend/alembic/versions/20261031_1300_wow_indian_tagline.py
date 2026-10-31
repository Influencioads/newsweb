"""The WOW Indian category (slug zero-to-hero) gets its new one-line description.

Data only. Replaces the seeded "జీరో నుండి హీరోగా" / "From zero to hero"
tagline, but only while it is still that seeded text — a tagline an admin set
on the Taxonomy page is left alone.

Revision ID: f2c8a4e6b1d3
Revises: e7b3c9d5f2a8
Create Date: 2026-10-31 13:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f2c8a4e6b1d3"
down_revision: Union[str, None] = "e7b3c9d5f2a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD = ("జీరో నుండి హీరోగా", "From zero to hero")
_NEW = (
    "సవాళ్లను ఎదిరించి అద్భుత విజయాలతో స్ఫూర్తినిచ్చిన భారతీయులు",
    "Indians who took on challenges and inspire with remarkable success",
)


def _retag(src: tuple[str, str], dst: tuple[str, str]) -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE categories SET tagline_te = :te, tagline_en = :en "
            "WHERE slug = 'zero-to-hero' AND tagline_te = :old_te AND tagline_en = :old_en"
        ),
        {"te": dst[0], "en": dst[1], "old_te": src[0], "old_en": src[1]},
    )


def upgrade() -> None:
    _retag(_OLD, _NEW)


def downgrade() -> None:
    _retag(_NEW, _OLD)
