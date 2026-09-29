"""E-paper pages are laid out by slots, not story counts.

A page template no longer carries a `story_count`: the layout decides how many
stories fit (see `app.services.epaper_layouts`). The seeded template rows are
also cleared, because six of them named category slugs that never existed and
therefore matched every story; `ensure_templates()` reseeds the corrected set
on the next request. `epaper_pages.template_id` is ON DELETE SET NULL, so
existing editions keep every page.

Revision ID: b3f8d2c71a94
Revises: d1e4f7a92b83
Create Date: 2026-09-15 15:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b3f8d2c71a94"
down_revision: Union[str, None] = "d1e4f7a92b83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM epaper_page_templates")
    with op.batch_alter_table("epaper_page_templates") as batch:
        batch.drop_column("story_count")


def downgrade() -> None:
    with op.batch_alter_table("epaper_page_templates") as batch:
        batch.add_column(
            sa.Column("story_count", sa.Integer(), nullable=False, server_default="6")
        )
