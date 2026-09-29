"""Crawled article images: a per-source kill switch and the candidate list.

`content_sources.images_enabled` defaults to 0 and stays there. Every existing
source keeps behaving exactly as it does today, and turning image download on
is a per-source decision an admin makes and the audit log records — which is
the point. Defaulting it on would have forty sources downloading pictures the
first hour after deploy.

`ingested_items.image_urls` holds every candidate that survived the filter in
`app/integrations/feeds/images.py`, in feed order. `image_url` stays as its own
column and keeps its meaning — the first of these — because the review queue
and `crawl_service` have always read it and there is no reason to move them.

Revision ID: 6c9a3e1d4b05
Revises: 5b8f2d0c3a94
Create Date: 2026-09-22 11:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types  # noqa: F401 — registers the BigInteger compile hook

revision: str = "6c9a3e1d4b05"
down_revision: Union[str, None] = "5b8f2d0c3a94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("content_sources") as batch:
        batch.add_column(
            sa.Column(
                "images_enabled", sa.Boolean(), nullable=False, server_default="0"
            )
        )

    with op.batch_alter_table("ingested_items") as batch:
        batch.add_column(sa.Column("image_urls", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("ingested_items") as batch:
        batch.drop_column("image_urls")

    with op.batch_alter_table("content_sources") as batch:
        batch.drop_column("images_enabled")
