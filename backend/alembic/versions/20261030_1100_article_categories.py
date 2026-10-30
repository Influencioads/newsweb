"""A story can be listed in up to three more sections besides its main one.

New table `article_categories` (article_id, category_id, sort). The main
section stays on `articles.category_id`; these rows only add the story to more
section pages. Nothing existing changes.

Revision ID: c2e5a9d3f7b1
Revises: a4c8e2f6b9d1
Create Date: 2026-10-30 11:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types  # noqa: F401 — registers the BigInteger compile hook

revision: str = "c2e5a9d3f7b1"
down_revision: Union[str, None] = "a4c8e2f6b9d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "article_categories",
        sa.Column("article_id", sa.BigInteger(), nullable=False),
        sa.Column("category_id", sa.BigInteger(), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["article_id"], ["articles.id"],
            name=op.f("fk_article_categories_article_id_articles"), ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"],
            name=op.f("fk_article_categories_category_id_categories"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("article_id", "category_id", name=op.f("pk_article_categories")),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
        mysql_engine="InnoDB",
    )
    op.create_index(
        op.f("ix_article_categories_category_id"), "article_categories", ["category_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_article_categories_category_id"), table_name="article_categories")
    op.drop_table("article_categories")
