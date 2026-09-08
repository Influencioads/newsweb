"""Phase H (updated doc §1, §8, §9): pin-on-publish intent from the article form.

Two nullable columns, no backfill. NULL means "do not pin", which is what every
existing row means today, so the migration changes no behaviour on its own.

The TRENDING pin placement needs no DDL: `pins.placement` is a VARCHAR with a
CHECK constraint rather than a native ENUM precisely so a new value costs one
statement instead of a locking ALTER (see models/enums.py).

Revision ID: c39a5e1f8b72
Revises: a1c74f2b6d09
Create Date: 2026-09-08 14:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.types  # noqa: F401

revision: str = 'c39a5e1f8b72'
down_revision: Union[str, None] = 'a1c74f2b6d09'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('articles') as batch:
        batch.add_column(sa.Column('pin_home_minutes', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('pin_trending_minutes', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('articles') as batch:
        batch.drop_column('pin_trending_minutes')
        batch.drop_column('pin_home_minutes')
