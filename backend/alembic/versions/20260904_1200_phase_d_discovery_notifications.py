"""Phase D (updated doc): trending scores, pins, notifications, campaigns,
push devices.

Revision ID: d2f83a51c977
Revises: c9d41e8a2f55
Create Date: 2026-09-04 12:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.types  # noqa: F401

revision: str = 'd2f83a51c977'
down_revision: Union[str, None] = 'c9d41e8a2f55'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE_KW = dict(
    mysql_charset='utf8mb4',
    mysql_collate='utf8mb4_unicode_ci',
    mysql_engine='InnoDB',
)


def upgrade() -> None:
    op.create_table(
        'trending_scores',
        sa.Column('article_id', sa.BigInteger(), nullable=False),
        sa.Column('scope_type', sa.Enum('GLOBAL', 'CATEGORY', 'DISTRICT', name='trendingscope', native_enum=False, length=10), nullable=False),
        sa.Column('scope_id', sa.BigInteger(), nullable=True),
        sa.Column('score', sa.Float(), nullable=False),
        sa.Column('rank', sa.Integer(), nullable=False),
        sa.Column('computed_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_trending_scores_article_id_articles'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_trending_scores')),
        **_TABLE_KW,
    )
    op.create_index('ix_trending_scores_scope_score', 'trending_scores', ['scope_type', 'scope_id', 'score'], unique=False)
    op.create_index('ix_trending_scores_article_id', 'trending_scores', ['article_id'], unique=False)

    op.create_table(
        'pins',
        sa.Column('article_id', sa.BigInteger(), nullable=False),
        sa.Column('placement', sa.Enum('HOME', 'CATEGORY', 'LOCAL', name='pinplacement', native_enum=False, length=10), nullable=False),
        sa.Column('category_id', sa.BigInteger(), nullable=True),
        sa.Column('district_id', sa.BigInteger(), nullable=True),
        sa.Column('starts_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('ends_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('sort', sa.Integer(), nullable=False),
        sa.Column('note', sa.String(length=200), nullable=True),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_pins_article_id_articles'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_pins_category_id_categories'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['district_id'], ['districts.id'], name=op.f('fk_pins_district_id_districts'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_pins_created_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_pins')),
        **_TABLE_KW,
    )
    op.create_index('ix_pins_placement_ends_at', 'pins', ['placement', 'ends_at'], unique=False)
    op.create_index('ix_pins_article_id', 'pins', ['article_id'], unique=False)

    op.create_table(
        'notification_campaigns',
        sa.Column('title_te', sa.String(length=400), nullable=False),
        sa.Column('body_te', sa.String(length=1000), nullable=True),
        sa.Column('article_id', sa.BigInteger(), nullable=True),
        sa.Column('audience', sa.String(length=120), nullable=False),
        sa.Column('sent_count', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_notification_campaigns_article_id_articles'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_notification_campaigns_created_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_notification_campaigns')),
        **_TABLE_KW,
    )

    op.create_table(
        'notifications',
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('kind', sa.Enum('BREAKING', 'LOCAL', 'TOPIC', 'SYSTEM', name='notificationkind', native_enum=False, length=10), nullable=False),
        sa.Column('title_te', sa.String(length=400), nullable=False),
        sa.Column('body_te', sa.String(length=1000), nullable=True),
        sa.Column('article_id', sa.BigInteger(), nullable=True),
        sa.Column('campaign_id', sa.BigInteger(), nullable=True),
        sa.Column('created_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('read_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_notifications_user_id_users'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_notifications_article_id_articles'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['campaign_id'], ['notification_campaigns.id'], name=op.f('fk_notifications_campaign_id_notification_campaigns'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_notifications')),
        **_TABLE_KW,
    )
    op.create_index('ix_notifications_user_id_created_at', 'notifications', ['user_id', 'created_at'], unique=False)
    op.create_index('ix_notifications_user_id_read_at', 'notifications', ['user_id', 'read_at'], unique=False)

    op.create_table(
        'push_devices',
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('token', sa.String(length=400), nullable=False),
        sa.Column('platform', sa.Enum('WEB', 'ANDROID', 'IOS', 'CMS', 'UNKNOWN', name='sessionplatform', native_enum=False, length=20), nullable=False),
        sa.Column('last_seen_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_push_devices_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_push_devices')),
        sa.UniqueConstraint('token', name='uq_push_devices_token'),
        **_TABLE_KW,
    )
    op.create_index('ix_push_devices_user_id', 'push_devices', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_push_devices_user_id', table_name='push_devices')
    op.drop_table('push_devices')
    op.drop_index('ix_notifications_user_id_read_at', table_name='notifications')
    op.drop_index('ix_notifications_user_id_created_at', table_name='notifications')
    op.drop_table('notifications')
    op.drop_table('notification_campaigns')
    op.drop_index('ix_pins_article_id', table_name='pins')
    op.drop_index('ix_pins_placement_ends_at', table_name='pins')
    op.drop_table('pins')
    op.drop_index('ix_trending_scores_article_id', table_name='trending_scores')
    op.drop_index('ix_trending_scores_scope_score', table_name='trending_scores')
    op.drop_table('trending_scores')
