"""The writer's photo beside a story's byline ("Written by" on My Village stories).

Adds `articles.byline_photo_media_id`, set in the CMS story editor next to the
writer's name, and filled from the writer's selfie when a Share Your Village
story is approved.

Revision ID: a9d4e2c7b5f1
Revises: f2c8a4e6b1d3
Create Date: 2026-11-05 10:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9d4e2c7b5f1"
down_revision: Union[str, None] = "f2c8a4e6b1d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("articles") as batch:
        batch.add_column(sa.Column("byline_photo_media_id", sa.BigInteger(), nullable=True))
        batch.create_foreign_key(
            "fk_articles_byline_photo_media_id_media",
            "media",
            ["byline_photo_media_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("articles") as batch:
        batch.drop_constraint("fk_articles_byline_photo_media_id_media", type_="foreignkey")
        batch.drop_column("byline_photo_media_id")
