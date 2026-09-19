"""Twelve kinds of expert contributor, on one nullable column.

Industry leaders, doctors, panchayat members and nine more. One column, not
twelve of anything, because both alternatives are worse.

Not new `ContributorType` members: that enum keys `kyc_service.REQUIRED_DOCS`,
so it answers *what proof do you owe*, and it feeds `articles.byline_badge`,
whose meaning is **verification standing**. A badge reading "medical" would
tell a reader we had checked somebody is a doctor when all we checked was a
PAN card. Its column is 12 characters wide, and `citizen_journalism` is 18.

Not twelve new `RoleKey`s either: that would be twelve identical permission
sets differing only by their label.

`locality_id` is where a gram panchayat lives — a panchayat *is* a `Locality`,
so a panchayat contributor's patch is one of those and not a new table. The
two `panchayat_publish_*` columns are the seat for the second half of this
feature: deciding somebody's copy may skip the queue is a different decision,
by a different person, from deciding who they are.

Revision ID: 4a7e1c9b2f83
Revises: 7c1a94e2d3b8
Create Date: 2026-09-22 10:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types  # noqa: F401 — registers the BigInteger compile hook

revision: str = "4a7e1c9b2f83"
down_revision: Union[str, None] = "7c1a94e2d3b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _supports_alter_fk() -> bool:
    """SQLite cannot ALTER a constraint into an existing table, and does not
    enforce foreign keys by default anyway. MySQL gets the full definition."""
    return op.get_bind().dialect.name != "sqlite"


def upgrade() -> None:
    with op.batch_alter_table("contributor_profiles") as batch:
        batch.add_column(sa.Column("vertical", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("locality_id", sa.BigInteger(), nullable=True))
        batch.add_column(
            sa.Column(
                "panchayat_publish_granted_at",
                app.db.types.UTCDateTime(),
                nullable=True,
            )
        )
        batch.add_column(
            sa.Column("panchayat_publish_granted_by", sa.BigInteger(), nullable=True)
        )
        if _supports_alter_fk():
            batch.create_foreign_key(
                "fk_contributor_profiles_locality_id_localities",
                "localities",
                ["locality_id"],
                ["id"],
                ondelete="SET NULL",
            )
            batch.create_foreign_key(
                "fk_contributor_profiles_panchayat_granted_by_users",
                "users",
                ["panchayat_publish_granted_by"],
                ["id"],
                ondelete="SET NULL",
            )

    # The desk works one vertical at a time, and always within a status.
    op.create_index(
        "ix_contributor_profiles_vertical_status",
        "contributor_profiles",
        ["vertical", "kyc_status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_contributor_profiles_vertical_status",
        table_name="contributor_profiles",
    )
    with op.batch_alter_table("contributor_profiles") as batch:
        if _supports_alter_fk():
            batch.drop_constraint(
                "fk_contributor_profiles_panchayat_granted_by_users",
                type_="foreignkey",
            )
            batch.drop_constraint(
                "fk_contributor_profiles_locality_id_localities", type_="foreignkey"
            )
        batch.drop_column("panchayat_publish_granted_by")
        batch.drop_column("panchayat_publish_granted_at")
        batch.drop_column("locality_id")
        batch.drop_column("vertical")
