"""AI usage ledger, so the declared budget and quotas can actually be enforced.

`AI_MONTHLY_BUDGET_INR`, `AI_QUOTA_STRINGER_PER_DAY` and
`AI_QUOTA_REPORTER_PER_DAY` shipped in config from the start and were read by
no code, because there was nothing to count against — `AiBudgetExceededError`
and `AiQuotaExceededError` were defined and never raised. This table is what
makes those limits real.

Cost is an integer column of **paise**, not a float of rupees: a budget
comparison that accumulates rounding error is worse than no budget, because it
still looks enforced.

Revision ID: d1e4f7a92b83
Revises: c9f2a5e14b70
Create Date: 2026-09-15 10:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types

revision: str = "d1e4f7a92b83"
down_revision: Union[str, None] = "c9f2a5e14b70"
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
        "ai_usage",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("operation", sa.String(length=40), nullable=False),
        sa.Column("provider", sa.String(length=60), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=True),
        sa.Column("actor_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "prompt_tokens", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "completion_tokens", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("cost_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("error", sa.String(length=300), nullable=True),
        *_timestamps(),
        # A deleted user must not take the month's spend history with them —
        # the budget is the newsroom's, not the individual's.
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        **_T,
    )
    op.create_index("ix_ai_usage_created", "ai_usage", ["created_at"])
    op.create_index(
        "ix_ai_usage_actor_created", "ai_usage", ["actor_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_ai_usage_actor_created", table_name="ai_usage")
    op.drop_index("ix_ai_usage_created", table_name="ai_usage")
    op.drop_table("ai_usage")
