"""Three-hourly audio bulletins, plus segment counting on article audio.

Note what is *not* here: `audio_assets.article_id` is untouched. Making it
nullable to hold bulletins would have been the small-looking change, and it
would have silently broken the `(article_id, content_hash)` dedupe guarantee —
MySQL allows multiple NULLs in a unique index. Bulletins get their own table
and share the character budget through a query instead.

`segment_count` records how many provider calls one rendition took. Providers
cap a request in bytes and Telugu costs three bytes a character, so long copy
is now synthesised in pieces and joined; a value above 1 is normal.

Revision ID: b4d8e21a7c93
Revises: a3c7f10b8d21
Create Date: 2026-09-11 11:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types

revision: str = "b4d8e21a7c93"
down_revision: Union[str, None] = "a3c7f10b8d21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_T = dict(
    mysql_charset="utf8mb4", mysql_collate="utf8mb4_unicode_ci", mysql_engine="InnoDB"
)


def _timestamps():
    return (
        sa.Column(
            "created_at",
            app.db.types.UTCDateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP(6)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            app.db.types.UTCDateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP(6)"),
            nullable=False,
        ),
    )


def upgrade() -> None:
    op.create_table(
        "audio_bulletins",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("bulletin_date", sa.Date(), nullable=False),
        sa.Column("slot", sa.Integer(), nullable=False),
        sa.Column("slot_label_te", sa.String(length=60), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="PENDING"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("script_te", sa.Text(), nullable=True),
        sa.Column("script_hash", sa.String(length=64), nullable=True),
        sa.Column("char_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider", sa.String(length=30), nullable=False, server_default="local"),
        sa.Column("voice", sa.String(length=60), nullable=True),
        sa.Column("language", sa.String(length=10), nullable=False, server_default="te-IN"),
        sa.Column("storage_key", sa.String(length=500), nullable=True),
        sa.Column("url", sa.String(length=700), nullable=True),
        sa.Column("mime", sa.String(length=60), nullable=False, server_default="audio/mpeg"),
        sa.Column("bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("duration_sec", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("segment_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("generated_at", app.db.types.UTCDateTime(), nullable=True),
        sa.Column("published_at", app.db.types.UTCDateTime(), nullable=True),
        sa.Column("approved_by", sa.BigInteger(), nullable=True),
        sa.Column("requested_by", sa.BigInteger(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bulletin_date", "slot", name="uq_audio_bulletins_date_slot"),
        **_T,
    )
    op.create_index(
        "ix_audio_bulletins_status_date_slot",
        "audio_bulletins",
        ["status", "bulletin_date", "slot"],
    )

    op.create_table(
        "audio_bulletin_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("bulletin_id", sa.BigInteger(), nullable=False),
        sa.Column("article_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("headline_te", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("spoken_te", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["bulletin_id"], ["audio_bulletins.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "bulletin_id", "article_id", name="uq_audio_bulletin_items_bulletin_article"
        ),
        sa.UniqueConstraint(
            "bulletin_id", "position", name="uq_audio_bulletin_items_bulletin_position"
        ),
        **_T,
    )

    with op.batch_alter_table("audio_assets") as batch:
        batch.add_column(
            sa.Column(
                "segment_count", sa.Integer(), nullable=False, server_default="1"
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("audio_assets") as batch:
        batch.drop_column("segment_count")
    op.drop_table("audio_bulletin_items")
    op.drop_index("ix_audio_bulletins_status_date_slot", table_name="audio_bulletins")
    op.drop_table("audio_bulletins")
