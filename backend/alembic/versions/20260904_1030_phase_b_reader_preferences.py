"""Phase B (updated doc §11): reader preferences.

Revision ID: b4e82f7c1d03
Revises: a7c31d905b12
Create Date: 2026-09-04 10:30:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

import app.db.types  # noqa: F401

revision: str = 'b4e82f7c1d03'
down_revision: Union[str, None] = 'a7c31d905b12'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_preferences',
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('language', sa.String(length=5), nullable=False),
        sa.Column('state_code', sa.String(length=2), nullable=True),
        sa.Column('district_id', sa.BigInteger(), nullable=True),
        sa.Column('mandal_id', sa.BigInteger(), nullable=True),
        sa.Column('locality_id', sa.BigInteger(), nullable=True),
        sa.Column('category_slugs', mysql.JSON(), nullable=True),
        sa.Column('notify_breaking', sa.Boolean(), nullable=False),
        sa.Column('notify_local', sa.Boolean(), nullable=False),
        sa.Column('notify_topics', sa.Boolean(), nullable=False),
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('created_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.Column('updated_at', app.db.types.UTCDateTime(), server_default=sa.text('CURRENT_TIMESTAMP(6)'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_preferences_user_id_users'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['district_id'], ['districts.id'], name=op.f('fk_user_preferences_district_id_districts'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['mandal_id'], ['mandals.id'], name=op.f('fk_user_preferences_mandal_id_mandals'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['locality_id'], ['localities.id'], name=op.f('fk_user_preferences_locality_id_localities'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_user_preferences')),
        sa.UniqueConstraint('user_id', name='uq_user_preferences_user_id'),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci',
        mysql_engine='InnoDB',
    )


def downgrade() -> None:
    op.drop_table('user_preferences')
