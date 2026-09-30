"""Crawl enrichment: the AI files each story, checks its photos, suggests Breaking.

The rewrite call now also returns where a story belongs — section, place,
tags — validated against our own tables and kept on the rewrite that produced
it. Every crawled photo is looked at before it is stored, and the verdicts sit
on the item so the desk can see why a picture was or was not used. Breaking
stays an editor's decision: the model's opinion is a column of its own, never
`is_breaking`. All three are empty for every existing row.

Revision ID: e3f9a1c7d2b5
Revises: c5e2a7d91f04
Create Date: 2026-09-30 10:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "e3f9a1c7d2b5"
down_revision: Union[str, None] = "c5e2a7d91f04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("ingested_rewrites") as batch:
        batch.add_column(sa.Column("classification", mysql.JSON(), nullable=True))
    with op.batch_alter_table("ingested_items") as batch:
        batch.add_column(sa.Column("photo_check", mysql.JSON(), nullable=True))
    with op.batch_alter_table("articles") as batch:
        batch.add_column(
            sa.Column("breaking_suggested", sa.Boolean(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("articles") as batch:
        batch.drop_column("breaking_suggested")
    with op.batch_alter_table("ingested_items") as batch:
        batch.drop_column("photo_check")
    with op.batch_alter_table("ingested_rewrites") as batch:
        batch.drop_column("classification")
