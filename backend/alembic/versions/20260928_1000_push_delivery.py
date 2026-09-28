"""Push delivery: campaign status, schedule and stats; anonymous devices.

Until now a campaign was only inbox rows and the push sender was a stub. Now:

  * `notification_campaigns` carries a status (scheduled → queued → sending →
    sent / failed, or cancelled), `send_at` / `sent_at`, and the push counts.
    Every existing row was an inbox-only send, so the status default is 'sent'
    and the worker never picks an old campaign up.
  * `push_devices.user_id` becomes nullable — most app readers never sign in —
    and a device remembers the district chosen on the phone, which is how an
    anonymous install is reached by district and local pushes.

Revision ID: a7c3e91f5b20
Revises: 8e1c5a3f6d27
Create Date: 2026-09-28 10:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types  # noqa: F401 — registers the BigInteger compile hook

revision: str = "a7c3e91f5b20"
down_revision: Union[str, None] = "8e1c5a3f6d27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COUNTS = ("devices", "push_ok", "push_failed", "opened")


def upgrade() -> None:
    with op.batch_alter_table("notification_campaigns") as batch:
        batch.add_column(
            sa.Column("status", sa.String(length=12), nullable=False, server_default="sent")
        )
        batch.add_column(sa.Column("send_at", app.db.types.UTCDateTime(), nullable=True))
        batch.add_column(sa.Column("sent_at", app.db.types.UTCDateTime(), nullable=True))
        for name in _COUNTS:
            batch.add_column(
                sa.Column(name, sa.Integer(), nullable=False, server_default="0")
            )
    op.create_index(
        "ix_notification_campaigns_status", "notification_campaigns", ["status"], unique=False
    )

    with op.batch_alter_table("push_devices") as batch:
        batch.alter_column("user_id", existing_type=sa.BigInteger(), nullable=True)
        batch.add_column(sa.Column("district_id", sa.BigInteger(), nullable=True))
        batch.create_foreign_key(
            "fk_push_devices_district_id_districts",
            "districts",
            ["district_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    # An anonymous token has no account to fall back to; it goes with the column.
    op.execute("DELETE FROM push_devices WHERE user_id IS NULL")
    with op.batch_alter_table("push_devices") as batch:
        batch.drop_constraint("fk_push_devices_district_id_districts", type_="foreignkey")
        batch.drop_column("district_id")
        batch.alter_column("user_id", existing_type=sa.BigInteger(), nullable=False)

    op.drop_index("ix_notification_campaigns_status", table_name="notification_campaigns")
    with op.batch_alter_table("notification_campaigns") as batch:
        for name in reversed(_COUNTS):
            batch.drop_column(name)
        batch.drop_column("sent_at")
        batch.drop_column("send_at")
        batch.drop_column("status")
