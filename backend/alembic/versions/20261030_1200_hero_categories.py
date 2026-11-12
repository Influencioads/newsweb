"""Nomination form: a Sports hero category, and two renamed labels.

Data only. Touches the nomination block the desk saved from the CMS
(`app_settings` key `content.nominate`); a site that never saved it already
reads the new defaults from site_content.py. In a saved block:

* "యువ విజయం" becomes "యువత" and "ఇతరాలు" becomes "ఇతరులు" — only those
  exact labels, so anything else an editor typed is left alone;
* క్రీడలు / Sports is added (before "Other", if there is one) unless a
  `sports` category is already there or the list is full.

Revision ID: d4f8b2c6e1a9
Revises: c2e5a9d3f7b1
Create Date: 2026-10-30 12:00:00
"""

from __future__ import annotations

import json
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4f8b2c6e1a9"
down_revision: Union[str, None] = "c2e5a9d3f7b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEY = "content.nominate"
RENAMES = {"యువ విజయం": "యువత", "ఇతరాలు": "ఇతరులు"}
SPORTS = {"value": "sports", "te": "క్రీడలు", "en": "Sports"}
MAX_CATEGORIES = 20  # site_content.Nominate.categories max_length

_settings = sa.table("app_settings", sa.column("key", sa.String), sa.column("value", sa.JSON))


def _load() -> tuple[Any, dict[str, Any]] | None:
    row = op.get_bind().execute(sa.select(_settings.c.value).where(_settings.c.key == KEY)).first()
    if row is None:
        return None
    value = row[0]
    if isinstance(value, str):
        value = json.loads(value)
    block = (value or {}).get("v")
    if not isinstance(block, dict) or not isinstance(block.get("categories"), list):
        return None
    return value, block


def _save(value: dict[str, Any]) -> None:
    op.get_bind().execute(sa.update(_settings).where(_settings.c.key == KEY).values(value=value))


def upgrade() -> None:
    loaded = _load()
    if loaded is None:
        return
    value, block = loaded
    cats: list[dict[str, Any]] = block["categories"]
    for c in cats:
        if isinstance(c, dict) and c.get("te") in RENAMES:
            c["te"] = RENAMES[c["te"]]
    if not any(isinstance(c, dict) and c.get("value") == "sports" for c in cats) and len(cats) < MAX_CATEGORIES:
        at = next((i for i, c in enumerate(cats) if isinstance(c, dict) and c.get("value") == "other"), len(cats))
        cats.insert(at, dict(SPORTS))
    _save(value)


def downgrade() -> None:
    loaded = _load()
    if loaded is None:
        return
    value, block = loaded
    # Only the added Sports row comes out. The relabels stay: "యువత" and
    # "ఇతరులు" are also the shipped defaults, so there is no telling which
    # rows this migration changed.
    block["categories"] = [c for c in block["categories"] if not (isinstance(c, dict) and c == SPORTS)]
    _save(value)
