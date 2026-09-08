"""Editable runtime settings (updated doc §18, §20, §35).

`app/core/config.py` holds *deployment* configuration — secrets, hosts, feature
compilation. Those are environment variables and stay read-only at runtime.

This table holds *editorial* configuration: the things §18 and §20 put behind an
admin switch (AI on/off, voice on/off) and the §35 feed ratios. They change
during a news day, by an editor, without a deploy — which is exactly what an
environment variable cannot do.

One row per key. The value is JSON so a ratio block and a boolean live in the
same table without a column per setting.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin


class AppSetting(PKMixin, TimestampMixin, Base):
    __tablename__ = "app_settings"
    __table_args__ = (
        UniqueConstraint("key", name="uq_app_settings_key"),
        MYSQL_TABLE_ARGS,
    )

    key: Mapped[str] = mapped_column(
        String(120), nullable=False, doc="Dotted key, e.g. 'ai.enabled' or 'feed.ratios'"
    )
    value: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        doc="Always an object: {'v': <the value>}. Wrapping keeps scalars valid JSON on MySQL.",
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AppSetting {self.key}>"
