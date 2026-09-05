"""Phase C (updated doc): engagement — event stream, reading sessions, likes,
bookmarks, comments, reports, follows, and article counters.

Revision ID: c9d41e8a2f55
Revises: b4e82f7c1d03
Create Date: 2026-09-04 11:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.types  # noqa: F401

revision: str = 'c9d41e8a2f55'
down_revision: Union[str, None] = 'b4e82f7c1d03'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE_KW = dict(
    mysql_charset='utf8mb4',
    mysql_collate='utf8mb4_unicode_ci',
    mysql_engine='InnoDB',
)


def upgrade() -> None:
    op.add_column('articles', sa.Column('like_count', sa.Integer(), server_default='0', nullable=False))
    op.add_column('articles', sa.Column('comment_count', sa.Integer(), server_default='0', nullable=False))
    op.add_column('articles', sa.Column('share_count', sa.Integer(), server_default='0', nullable=False))

    op.create_table(
        'article_events',
        sa.Column('article_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=True),
        sa.Column('anon_id', sa.String(length=64), nullable=True),
        sa.Column('event_type', sa.Enum('VIEW', 'READ', 'SCROLL', 'SHARE', 'LIKE', 'UNLIKE', 'BOOKMARK', 'UNBOOKMARK', 'NOT_INTERESTED', name='eventtype', native_enum=False, length=20), nullable=False),
        sa.Column('value', sa.Integer(), nullable=True),
        sa.Column('created_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_article_events_article_id_articles'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_article_events_user_id_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_article_events')),
        **_TABLE_KW,
    )
    op.create_index('ix_article_events_article_id_type_created_at', 'article_events', ['article_id', 'event_type', 'created_at'], unique=False)
    op.create_index('ix_article_events_user_id_created_at', 'article_events', ['user_id', 'created_at'], unique=False)
    op.create_index('ix_article_events_created_at', 'article_events', ['created_at'], unique=False)

    op.create_table(
        'reading_sessions',
        sa.Column('article_id', sa.BigInteger(), nullable=False),
        sa.Column('viewer_key', sa.String(length=80), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=True),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('seconds', sa.Integer(), nullable=False),
        sa.Column('max_scroll_pct', sa.Integer(), nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_reading_sessions_article_id_articles'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_reading_sessions_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_reading_sessions')),
        sa.UniqueConstraint('article_id', 'viewer_key', 'day', name='uq_reading_sessions_article_viewer_day'),
        **_TABLE_KW,
    )
    op.create_index('ix_reading_sessions_user_id_updated_at', 'reading_sessions', ['user_id', 'updated_at'], unique=False)

    op.create_table(
        'likes',
        sa.Column('article_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_likes_article_id_articles'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_likes_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('article_id', 'user_id', name=op.f('pk_likes')),
        **_TABLE_KW,
    )
    op.create_index('ix_likes_user_id_created_at', 'likes', ['user_id', 'created_at'], unique=False)

    op.create_table(
        'bookmarks',
        sa.Column('article_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_bookmarks_article_id_articles'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_bookmarks_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('article_id', 'user_id', name=op.f('pk_bookmarks')),
        **_TABLE_KW,
    )
    op.create_index('ix_bookmarks_user_id_created_at', 'bookmarks', ['user_id', 'created_at'], unique=False)

    op.create_table(
        'comments',
        sa.Column('article_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('parent_id', sa.BigInteger(), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('status', sa.Enum('VISIBLE', 'PENDING', 'HIDDEN', 'DELETED', name='commentstatus', native_enum=False, length=10), server_default='VISIBLE', nullable=False),
        sa.Column('moderated_by', sa.BigInteger(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_comments_article_id_articles'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_comments_user_id_users'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['parent_id'], ['comments.id'], name=op.f('fk_comments_parent_id_comments'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['moderated_by'], ['users.id'], name=op.f('fk_comments_moderated_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_comments')),
        **_TABLE_KW,
    )
    op.create_index('ix_comments_article_id_status_created_at', 'comments', ['article_id', 'status', 'created_at'], unique=False)
    op.create_index('ix_comments_user_id_created_at', 'comments', ['user_id', 'created_at'], unique=False)
    op.create_index('ix_comments_status_created_at', 'comments', ['status', 'created_at'], unique=False)

    op.create_table(
        'reports',
        sa.Column('target_type', sa.Enum('ARTICLE', 'COMMENT', name='reporttargettype', native_enum=False, length=10), nullable=False),
        sa.Column('target_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=True),
        sa.Column('reason', sa.String(length=30), nullable=False),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.Column('status', sa.Enum('OPEN', 'RESOLVED', 'DISMISSED', name='reportstatus', native_enum=False, length=10), server_default='OPEN', nullable=False),
        sa.Column('resolved_by', sa.BigInteger(), nullable=True),
        sa.Column('resolved_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('resolution_note', sa.String(length=500), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_reports_user_id_users'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['resolved_by'], ['users.id'], name=op.f('fk_reports_resolved_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_reports')),
        **_TABLE_KW,
    )
    op.create_index('ix_reports_status_created_at', 'reports', ['status', 'created_at'], unique=False)
    op.create_index('ix_reports_target', 'reports', ['target_type', 'target_id'], unique=False)

    op.create_table(
        'follows',
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('target_type', sa.Enum('CATEGORY', 'TAG', 'DISTRICT', 'MANDAL', 'AUTHOR', name='followtargettype', native_enum=False, length=10), nullable=False),
        sa.Column('target_id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_follows_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_follows')),
        sa.UniqueConstraint('user_id', 'target_type', 'target_id', name='uq_follows_user_target'),
        **_TABLE_KW,
    )
    op.create_index('ix_follows_target', 'follows', ['target_type', 'target_id'], unique=False)
    op.create_index('ix_follows_user_id', 'follows', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_follows_user_id', table_name='follows')
    op.drop_index('ix_follows_target', table_name='follows')
    op.drop_table('follows')
    op.drop_index('ix_reports_target', table_name='reports')
    op.drop_index('ix_reports_status_created_at', table_name='reports')
    op.drop_table('reports')
    op.drop_index('ix_comments_status_created_at', table_name='comments')
    op.drop_index('ix_comments_user_id_created_at', table_name='comments')
    op.drop_index('ix_comments_article_id_status_created_at', table_name='comments')
    op.drop_table('comments')
    op.drop_index('ix_bookmarks_user_id_created_at', table_name='bookmarks')
    op.drop_table('bookmarks')
    op.drop_index('ix_likes_user_id_created_at', table_name='likes')
    op.drop_table('likes')
    op.drop_index('ix_reading_sessions_user_id_updated_at', table_name='reading_sessions')
    op.drop_table('reading_sessions')
    op.drop_index('ix_article_events_created_at', table_name='article_events')
    op.drop_index('ix_article_events_user_id_created_at', table_name='article_events')
    op.drop_index('ix_article_events_article_id_type_created_at', table_name='article_events')
    op.drop_table('article_events')
    op.drop_column('articles', 'share_count')
    op.drop_column('articles', 'comment_count')
    op.drop_column('articles', 'like_count')
