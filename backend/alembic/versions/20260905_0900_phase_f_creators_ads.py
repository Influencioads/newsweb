"""Phase F (updated doc §17, §26): creator submissions and ad campaigns.

Revision ID: f8b62d3e91a4
Revises: e5a917cd42b8
Create Date: 2026-09-05 09:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.types  # noqa: F401

revision: str = 'f8b62d3e91a4'
down_revision: Union[str, None] = 'e5a917cd42b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE_KW = dict(
    mysql_charset='utf8mb4',
    mysql_collate='utf8mb4_unicode_ci',
    mysql_engine='InnoDB',
)


def upgrade() -> None:
    op.create_table(
        'creator_submissions',
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('title_te', sa.String(length=400), nullable=False),
        sa.Column('body_te', sa.Text(), nullable=False),
        sa.Column('category_id', sa.BigInteger(), nullable=True),
        sa.Column('district_id', sa.BigInteger(), nullable=True),
        sa.Column('status', sa.Enum('PENDING', 'APPROVED', 'REJECTED', name='submissionstatus', native_enum=False, length=10), nullable=False, server_default='PENDING'),
        sa.Column('review_note', sa.String(length=500), nullable=True),
        sa.Column('reviewed_by', sa.BigInteger(), nullable=True),
        sa.Column('reviewed_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('article_id', sa.BigInteger(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_creator_submissions_user_id_users'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_creator_submissions_category_id_categories'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['district_id'], ['districts.id'], name=op.f('fk_creator_submissions_district_id_districts'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id'], name=op.f('fk_creator_submissions_reviewed_by_users'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_creator_submissions_article_id_articles'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_creator_submissions')),
        **_TABLE_KW,
    )
    op.create_index('ix_creator_submissions_status_created_at', 'creator_submissions', ['status', 'created_at'], unique=False)
    op.create_index('ix_creator_submissions_user_id_created_at', 'creator_submissions', ['user_id', 'created_at'], unique=False)

    op.create_table(
        'ad_campaigns',
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('image_url', sa.String(length=600), nullable=False),
        sa.Column('target_url', sa.String(length=600), nullable=False),
        sa.Column('placement', sa.Enum('TOP_BANNER', 'IN_FEED', 'ARTICLE', 'CATEGORY', name='adplacement', native_enum=False, length=15), nullable=False),
        sa.Column('category_id', sa.BigInteger(), nullable=True),
        sa.Column('district_id', sa.BigInteger(), nullable=True),
        sa.Column('starts_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('ends_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('weight', sa.Integer(), nullable=False),
        sa.Column('impressions', sa.BigInteger(), nullable=False),
        sa.Column('clicks', sa.BigInteger(), nullable=False),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_ad_campaigns_category_id_categories'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['district_id'], ['districts.id'], name=op.f('fk_ad_campaigns_district_id_districts'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_ad_campaigns_created_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_ad_campaigns')),
        **_TABLE_KW,
    )
    op.create_index('ix_ad_campaigns_placement_active', 'ad_campaigns', ['placement', 'is_active', 'ends_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_ad_campaigns_placement_active', table_name='ad_campaigns')
    op.drop_table('ad_campaigns')
    op.drop_index('ix_creator_submissions_user_id_created_at', table_name='creator_submissions')
    op.drop_index('ix_creator_submissions_status_created_at', table_name='creator_submissions')
    op.drop_table('creator_submissions')
