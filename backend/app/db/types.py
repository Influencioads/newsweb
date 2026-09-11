"""Custom SQLAlchemy column types.

`UTCDateTime` exists because MySQL has no timezone-aware datetime type. A column
declared `DateTime(timezone=True)` still round-trips as a **naive** datetime on
MySQL, so comparing a stored value against `datetime.now(timezone.utc)` raises
`TypeError: can't compare offset-naive and offset-aware datetimes`.

Rather than scatter `.replace(tzinfo=utc)` through the services — where one
missed call is a latent bug — the conversion is done once, at the column
boundary:

  * on write: any aware value is converted to UTC, then stored naive;
    a naive value is *assumed* to already be UTC (the codebase never produces
    local-time datetimes — `app.db.base.utcnow()` is the only clock).
  * on read: UTC tzinfo is attached, so everything above this layer is aware.

Precision is `DATETIME(6)`. Microseconds matter for ordering: several audit rows
or workflow transitions can land inside the same second, and "newest first" has
to be deterministic.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator[datetime]):
    """A datetime column that is always UTC-aware in Python, naive-UTC in MySQL."""

    impl = DateTime
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect) -> Any:
        if dialect.name == "mysql":
            from sqlalchemy.dialects.mysql import DATETIME as MYSQL_DATETIME

            return dialect.type_descriptor(MYSQL_DATETIME(fsp=6))
        return dialect.type_descriptor(DateTime(timezone=True))

    def process_bind_param(
        self, value: datetime | None, dialect: Dialect
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            # Assumed UTC — see the module docstring.
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(
        self, value: datetime | None, dialect: Dialect
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
