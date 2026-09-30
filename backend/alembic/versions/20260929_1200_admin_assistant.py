"""Sanjaya, the newsroom assistant: conversations, messages and background jobs.

A chat turn is several model calls plus tool calls, which outlives the browser's
20 s timeout and nginx's 120 s ceiling, so the turn runs in the background and
the page polls `assistant_conversations.status`. Multi-minute work a tool starts
(write N articles, crawl, prepare a bulletin) gets its own `assistant_jobs` row
with progress and a heartbeat, since no generic job table existed.

`assistant_messages.payload` stores the provider's message verbatim — Gemini's
tool calls carry a `thought_signature` that must be echoed back next turn.

Revision ID: c5e2a7d91f04
Revises: b4d8f26a1c93
Create Date: 2026-09-29 12:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

import app.db.types

revision: str = "c5e2a7d91f04"
down_revision: Union[str, None] = "b4d8f26a1c93"
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
        "assistant_conversations",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="idle"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("heartbeat_at", app.db.types.UTCDateTime(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        **_T,
    )
    op.create_index(
        "ix_assistant_conversations_user_updated",
        "assistant_conversations",
        ["user_id", "updated_at"],
    )

    op.create_table(
        "assistant_messages",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("conversation_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(length=12), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("payload", mysql.JSON(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["assistant_conversations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        **_T,
    )
    op.create_index(
        "ix_assistant_messages_conversation",
        "assistant_messages",
        ["conversation_id", "id"],
    )

    op.create_table(
        "assistant_jobs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("conversation_id", sa.BigInteger(), nullable=True),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("params", mysql.JSON(), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="queued"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("step_text", sa.String(length=300), nullable=True),
        sa.Column("result", mysql.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", app.db.types.UTCDateTime(), nullable=True),
        sa.Column("finished_at", app.db.types.UTCDateTime(), nullable=True),
        sa.Column("heartbeat_at", app.db.types.UTCDateTime(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["assistant_conversations.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        **_T,
    )
    op.create_index(
        "ix_assistant_jobs_user_created", "assistant_jobs", ["user_id", "created_at"]
    )
    op.create_index("ix_assistant_jobs_status", "assistant_jobs", ["status"])


def downgrade() -> None:
    # Tables only: each index leads with its table's foreign-key column, and
    # MySQL refuses to drop an index a foreign key relies on (error 1553) —
    # dropping the table takes its indexes with it.
    op.drop_table("assistant_jobs")
    op.drop_table("assistant_messages")
    op.drop_table("assistant_conversations")
