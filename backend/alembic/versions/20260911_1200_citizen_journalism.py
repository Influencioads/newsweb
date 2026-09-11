"""Citizen journalism: contributor profiles, identity documents, verified bylines.

`kyc_documents` deliberately has **no `url` column**. There is no public address
for somebody's passport scan; reading one goes through an authenticated,
audited route that streams from a private bucket. A test asserts the absence.

`articles.byline_badge` is denormalised on purpose — the reader's hot path
renders a byline chip without joining to contributor_profiles.

Revision ID: c9f2a5e14b70
Revises: b4d8e21a7c93
Create Date: 2026-09-11 12:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types

revision: str = "c9f2a5e14b70"
down_revision: Union[str, None] = "b4d8e21a7c93"
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
        "contributor_profiles",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "contributor_type",
            sa.String(length=12),
            nullable=False,
            server_default="CITIZEN",
        ),
        sa.Column(
            "kyc_status", sa.String(length=12), nullable=False, server_default="NOT_STARTED"
        ),
        sa.Column("provider", sa.String(length=30), nullable=False, server_default="manual"),
        sa.Column("provider_ref", sa.String(length=120), nullable=True),
        sa.Column("display_name_te", sa.String(length=120), nullable=False),
        sa.Column("bio_te", sa.Text(), nullable=True),
        sa.Column("district_id", sa.BigInteger(), nullable=True),
        sa.Column("mandal_id", sa.BigInteger(), nullable=True),
        sa.Column("organisation", sa.String(length=200), nullable=True),
        sa.Column("portfolio_url", sa.String(length=500), nullable=True),
        sa.Column("course_year", sa.Integer(), nullable=True),
        sa.Column("submitted_at", app.db.types.UTCDateTime(), nullable=True),
        sa.Column("reviewed_at", app.db.types.UTCDateTime(), nullable=True),
        sa.Column("reviewed_by", sa.BigInteger(), nullable=True),
        sa.Column("review_note", sa.String(length=500), nullable=True),
        sa.Column("internal_note", sa.Text(), nullable=True),
        sa.Column("expires_at", app.db.types.UTCDateTime(), nullable=True),
        sa.Column("verified_badge", sa.Boolean(), nullable=False, server_default="0"),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["district_id"], ["districts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["mandal_id"], ["mandals.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_contributor_profiles_user_id"),
        **_T,
    )
    op.create_index(
        "ix_contributor_profiles_status_created",
        "contributor_profiles",
        ["kyc_status", "created_at"],
    )

    op.create_table(
        "kyc_documents",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("profile_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        # No `url`. See the module docstring.
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("mime", sa.String(length=60), nullable=False),
        sa.Column("bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("number_masked", sa.String(length=40), nullable=True),
        sa.Column("number_encrypted", sa.Text(), nullable=True),
        sa.Column("uploaded_at", app.db.types.UTCDateTime(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["profile_id"], ["contributor_profiles.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        **_T,
    )
    op.create_index(
        "ix_kyc_documents_profile_kind", "kyc_documents", ["profile_id", "kind"]
    )

    with op.batch_alter_table("articles") as batch:
        batch.add_column(sa.Column("byline_badge", sa.String(length=30), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("articles") as batch:
        batch.drop_column("byline_badge")
    op.drop_index("ix_kyc_documents_profile_kind", table_name="kyc_documents")
    op.drop_table("kyc_documents")
    op.drop_index(
        "ix_contributor_profiles_status_created", table_name="contributor_profiles"
    )
    op.drop_table("contributor_profiles")
