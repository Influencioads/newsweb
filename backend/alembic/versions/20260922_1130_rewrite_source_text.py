"""The reviewer's copy of the original, beside the rewrite.

We do not publish anyone else's article as-is: the crawl rewrites it and an
editor verifies the rewrite before it goes live. Verifying against a forty-word
feed stub is not verification, so `ingested_rewrites.source_text` holds the
page text the rewrite was actually produced from.

Why this column is defensible where `ingested_items.content_html` would not
be: `ingested_rewrites` is a queue-only table that no public serializer reads,
whereas `_body_document` can publish `content_html` verbatim. It is only
written when the HTML fallback really fetched a page — which requires
`allow_html_fallback`, which in turn requires a written `licence_note` — it is
capped at 8,000 characters, and `ingestion_service.drop_source_text` NULLs it
on both import and reject. A working copy for the length of one review, not an
archive of somebody else's site.

Nullable with no backfill: existing rows never had the text, and the crawl
writes it on the next rewrite pass.

Revision ID: 7d0b4f2e5c16
Revises: 6c9a3e1d4b05
Create Date: 2026-09-22 11:30:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types  # noqa: F401 — registers the BigInteger compile hook

revision: str = "7d0b4f2e5c16"
down_revision: Union[str, None] = "6c9a3e1d4b05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("ingested_rewrites") as batch:
        batch.add_column(sa.Column("source_text", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("ingested_rewrites") as batch:
        batch.drop_column("source_text")
