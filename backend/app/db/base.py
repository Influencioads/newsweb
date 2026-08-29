"""SQLAlchemy declarative base and the mixins every table shares.

Conventions fixed here (brief §30, §31):

* All timestamps are **UTC**, stored as `DATETIME(6)` via `UTCDateTime`. MySQL
  `TIMESTAMP` has a 2038 limit and applies session time zones silently; a news
  archive must not depend on either.
* Every table carries `created_at` / `updated_at`.
* Content tables carry `created_by` / `updated_by` audit fields.
* Content tables are **soft-deleted** (§5: "we never hard-delete an article").
* Naming convention is explicit so Alembic autogenerate produces stable,
  human-readable constraint names instead of MySQL's anonymous ones.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import BigInteger, ForeignKey, MetaData, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.db.types import UTCDateTime

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# utf8mb4 is non-negotiable: Telugu code points and the ZWJ/ZWNJ joiners the
# script depends on do not survive MySQL's legacy 3-byte `utf8` (§4.1, §4.2).
MYSQL_TABLE_ARGS: dict[str, Any] = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_unicode_ci",
}

# DATETIME(6) needs a matching-precision default; plain CURRENT_TIMESTAMP is
# rejected by MySQL against a fractional-second column.
# Python-side defaults retain microseconds; the portable server fallback also
# works in SQLite for dependency-free local development.
_NOW_6 = text("CURRENT_TIMESTAMP")


def utcnow() -> datetime:
    """Timezone-aware UTC now. Use this, never `datetime.now()`."""
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        pk = getattr(self, "id", None)
        return f"<{type(self).__name__} id={pk}>"


class PKMixin:
    """Surrogate BIGINT primary key."""

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)


class TimestampMixin:
    """created_at / updated_at.

    Both a Python default and a server default are declared: the Python default
    guarantees microsecond precision and a tz-aware value in the ORM, while the
    server default keeps the column correct for any migration or maintenance
    statement that inserts outside the ORM.
    """

    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        nullable=False,
        default=utcnow,
        server_default=_NOW_6,
        doc="UTC creation time",
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=_NOW_6,
        doc="UTC last-modification time",
    )


class SoftDeleteMixin:
    """Soft delete (§5). A non-null `deleted_at` means the row is withdrawn.

    Every read path must filter on `deleted_at IS NULL`; the repository layer
    does this centrally so a feature file cannot forget.
    """

    deleted_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
        default=None,
        index=True,
        doc="UTC soft-delete time; NULL means live",
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class ActorMixin:
    """created_by / updated_by audit columns (brief §30 'audit fields').

    Nullable because seeds and system jobs act without a user.
    """

    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
