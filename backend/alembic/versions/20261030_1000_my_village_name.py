"""My Village Story is now just "My Village" (మై విలేజ్).

Data only. Renames the seeded `my-village-story` category, but only while it
still carries the seeded name — a name an admin set on the Taxonomy page is
left alone. The slug, and so every URL, stays the same.

Revision ID: a4c8e2f6b9d1
Revises: f6b2d8e4a1c7
Create Date: 2026-10-30 10:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a4c8e2f6b9d1"
down_revision: Union[str, None] = "f6b2d8e4a1c7"
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


def upgrade() -> None:
    _rename(_OLD, _NEW)


def downgrade() -> None:
    _rename(_NEW, _OLD)
