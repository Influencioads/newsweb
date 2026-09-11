"""Daily/personal E-Paper, polls, trending topics, article accountability.

Revision ID: f7a91d2c4e60
Revises: e58c1a903d64
Create Date: 2026-09-10 12:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

import app.db.types

revision: str = "f7a91d2c4e60"
down_revision: Union[str, None] = "e58c1a903d64"
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
    op.add_column("articles", sa.Column("reviewed_by", sa.BigInteger(), nullable=True))
    op.add_column(
        "articles",
        sa.Column(
            "article_source_type", sa.String(20), server_default="ADMIN", nullable=False
        ),
    )
    op.create_foreign_key(
        "fk_articles_reviewed_by_users",
        "articles",
        "users",
        ["reviewed_by"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "epaper_page_templates",
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("title_te", sa.String(180), nullable=False),
        sa.Column("title_en", sa.String(180), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("category_ids", mysql.JSON(), nullable=False),
        sa.Column("story_count", sa.Integer(), nullable=False, server_default="6"),
        sa.Column(
            "layout_type", sa.String(30), nullable=False, server_default="lead_grid"
        ),
        sa.Column("is_visible", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("slug", name="uq_epaper_page_templates_slug"),
        **_T,
    )
    op.create_index(
        "ix_epaper_page_templates_visible_sort",
        "epaper_page_templates",
        ["is_visible", "sort"],
    )

    op.create_table(
        "polls",
        sa.Column("question_te", sa.String(500), nullable=False),
        sa.Column("question_en", sa.String(500), nullable=True),
        sa.Column("category_id", sa.BigInteger(), nullable=True),
        sa.Column("district_id", sa.BigInteger(), nullable=True),
        sa.Column("article_id", sa.BigInteger(), nullable=True),
        sa.Column("start_time", app.db.types.UTCDateTime(), nullable=False),
        sa.Column("end_time", app.db.types.UTCDateTime(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="DRAFT"),
        sa.Column("is_big_question", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["district_id"], ["districts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        **_T,
    )
    op.create_index(
        "ix_polls_status_dates", "polls", ["status", "start_time", "end_time"]
    )
    op.create_table(
        "poll_options",
        sa.Column("poll_id", sa.BigInteger(), nullable=False),
        sa.Column("option_text_te", sa.String(300), nullable=False),
        sa.Column("option_text_en", sa.String(300), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("vote_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.ForeignKeyConstraint(["poll_id"], ["polls.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("poll_id", "display_order", name="uq_poll_option_order"),
        **_T,
    )
    op.create_table(
        "poll_votes",
        sa.Column("poll_id", sa.BigInteger(), nullable=False),
        sa.Column("option_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("voter_key", sa.String(80), nullable=False),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["poll_id"], ["polls.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["option_id"], ["poll_options.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("poll_id", "voter_key", name="uq_poll_vote_voter"),
        **_T,
    )
    op.create_index("ix_poll_votes_poll_option", "poll_votes", ["poll_id", "option_id"])

    op.create_table(
        "epaper_editions",
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("edition_date", sa.Date(), nullable=False),
        sa.Column(
            "edition_type", sa.String(20), nullable=False, server_default="DAILY"
        ),
        sa.Column("language", sa.String(10), nullable=False, server_default="te"),
        sa.Column("status", sa.String(20), nullable=False, server_default="DRAFT"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("owner_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("approved_by", sa.BigInteger(), nullable=True),
        sa.Column("approved_at", app.db.types.UTCDateTime(), nullable=True),
        sa.Column("published_at", app.db.types.UTCDateTime(), nullable=True),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "edition_date",
            "edition_type",
            "owner_user_id",
            name="uq_epaper_edition_day_type_owner",
        ),
        **_T,
    )
    op.create_index(
        "ix_epaper_editions_status_date", "epaper_editions", ["status", "edition_date"]
    )
    op.create_table(
        "epaper_pages",
        sa.Column("edition_id", sa.BigInteger(), nullable=False),
        sa.Column("template_id", sa.BigInteger(), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column(
            "layout_type", sa.String(30), nullable=False, server_default="lead_grid"
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="DRAFT"),
        sa.Column("poll_id", sa.BigInteger(), nullable=True),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["edition_id"], ["epaper_editions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["template_id"], ["epaper_page_templates.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["poll_id"], ["polls.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "edition_id", "page_number", name="uq_epaper_pages_edition_number"
        ),
        **_T,
    )
    op.create_index(
        "ix_epaper_pages_edition_status", "epaper_pages", ["edition_id", "status"]
    )
    op.create_table(
        "epaper_page_articles",
        sa.Column("page_id", sa.BigInteger(), nullable=False),
        sa.Column("article_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "display_type", sa.String(30), nullable=False, server_default="standard"
        ),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.ForeignKeyConstraint(["page_id"], ["epaper_pages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("page_id", "article_id", name="uq_epaper_page_article"),
        sa.UniqueConstraint("page_id", "position", name="uq_epaper_page_position"),
        **_T,
    )
    op.create_table(
        "epaper_assets",
        sa.Column("edition_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("storage_key", sa.String(500), nullable=True),
        sa.Column("public_url", sa.String(700), nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["edition_id"], ["epaper_editions.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint(
            "edition_id", "kind", "revision", name="uq_epaper_asset_revision"
        ),
        **_T,
    )
    op.create_index(
        "ix_epaper_assets_edition_kind_status",
        "epaper_assets",
        ["edition_id", "kind", "status"],
    )
    op.create_table(
        "epaper_page_shares",
        sa.Column("page_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("channel", sa.String(30), nullable=False, server_default="native"),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["page_id"], ["epaper_pages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        **_T,
    )
    op.create_index(
        "ix_epaper_page_shares_page_created",
        "epaper_page_shares",
        ["page_id", "created_at"],
    )
    op.create_table(
        "epaper_user_editions",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("auto_generate", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column(
            "generation_time", sa.Time(), nullable=False, server_default="06:00:00"
        ),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "name", name="uq_epaper_user_edition_name"),
        **_T,
    )
    op.create_table(
        "epaper_user_edition_preferences",
        sa.Column("user_edition_id", sa.BigInteger(), nullable=False),
        sa.Column("preference_type", sa.String(20), nullable=False),
        sa.Column("target_id", sa.BigInteger(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.ForeignKeyConstraint(
            ["user_edition_id"], ["epaper_user_editions.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint(
            "user_edition_id",
            "preference_type",
            "target_id",
            name="uq_epaper_user_preference",
        ),
        **_T,
    )
    op.create_table(
        "trending_topics",
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("title_te", sa.String(180), nullable=False),
        sa.Column("title_en", sa.String(180), nullable=True),
        sa.Column("category_id", sa.BigInteger(), nullable=True),
        sa.Column("tag_id", sa.BigInteger(), nullable=True),
        sa.Column("override_rank", sa.Integer(), nullable=True),
        sa.Column("score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("expires_at", app.db.types.UTCDateTime(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("slug"),
        **_T,
    )
    op.create_index(
        "ix_trending_topics_active_rank",
        "trending_topics",
        ["is_active", "override_rank"],
    )


def downgrade() -> None:
    for table in (
        "trending_topics",
        "epaper_user_edition_preferences",
        "epaper_user_editions",
        "epaper_page_shares",
        "epaper_assets",
        "epaper_page_articles",
        "epaper_pages",
        "epaper_editions",
        "poll_votes",
        "poll_options",
        "polls",
        "epaper_page_templates",
    ):
        op.drop_table(table)
    op.drop_constraint("fk_articles_reviewed_by_users", "articles", type_="foreignkey")
    op.drop_column("articles", "article_source_type")
    op.drop_column("articles", "reviewed_by")
