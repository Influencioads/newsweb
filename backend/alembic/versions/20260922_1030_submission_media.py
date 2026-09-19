"""Photographs on a reader's submission.

`kyc_service.may_attach_images()` has been in the tree since citizen
journalism shipped, documented as one of the three things verification buys,
with nothing calling it. This column is what it now guards: up to four media
ids, in the order the contributor sent them, the first of which becomes the
article's hero when a moderator approves the story.

JSON rather than a join table because nothing but this row ever reads the
list and the cap is four — `media.variants` and `ingested_rewrites.body`
store structured values the same way. The real join rows, `article_media`,
are written at approval, where they belong.

Revision ID: 5b8f2d0c3a94
Revises: 4a7e1c9b2f83
Create Date: 2026-09-22 10:30:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types  # noqa: F401 — registers the BigInteger compile hook

revision: str = "5b8f2d0c3a94"
down_revision: Union[str, None] = "4a7e1c9b2f83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("creator_submissions") as batch:
        batch.add_column(sa.Column("media_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("creator_submissions") as batch:
        batch.drop_column("media_ids")
