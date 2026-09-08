"""Phase J (updated doc §17): content ingestion from licensed feeds.

Two new tables and one enum value. Nothing existing changes shape, so this is a
zero-downtime deploy: `articles.article_type` already stores VARCHAR behind a
CHECK constraint precisely so adding SYNDICATED costs one statement rather than
a locking ALTER on a large table.

Note the column defaults, which are the §17 policy expressed as DDL rather than
as a comment: a source arrives as RSS_PUBLIC / EXCERPT_ONLY / auto_publish=0.
Getting full-text republication requires three deliberate edits, and the API
refuses two of them without a recorded agreement.

Revision ID: e58c1a903d64
Revises: d47b0c8e2a15
Create Date: 2026-09-08 20:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.types  # noqa: F401

revision: str = 'e58c1a903d64'
down_revision: Union[str, None] = 'd47b0c8e2a15'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE_KW = dict(
    mysql_charset='utf8mb4',
    mysql_collate='utf8mb4_unicode_ci',
    mysql_engine='InnoDB',
)

_LICENCES = ('AGENCY_CONTRACT', 'PUBLISHER_PARTNER', 'PRESS_RELEASE', 'GOVERNMENT',
             'CREATIVE_COMMONS', 'OWN_NETWORK', 'RSS_PUBLIC')
_POLICIES = ('LINK_ONLY', 'EXCERPT_ONLY', 'FULL_TEXT')
_STATUSES = ('NEW', 'IMPORTED', 'REJECTED', 'DUPLICATE')


def upgrade() -> None:
    op.create_table(
        'content_sources',
        sa.Column('slug', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('name_te', sa.String(length=200), nullable=True),
        sa.Column('homepage_url', sa.String(length=500), nullable=True),
        sa.Column('logo_url', sa.String(length=700), nullable=True),
        sa.Column('feed_url', sa.String(length=900), nullable=False),
        sa.Column('feed_kind', sa.String(length=20), nullable=False, server_default='rss'),
        sa.Column('licence', sa.Enum(*_LICENCES, name='sourcelicence', native_enum=False, length=24), nullable=False, server_default='RSS_PUBLIC'),
        sa.Column('content_policy', sa.Enum(*_POLICIES, name='contentpolicy', native_enum=False, length=16), nullable=False, server_default='EXCERPT_ONLY'),
        sa.Column('licence_note', sa.Text(), nullable=True),
        sa.Column('attribution_required', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('auto_publish', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('default_category_id', sa.BigInteger(), nullable=True),
        sa.Column('default_district_id', sa.BigInteger(), nullable=True),
        sa.Column('language', sa.String(length=10), nullable=False, server_default='te'),
        sa.Column('fetch_interval_minutes', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('etag', sa.String(length=300), nullable=True),
        sa.Column('last_modified', sa.String(length=120), nullable=True),
        sa.Column('last_fetched_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('last_status', sa.String(length=200), nullable=True),
        sa.Column('last_error_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('consecutive_failures', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('items_ingested', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['default_category_id'], ['categories.id'], name=op.f('fk_content_sources_default_category_id_categories'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['default_district_id'], ['districts.id'], name=op.f('fk_content_sources_default_district_id_districts'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_content_sources_created_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_content_sources')),
        sa.UniqueConstraint('slug', name='uq_content_sources_slug'),
        **_TABLE_KW,
    )
    op.create_index('ix_content_sources_active_next', 'content_sources',
                    ['is_active', 'last_fetched_at'], unique=False)

    op.create_table(
        'ingested_items',
        sa.Column('source_id', sa.BigInteger(), nullable=False),
        sa.Column('guid', sa.String(length=500), nullable=False),
        sa.Column('url', sa.String(length=900), nullable=True),
        sa.Column('canonical_url', sa.String(length=900), nullable=True),
        sa.Column('title', sa.String(length=500), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('content_html', sa.Text(), nullable=True),
        sa.Column('author', sa.String(length=200), nullable=True),
        sa.Column('image_url', sa.String(length=900), nullable=True),
        sa.Column('language', sa.String(length=10), nullable=True),
        sa.Column('word_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('published_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('fetched_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('content_hash', sa.String(length=64), nullable=False),
        sa.Column('status', sa.Enum(*_STATUSES, name='ingeststatus', native_enum=False, length=16), nullable=False, server_default='NEW'),
        sa.Column('review_note', sa.String(length=500), nullable=True),
        sa.Column('reviewed_by', sa.BigInteger(), nullable=True),
        sa.Column('reviewed_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('article_id', sa.BigInteger(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['source_id'], ['content_sources.id'], name=op.f('fk_ingested_items_source_id_content_sources'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id'], name=op.f('fk_ingested_items_reviewed_by_users'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_ingested_items_article_id_articles'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_ingested_items')),
        sa.UniqueConstraint('source_id', 'guid', name='uq_ingested_items_source_guid'),
        **_TABLE_KW,
    )
    op.create_index('ix_ingested_items_status_published', 'ingested_items',
                    ['status', 'published_at'], unique=False)
    op.create_index('ix_ingested_items_content_hash', 'ingested_items',
                    ['content_hash'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_ingested_items_content_hash', table_name='ingested_items')
    op.drop_index('ix_ingested_items_status_published', table_name='ingested_items')
    op.drop_table('ingested_items')
    op.drop_index('ix_content_sources_active_next', table_name='content_sources')
    op.drop_table('content_sources')
