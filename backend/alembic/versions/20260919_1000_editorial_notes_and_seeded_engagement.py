"""An editor's note on a story, pinned comments, and seeded engagement.

Three unrelated-looking columns that all serve the same screen, so they land
together.

`articles.critic_note_te` is the desk's own reading of a story, deliberately
separate from `correction_note_te` — a correction says we got something wrong.

`articles.seed_like_count` and the three `comments` columns are editorially
seeded engagement. The likes are an integer offset rather than fabricated
`likes` rows because that table's primary key carries a real `users.id`, so
faking rows would mean inventing accounts or liking on a real reader's behalf.
The comments hang off the real table — every comment feature already works
there — but with a NULL `user_id`, which is what makes a seeded comment
structurally impossible to attribute to a registered reader.

Widening `comments.user_id` to NULL is the only statement here with any risk.
MySQL 8 MODIFY COLUMN keeps the existing foreign key; SQLite rebuilds the
table through batch mode.

`downgrade()` will fail while any seeded comment exists, because `user_id`
goes back to NOT NULL. That is correct: the rows have no account to restore.

Revision ID: 7c1a94e2d3b8
Revises: b3f8d2c71a94
Create Date: 2026-09-19 10:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types  # noqa: F401 — registers the BigInteger compile hook

revision: str = "7c1a94e2d3b8"
down_revision: Union[str, None] = "b3f8d2c71a94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("articles") as batch:
        batch.add_column(sa.Column("critic_note_te", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column(
                "seed_like_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )

    with op.batch_alter_table("comments") as batch:
        batch.alter_column(
            "user_id", existing_type=sa.BigInteger(), nullable=True
        )
        batch.add_column(
            sa.Column("pinned_at", app.db.types.UTCDateTime(), nullable=True)
        )
        batch.add_column(
            sa.Column(
                "is_seeded", sa.Boolean(), nullable=False, server_default="0"
            )
        )
        batch.add_column(sa.Column("seed_author_name", sa.String(80), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("comments") as batch:
        batch.drop_column("seed_author_name")
        batch.drop_column("is_seeded")
        batch.drop_column("pinned_at")
        # Fails while a seeded comment exists. It has no account to restore.
        batch.alter_column(
            "user_id", existing_type=sa.BigInteger(), nullable=False
        )

    with op.batch_alter_table("articles") as batch:
        batch.drop_column("seed_like_count")
        batch.drop_column("critic_note_te")
