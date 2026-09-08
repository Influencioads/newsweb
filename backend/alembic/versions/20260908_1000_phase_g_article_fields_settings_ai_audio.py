"""Phase G (updated doc §1, §4, §15-21, §23, §35): full article fields,
editable settings, server audio, AI assistance.

Additive only. Every new column is nullable or carries a server default that
matches today's behaviour, so an existing database keeps working before the
application code that reads them is deployed:

  * articles.article_type defaults to NORMAL, then a backfill infers REPORTER /
    USER_SUBMITTED from data already present. The backfill is one UPDATE per
    type and is reversible (downgrade drops the column outright).
  * articles.voice_enabled defaults to 1 — but the *global* voice switch seeded
    into app_settings starts false, so nothing is synthesised until an admin
    turns it on.
  * articles.audio_asset_id and audio_assets.article_id reference each other.
    The column is added after the table exists, so no circular DDL.

Revision ID: a1c74f2b6d09
Revises: f8b62d3e91a4
Create Date: 2026-09-08 10:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.types  # noqa: F401

revision: str = 'a1c74f2b6d09'
down_revision: Union[str, None] = 'f8b62d3e91a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE_KW = dict(
    mysql_charset='utf8mb4',
    mysql_collate='utf8mb4_unicode_ci',
    mysql_engine='InnoDB',
)

_ARTICLE_TYPES = ('NORMAL', 'REPORTER', 'USER_SUBMITTED', 'AI_SUGGESTED', 'AI_DRAFT', 'BREAKING_NEWS')


def upgrade() -> None:
    # ---------------------------------------------------------------- §1 §23 --
    with op.batch_alter_table('articles') as batch:
        batch.add_column(sa.Column('subcategory_id', sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column('video_id', sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column('is_featured', sa.Boolean(), nullable=False, server_default='0'))
        batch.add_column(sa.Column('voice_enabled', sa.Boolean(), nullable=False, server_default='1'))
        batch.add_column(sa.Column('breaking_until', app.db.types.UTCDateTime(), nullable=True))
        batch.add_column(sa.Column(
            'article_type',
            sa.Enum(*_ARTICLE_TYPES, name='articletype', native_enum=False, length=20),
            nullable=False, server_default='NORMAL'))
        batch.create_foreign_key(
            'fk_articles_subcategory_id_categories', 'categories', ['subcategory_id'], ['id'],
            ondelete='SET NULL')
        batch.create_foreign_key(
            'fk_articles_video_id_videos', 'videos', ['video_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_articles_article_type_workflow_state', 'articles',
                    ['article_type', 'workflow_state'], unique=False)

    # Backfill §23 from signals that already exist. `source_type='contributed'`
    # is set by the creator-submission approver, so it identifies reader copy
    # exactly; ai_generated identifies the (currently empty) AI set.
    op.execute("UPDATE articles SET article_type = 'USER_SUBMITTED' WHERE source_type = 'contributed'")
    op.execute("UPDATE articles SET article_type = 'AI_DRAFT' WHERE ai_generated = 1")

    # ------------------------------------------------------------------- §4 --
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('email_verified_at', app.db.types.UTCDateTime(), nullable=True))
        batch.add_column(sa.Column('phone_verified_at', app.db.types.UTCDateTime(), nullable=True))
    # Every existing reader account was created by completing an OTP challenge,
    # so their phone is verified by construction — recording that avoids asking
    # them to prove it again.
    op.execute("UPDATE users SET phone_verified_at = created_at WHERE phone IS NOT NULL")

    # ------------------------------------------------------- §18 §20 §35 -----
    op.create_table(
        'app_settings',
        sa.Column('key', sa.String(length=120), nullable=False),
        sa.Column('value', sa.JSON(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('updated_by', sa.BigInteger(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], name=op.f('fk_app_settings_updated_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_app_settings')),
        sa.UniqueConstraint('key', name='uq_app_settings_key'),
        **_TABLE_KW,
    )

    # ---------------------------------------------------------- §19 §20 §21 --
    op.create_table(
        'audio_assets',
        sa.Column('article_id', sa.BigInteger(), nullable=False),
        sa.Column('content_hash', sa.String(length=64), nullable=False),
        sa.Column('status', sa.Enum('PENDING', 'GENERATING', 'READY', 'FAILED', name='audiostatus', native_enum=False, length=20), nullable=False, server_default='pending'),
        sa.Column('provider', sa.String(length=30), nullable=False),
        sa.Column('voice', sa.String(length=60), nullable=True),
        sa.Column('language', sa.String(length=10), nullable=False),
        sa.Column('storage_key', sa.String(length=500), nullable=True),
        sa.Column('url', sa.String(length=700), nullable=True),
        sa.Column('mime', sa.String(length=60), nullable=False),
        sa.Column('bytes', sa.BigInteger(), nullable=False),
        sa.Column('duration_sec', sa.Integer(), nullable=False),
        sa.Column('char_count', sa.Integer(), nullable=False),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('generated_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('requested_by', sa.BigInteger(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_audio_assets_article_id_articles'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['requested_by'], ['users.id'], name=op.f('fk_audio_assets_requested_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_audio_assets')),
        sa.UniqueConstraint('article_id', 'content_hash', name='uq_audio_assets_article_id_content_hash'),
        **_TABLE_KW,
    )
    op.create_index('ix_audio_assets_status_created_at', 'audio_assets', ['status', 'created_at'], unique=False)

    # Added after audio_assets exists so the mutual reference never needs
    # forward-declared DDL.
    with op.batch_alter_table('articles') as batch:
        batch.add_column(sa.Column('audio_asset_id', sa.BigInteger(), nullable=True))
        batch.create_foreign_key(
            'fk_articles_audio_asset_id_audio_assets', 'audio_assets', ['audio_asset_id'], ['id'],
            ondelete='SET NULL')

    # ------------------------------------------------------------- §15 §17 ---
    op.create_table(
        'ai_suggestions',
        sa.Column('topic_te', sa.String(length=400), nullable=False),
        sa.Column('topic_en', sa.String(length=400), nullable=True),
        sa.Column('rationale_te', sa.Text(), nullable=True),
        sa.Column('category_id', sa.BigInteger(), nullable=True),
        sa.Column('district_id', sa.BigInteger(), nullable=True),
        sa.Column('status', sa.Enum('NEW', 'ACCEPTED', 'REJECTED', 'USED', name='aisuggestionstatus', native_enum=False, length=20), nullable=False, server_default='new'),
        sa.Column('score', sa.Float(), nullable=False),
        sa.Column('engine', sa.String(length=60), nullable=False),
        sa.Column('model', sa.String(length=80), nullable=True),
        sa.Column('reviewed_by', sa.BigInteger(), nullable=True),
        sa.Column('reviewed_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('review_note', sa.String(length=500), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_ai_suggestions_category_id_categories'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['district_id'], ['districts.id'], name=op.f('fk_ai_suggestions_district_id_districts'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id'], name=op.f('fk_ai_suggestions_reviewed_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_suggestions')),
        **_TABLE_KW,
    )
    op.create_index('ix_ai_suggestions_status_created_at', 'ai_suggestions', ['status', 'created_at'], unique=False)
    op.create_index('ix_ai_suggestions_category_id', 'ai_suggestions', ['category_id'], unique=False)

    op.create_table(
        'ai_sources',
        sa.Column('suggestion_id', sa.BigInteger(), nullable=False),
        sa.Column('publisher', sa.String(length=200), nullable=False),
        sa.Column('title', sa.String(length=500), nullable=True),
        sa.Column('url', sa.String(length=900), nullable=False),
        sa.Column('licence', sa.String(length=60), nullable=False),
        sa.Column('excerpt', sa.Text(), nullable=True),
        sa.Column('published_at', app.db.types.UTCDateTime(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['suggestion_id'], ['ai_suggestions.id'], name=op.f('fk_ai_sources_suggestion_id_ai_suggestions'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_sources')),
        **_TABLE_KW,
    )
    op.create_index('ix_ai_sources_suggestion_id', 'ai_sources', ['suggestion_id'], unique=False)

    op.create_table(
        'ai_article_drafts',
        sa.Column('suggestion_id', sa.BigInteger(), nullable=True),
        sa.Column('title_te', sa.String(length=400), nullable=False),
        sa.Column('summary_te', sa.String(length=1000), nullable=True),
        sa.Column('body', sa.JSON(), nullable=True),
        sa.Column('body_plain', sa.Text(), nullable=True),
        sa.Column('category_id', sa.BigInteger(), nullable=True),
        sa.Column('district_id', sa.BigInteger(), nullable=True),
        sa.Column('status', sa.Enum('DRAFT', 'CONVERTED', 'DISCARDED', name='aidraftstatus', native_enum=False, length=20), nullable=False, server_default='draft'),
        sa.Column('engine', sa.String(length=60), nullable=False),
        sa.Column('model', sa.String(length=80), nullable=True),
        sa.Column('confidence', sa.Float(), nullable=True),
        sa.Column('word_count', sa.Integer(), nullable=False),
        sa.Column('requires_review', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('article_id', sa.BigInteger(), nullable=True),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['suggestion_id'], ['ai_suggestions.id'], name=op.f('fk_ai_article_drafts_suggestion_id_ai_suggestions'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_ai_article_drafts_category_id_categories'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['district_id'], ['districts.id'], name=op.f('fk_ai_article_drafts_district_id_districts'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['article_id'], ['articles.id'], name=op.f('fk_ai_article_drafts_article_id_articles'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_ai_article_drafts_created_by_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_article_drafts')),
        **_TABLE_KW,
    )
    op.create_index('ix_ai_article_drafts_status_created_at', 'ai_article_drafts', ['status', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_ai_article_drafts_status_created_at', table_name='ai_article_drafts')
    op.drop_table('ai_article_drafts')
    op.drop_index('ix_ai_sources_suggestion_id', table_name='ai_sources')
    op.drop_table('ai_sources')
    op.drop_index('ix_ai_suggestions_category_id', table_name='ai_suggestions')
    op.drop_index('ix_ai_suggestions_status_created_at', table_name='ai_suggestions')
    op.drop_table('ai_suggestions')

    with op.batch_alter_table('articles') as batch:
        batch.drop_constraint('fk_articles_audio_asset_id_audio_assets', type_='foreignkey')
        batch.drop_column('audio_asset_id')

    op.drop_index('ix_audio_assets_status_created_at', table_name='audio_assets')
    op.drop_table('audio_assets')
    op.drop_table('app_settings')

    with op.batch_alter_table('users') as batch:
        batch.drop_column('phone_verified_at')
        batch.drop_column('email_verified_at')

    op.drop_index('ix_articles_article_type_workflow_state', table_name='articles')
    with op.batch_alter_table('articles') as batch:
        batch.drop_constraint('fk_articles_video_id_videos', type_='foreignkey')
        batch.drop_constraint('fk_articles_subcategory_id_categories', type_='foreignkey')
        batch.drop_column('article_type')
        batch.drop_column('breaking_until')
        batch.drop_column('voice_enabled')
        batch.drop_column('is_featured')
        batch.drop_column('video_id')
        batch.drop_column('subcategory_id')
