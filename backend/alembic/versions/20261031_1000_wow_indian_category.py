"""The Zero to Hero category is renamed WOW Indian.

Data only. Renames the seeded `zero-to-hero` category, but only while it
still carries the seeded name — a name an admin set on the Taxonomy page is
left alone. The slug, and so every URL, stays the same.

Revision ID: e7b3c9d5f2a8
Revises: d4f8b2c6e1a9
Create Date: 2026-10-31 10:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e7b3c9d5f2a8"
down_revision: Union[str, None] = "d4f8b2c6e1a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD = ("జీరో టు హీరో", "Zero to Hero")
_NEW = ("వావ్ ఇండియన్", "WOW Indian")


def _rename(src: tuple[str, str], dst: tuple[str, str]) -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE categories SET name_te = :te, name_en = :en "
            "WHERE slug = 'zero-to-hero' AND name_te = :old_te AND name_en = :old_en"
        ),
        {"te": dst[0], "en": dst[1], "old_te": src[0], "old_en": src[1]},
    )


def upgrade() -> None:
    _rename(_OLD, _NEW)


def downgrade() -> None:
    _rename(_NEW, _OLD)
