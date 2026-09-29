"""Let brand colours that pinned the old teal palette follow the new logo defaults.

The palette moved from peacock teal / amber / gold to the logo's red and blue
(`settings_service` defaults, `assets/index.css`). A Settings save writes every
brand field, so a site whose admin never picked a colour can still hold rows
that equal the *old* defaults — and a stored value wins over any default, so
those sites would stay teal. Only rows still equal to an old default are
removed; a colour an admin actually chose is left alone.

Revision ID: 8e1c5a3f6d27
Revises: 7d0b4f2e5c16
Create Date: 2026-09-24 12:00:00
"""

from __future__ import annotations

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db.types  # noqa: F401 — registers the BigInteger compile hook

revision: str = "8e1c5a3f6d27"
down_revision: Union[str, None] = "7d0b4f2e5c16"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_DEFAULTS = {
    "brand.primary": "#0f5f57",
    "brand.breaking": "#9a5b0b",
    "brand.accent": "#b48a2a",
}


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT `key`, value FROM app_settings WHERE `key` IN :keys").bindparams(
            sa.bindparam("keys", expanding=True)
        ),
        {"keys": list(OLD_DEFAULTS)},
    ).all()
    for key, value in rows:
        if isinstance(value, str):
            value = json.loads(value)
        stored = (value or {}).get("v")
        if isinstance(stored, str) and stored.lower() == OLD_DEFAULTS[key]:
            conn.execute(sa.text("DELETE FROM app_settings WHERE `key` = :k"), {"k": key})


def downgrade() -> None:
    # The removed rows only restated a default; nothing to put back.
    pass
