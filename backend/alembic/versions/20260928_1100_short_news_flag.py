"""Short news: a flag that puts an article in the swipe feed.

Until now the short-news feed was every published story with a summary — in
practice the whole newswire. Editors now mark an item as short news (a photo
and a few lines of text), and only those items reach the feed. Every existing
row is an ordinary article, so the default is false.

Revision ID: b4d8f26a1c93
Revises: a7c3e91f5b20
Create Date: 2026-09-28 11:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b4d8f26a1c93"
down_revision: Union[str, None] = "a7c3e91f5b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("articles") as batch:
        batch.add_column(sa.Column("is_short", sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("articles") as batch:
        batch.drop_column("is_short")
