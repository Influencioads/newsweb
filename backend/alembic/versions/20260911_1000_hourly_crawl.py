"""Hourly crawl: beats, mandal matching, AI rewrites, job notifications.

Deliberately behaviour-neutral. Every existing source lands in the GENERAL
beat, whose default hourly quota is zero, and the `crawl.enabled` setting
defaults to false — so applying this migration changes nothing until an admin
classifies a source and turns the crawl on.

No `articles` DDL is needed for the new `AI_REWRITE` article type: these enums
are declared `native_enum=False`, which is a plain VARCHAR with no CHECK, so a
new value costs nothing. (The phase_j docstring claims otherwise; it is wrong,
harmlessly.)

Revision ID: a3c7f10b8d21
Revises: f7a91d2c4e60
Create Date: 2026-09-11 10:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types

revision: str = "a3c7f10b8d21"
down_revision: Union[str, None] = "f7a91d2c4e60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_T = dict(
    mysql_charset="utf8mb4", mysql_collate="utf8mb4_unicode_ci", mysql_engine="InnoDB"
)


def _supports_alter_fk() -> bool:
    """SQLite cannot ALTER a constraint into an existing table.

    The dev stack runs on SQLite (see the rewrite hook in alembic/env.py) and
    does not enforce foreign keys by default anyway, so the columns are added
    without them there and MySQL — where the constraint does real work — gets
    the full definition. The ORM declares the relationship either way.
    """
    return op.get_bind().dialect.name != "sqlite"


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
    # --- content_sources: what a source is for, and how hard we may work it --
    with op.batch_alter_table("content_sources") as batch:
        batch.add_column(
            sa.Column(
                "beat",
                sa.String(length=20),
                nullable=False,
                server_default="GENERAL",
            )
        )
        batch.add_column(sa.Column("default_mandal_id", sa.BigInteger(), nullable=True))
        batch.add_column(
            sa.Column(
                "max_items_per_hour",
                sa.Integer(),
                nullable=False,
                server_default="8",
            )
        )
        batch.add_column(
            sa.Column(
                "allow_html_fallback",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )
        batch.add_column(
            sa.Column(
                "rewrite_enabled", sa.Boolean(), nullable=False, server_default="0"
            )
        )
        batch.add_column(
            sa.Column(
                "mandal_autotag", sa.Boolean(), nullable=False, server_default="1"
            )
        )
        if _supports_alter_fk():
            batch.create_foreign_key(
                "fk_content_sources_default_mandal_id",
                "mandals",
                ["default_mandal_id"],
                ["id"],
                ondelete="SET NULL",
            )
        batch.create_index(
            "ix_content_sources_beat_active", ["beat", "is_active"], unique=False
        )

    # --- ingested_items: where it happened, and how the rewrite went ---------
    with op.batch_alter_table("ingested_items") as batch:
        batch.add_column(sa.Column("matched_mandal_id", sa.BigInteger(), nullable=True))
        batch.add_column(
            sa.Column("matched_district_id", sa.BigInteger(), nullable=True)
        )
        batch.add_column(
            sa.Column(
                "mandal_match_method",
                sa.String(length=20),
                nullable=False,
                server_default="NONE",
            )
        )
        batch.add_column(
            sa.Column(
                "mandal_match_confidence",
                sa.Float(),
                nullable=False,
                server_default="0",
            )
        )
        batch.add_column(
            sa.Column(
                "requires_human", sa.Boolean(), nullable=False, server_default="0"
            )
        )
        batch.add_column(
            sa.Column(
                "rewrite_status",
                sa.String(length=16),
                nullable=False,
                server_default="NONE",
            )
        )
        if _supports_alter_fk():
            batch.create_foreign_key(
                "fk_ingested_items_matched_mandal_id",
                "mandals",
                ["matched_mandal_id"],
                ["id"],
                ondelete="SET NULL",
            )
            batch.create_foreign_key(
                "fk_ingested_items_matched_district_id",
                "districts",
                ["matched_district_id"],
                ["id"],
                ondelete="SET NULL",
            )
        batch.create_index(
            "ix_ingested_items_rewrite_fetched",
            ["rewrite_status", "fetched_at"],
            unique=False,
        )

    # --- ingested_rewrites ---------------------------------------------------
    op.create_table(
        "ingested_rewrites",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("title_te", sa.String(length=400), nullable=False),
        sa.Column("summary_te", sa.String(length=1000), nullable=True),
        sa.Column("body", sa.JSON(), nullable=True),
        sa.Column("body_plain", sa.Text(), nullable=True),
        sa.Column(
            "attribution_te", sa.String(length=400), nullable=False, server_default=""
        ),
        sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "engine", sa.String(length=60), nullable=False, server_default="heuristic"
        ),
        sa.Column("model", sa.String(length=80), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
        sa.Column("unverified", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column(
            "similarity_percent", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="READY"
        ),
        sa.Column("refusal_reason", sa.String(length=300), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["item_id"], ["ingested_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        **_T,
    )
    op.create_index(
        "ix_ingested_rewrites_item_created",
        "ingested_rewrites",
        ["item_id", "created_at"],
    )
    op.create_index(
        "ix_ingested_rewrites_status_created",
        "ingested_rewrites",
        ["status", "created_at"],
    )

    # --- mandal_aliases ------------------------------------------------------
    op.create_table(
        "mandal_aliases",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("mandal_id", sa.BigInteger(), nullable=False),
        sa.Column("alias", sa.String(length=120), nullable=False),
        sa.Column("lang", sa.String(length=10), nullable=False, server_default="te"),
        *_timestamps(),
        sa.ForeignKeyConstraint(["mandal_id"], ["mandals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mandal_id", "alias", name="uq_mandal_aliases_mandal_alias"),
        **_T,
    )
    op.create_index("ix_mandal_aliases_alias", "mandal_aliases", ["alias"])

    # --- job_postings --------------------------------------------------------
    op.create_table(
        "job_postings",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("article_id", sa.BigInteger(), nullable=False),
        sa.Column("department", sa.String(length=250), nullable=True),
        sa.Column("department_te", sa.String(length=250), nullable=True),
        sa.Column("posts_total", sa.Integer(), nullable=True),
        sa.Column("qualification_te", sa.Text(), nullable=True),
        sa.Column("pay_scale", sa.String(length=200), nullable=True),
        sa.Column("age_limit", sa.String(length=200), nullable=True),
        sa.Column("fee", sa.String(length=200), nullable=True),
        sa.Column("apply_url", sa.String(length=900), nullable=True),
        sa.Column("notification_url", sa.String(length=900), nullable=True),
        sa.Column("starts_on", sa.Date(), nullable=True),
        sa.Column("last_date", sa.Date(), nullable=True),
        sa.Column("exam_date", sa.Date(), nullable=True),
        sa.Column("state", sa.String(length=10), nullable=False, server_default="BOTH"),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("verified_by", sa.BigInteger(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["verified_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("article_id", name="uq_job_postings_article_id"),
        **_T,
    )
    op.create_index(
        "ix_job_postings_state_last_date", "job_postings", ["state", "last_date"]
    )
    op.create_index("ix_job_postings_last_date", "job_postings", ["last_date"])


def downgrade() -> None:
    op.drop_index("ix_job_postings_last_date", table_name="job_postings")
    op.drop_index("ix_job_postings_state_last_date", table_name="job_postings")
    op.drop_table("job_postings")

    op.drop_index("ix_mandal_aliases_alias", table_name="mandal_aliases")
    op.drop_table("mandal_aliases")

    op.drop_index(
        "ix_ingested_rewrites_status_created", table_name="ingested_rewrites"
    )
    op.drop_index("ix_ingested_rewrites_item_created", table_name="ingested_rewrites")
    op.drop_table("ingested_rewrites")

    with op.batch_alter_table("ingested_items") as batch:
        batch.drop_index("ix_ingested_items_rewrite_fetched")
        if _supports_alter_fk():
            batch.drop_constraint(
                "fk_ingested_items_matched_district_id", type_="foreignkey"
            )
            batch.drop_constraint(
                "fk_ingested_items_matched_mandal_id", type_="foreignkey"
            )
        batch.drop_column("rewrite_status")
        batch.drop_column("requires_human")
        batch.drop_column("mandal_match_confidence")
        batch.drop_column("mandal_match_method")
        batch.drop_column("matched_district_id")
        batch.drop_column("matched_mandal_id")

    with op.batch_alter_table("content_sources") as batch:
        batch.drop_index("ix_content_sources_beat_active")
        if _supports_alter_fk():
            batch.drop_constraint(
                "fk_content_sources_default_mandal_id", type_="foreignkey"
            )
        batch.drop_column("mandal_autotag")
        batch.drop_column("rewrite_enabled")
        batch.drop_column("allow_html_fallback")
        batch.drop_column("max_items_per_hour")
        batch.drop_column("default_mandal_id")
        batch.drop_column("beat")
