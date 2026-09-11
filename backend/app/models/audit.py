"""Append-only audit log (§5, brief §13).

    audit_log(id, actor_id, entity_type, entity_id, action, before, after, ip,
              created_at)

Rules this table exists to satisfy:
  * "append-only, never deleted" (§5) — there is no update or delete path in the
    repository, and no CMS route exposes one (brief §13).
  * Retain for 3 years minimum (§5).
  * Every mutating CMS endpoint writes here, after the service call (§13).
  * `before` / `after` are JSON. On MySQL that is the `JSON` type, which is the
    engineering substitute for the spec's `jsonb` (docs/SOURCE_CONFLICTS.md C-2).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, utcnow
from app.db.types import UTCDateTime
from app.models.enums import AuditAction


class AuditLog(PKMixin, Base):
    """One immutable record per meaningful action.

    Deliberately does not use TimestampMixin: an audit row is never updated, so
    an `updated_at` column would be a lie.
    """

    __tablename__ = "audit_log"
    __table_args__ = (
        # §5: the lookup pattern is "history of this entity, newest first".
        Index(
            "ix_audit_log_entity_type_entity_id_created_at",
            "entity_type",
            "entity_id",
            "created_at",
        ),
        Index("ix_audit_log_actor_id_created_at", "actor_id", "created_at"),
        Index("ix_audit_log_action_created_at", "action", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    actor_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        doc="NULL for system actions (scheduled publish, workers) and failed logins",
    )
    actor_label: Mapped[str | None] = mapped_column(
        String(160),
        nullable=True,
        doc="Denormalised actor name, so history stays readable after a user is removed",
    )

    entity_type: Mapped[str] = mapped_column(
        String(40), nullable=False, doc="e.g. 'article', 'user', 'epaper_edition'"
    )
    entity_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, doc="String, because some entities key on short_id"
    )
    action: Mapped[AuditAction] = mapped_column(
        Enum(AuditAction, native_enum=False, length=30, validate_strings=True),
        nullable=False,
    )

    before: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)
    request_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        doc="Correlates the audit row with the structured log line",
    )

    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        nullable=False,
        default=utcnow,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AuditLog {self.action} {self.entity_type}:{self.entity_id}>"
