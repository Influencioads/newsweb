"""Phase E (updated doc §15, product decision: YouTube links only): videos.

Revision ID: e5a917cd42b8
Revises: d2f83a51c977
Create Date: 2026-09-04 13:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.types  # noqa: F401

revision: str = 'e5a917cd42b8'
down_revision: Union[str, None] = 'd2f83a51c977'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'videos',
        sa.Column('youtube_id', sa.String(length=11), nullable=False),
        sa.Column('title_te', sa.String(length=400), nullable=False),
        sa.Column('title_en', sa.String(length=400), nullable=True),
        sa.Column('description_te', sa.Text(), nullable=True),
        sa.Column('category_id', sa.BigInteger(), nullable=True),
        sa.Column('district_id', sa.BigInteger(), nullable=True),
        sa.Column('duration_sec', sa.Integer(), nullable=True),
        sa.Column('is_published', sa.Boolean(), nullable=False),
        sa.Column('published_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('view_count', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('deleted_at', app.db.types.UTCDateTime(), nullable=True),
        sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_videos_category_id_categories'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['district_id'], ['districts.id'], name=op.f('fk_videos_district_id_districts'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_videos_created_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_videos')),
        sa.UniqueConstraint('youtube_id', name='uq_videos_youtube_id'),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci',
        mysql_engine='InnoDB',
    )
    op.create_index(op.f('ix_videos_deleted_at'), 'videos', ['deleted_at'], unique=False)
    op.create_index('ix_videos_published', 'videos', ['is_published', 'published_at'], unique=False)
    op.create_index('ix_videos_category_id_published_at', 'videos', ['category_id', 'published_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_videos_category_id_published_at', table_name='videos')
    op.drop_index('ix_videos_published', table_name='videos')
    op.drop_index(op.f('ix_videos_deleted_at'), table_name='videos')
    op.drop_table('videos')
