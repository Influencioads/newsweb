"""Phase A (updated doc): states/localities, article locality, configurable
homepage sections, search log, and the MySQL FULLTEXT search index.

Revision ID: a7c31d905b12
Revises: 1f20bffe3e95
Create Date: 2026-09-04 10:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# Custom column types referenced by migrations (app.db.types.UTCDateTime).
import app.db.types  # noqa: F401

revision: str = 'a7c31d905b12'
down_revision: Union[str, None] = '1f20bffe3e95'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE_KW = dict(
    mysql_charset='utf8mb4',
    mysql_collate='utf8mb4_unicode_ci',
    mysql_engine='InnoDB',
)


def upgrade() -> None:
    op.create_table(
        'states',
        sa.Column('code', sa.String(length=2), nullable=False),
        sa.Column('slug', sa.String(length=80), nullable=False),
        sa.Column('name_te', sa.String(length=120), nullable=False),
        sa.Column('name_en', sa.String(length=120), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('sort', sa.Integer(), nullable=False),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_states')),
        sa.UniqueConstraint('code', name='uq_states_code'),
        sa.UniqueConstraint('slug', name='uq_states_slug'),
        **_TABLE_KW,
    )

    op.create_table(
        'localities',
        sa.Column('mandal_id', sa.BigInteger(), nullable=False),
        sa.Column('slug', sa.String(length=80), nullable=False),
        sa.Column('name_te', sa.String(length=120), nullable=False),
        sa.Column('name_en', sa.String(length=120), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['mandal_id'], ['mandals.id'], name=op.f('fk_localities_mandal_id_mandals'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_localities')),
        sa.UniqueConstraint('mandal_id', 'slug', name='uq_localities_mandal_id_slug'),
        **_TABLE_KW,
    )
    op.create_index(op.f('ix_localities_mandal_id'), 'localities', ['mandal_id'], unique=False)

    op.create_table(
        'homepage_sections',
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('kind', sa.Enum('CATEGORY', 'TRENDING', 'LATEST', 'SHORT_NEWS', 'VIDEOS', name='homesectionkind', native_enum=False, length=20), nullable=False),
        sa.Column('category_id', sa.BigInteger(), nullable=True),
        sa.Column('title_te', sa.String(length=120), nullable=True),
        sa.Column('title_en', sa.String(length=120), nullable=True),
        sa.Column('sort', sa.Integer(), nullable=False),
        sa.Column('is_enabled', sa.Boolean(), nullable=False),
        sa.Column('item_count', sa.Integer(), nullable=False),
        sa.Column('min_items', sa.Integer(), nullable=False),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['category_id'], ['categories.id'], name=op.f('fk_homepage_sections_category_id_categories'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_homepage_sections')),
        sa.UniqueConstraint('key', name='uq_homepage_sections_key'),
        **_TABLE_KW,
    )
    op.create_index('ix_homepage_sections_sort', 'homepage_sections', ['sort'], unique=False)

    op.create_table(
        'search_queries',
        sa.Column('query', sa.String(length=200), nullable=False),
        sa.Column('normalized', sa.String(length=200), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=True),
        sa.Column('results_count', sa.Integer(), nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), nullable=False),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_search_queries_user_id_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_search_queries')),
        **_TABLE_KW,
    )
    op.create_index('ix_search_queries_normalized_created_at', 'search_queries', ['normalized', 'created_at'], unique=False)
    op.create_index('ix_search_queries_user_id_created_at', 'search_queries', ['user_id', 'created_at'], unique=False)

    op.add_column('articles', sa.Column('locality_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        op.f('fk_articles_locality_id_localities'), 'articles', 'localities',
        ['locality_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_articles_mandal_id_published_at', 'articles', ['mandal_id', 'published_at'], unique=False)
    op.create_index('ix_articles_locality_id_published_at', 'articles', ['locality_id', 'published_at'], unique=False)

    # Reader search (§10). InnoDB FULLTEXT; the default parser tokenises on
    # whitespace, which suits Telugu. Other dialects (SQLite dev) use the LIKE
    # fallback in article_repo.search and need no index here.
    if op.get_bind().dialect.name == 'mysql':
        op.execute(
            'ALTER TABLE articles ADD FULLTEXT INDEX ft_articles_search '
            '(title_te, title_en, body_plain)'
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == 'mysql':
        op.execute('ALTER TABLE articles DROP INDEX ft_articles_search')
    op.drop_index('ix_articles_locality_id_published_at', table_name='articles')
    op.drop_index('ix_articles_mandal_id_published_at', table_name='articles')
    op.drop_constraint(op.f('fk_articles_locality_id_localities'), 'articles', type_='foreignkey')
    op.drop_column('articles', 'locality_id')
    op.drop_index('ix_search_queries_user_id_created_at', table_name='search_queries')
    op.drop_index('ix_search_queries_normalized_created_at', table_name='search_queries')
    op.drop_table('search_queries')
    op.drop_index('ix_homepage_sections_sort', table_name='homepage_sections')
    op.drop_table('homepage_sections')
    op.drop_index(op.f('ix_localities_mandal_id'), table_name='localities')
    op.drop_table('localities')
    op.drop_table('states')
