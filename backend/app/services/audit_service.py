"""Audit logging (§5, brief §13).

The audit log is **append-only**. This module exposes `record()` and read
helpers, and deliberately provides no update or delete function — "Audit logs
must not be editable through normal admin UI" (brief §13) is enforced by there
being no code path that edits one.

Order of operations on a mutating endpoint (§13):
    permission guard -> scope check -> validation -> service -> audit log
"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.enums import AuditAction
from app.models.user import User

#: Never written into `before`/`after`, even if a caller passes a whole model dump.
_REDACTED_FIELDS = frozenset(
    {
        "password",
        "password_hash",
        "two_factor_secret",
        "refresh_hash",
        "otp",
        "otp_hash",
        "token",
        "access_token",
        "refresh_token",
        "api_key",
        "secret",
        "encryption_key",
    }
)


def _scrub(data: dict[str, Any] | None) -> dict[str, Any] | None:
    """Strip secrets before they are persisted (brief §37)."""
    if data is None:
        return None
    return {
        k: ("[redacted]" if k.lower() in _REDACTED_FIELDS else v)
        for k, v in data.items()
    }


def _client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    # Behind nginx the real address is the first entry of X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:45]
    return request.client.host[:45] if request.client else None


def record(
    db: Session,
    *,
    action: AuditAction,
    entity_type: str,
    entity_id: str | int | None = None,
    actor: User | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    note: str | None = None,
    request: Request | None = None,
) -> AuditLog:
    """Append one audit row.

    Not committed here — it joins the caller's transaction so the audit row and
    the change it describes commit or roll back together. A change that succeeded
    with no audit row, or an audit row for a change that rolled back, would both
    be worse than useless.
    """
    entry = AuditLog(
        actor_id=actor.id if actor else None,
        actor_label=(actor.name_te or actor.name_en)[:160] if actor else None,
        entity_type=entity_type[:40],
        entity_id=str(entity_id)[:64] if entity_id is not None else None,
        action=action,
        before=_scrub(before),
        after=_scrub(after),
        note=note,
        ip=_client_ip(request),
        user_agent=(request.headers.get("user-agent", "")[:400] or None)
        if request
        else None,
        request_id=getattr(request.state, "request_id", None) if request else None,
    )
    db.add(entry)
    return entry


def record_auth_event(
    db: Session,
    *,
    action: AuditAction,
    user: User | None,
    identifier: str | None = None,
    note: str | None = None,
    request: Request | None = None,
) -> AuditLog:
    """§6.2: "Every staff login writes to audit_log."

    Failed logins are recorded with `actor=None` and the attempted identifier in
    the note, because at that point there is no authenticated actor — and the
    identifier is exactly what an investigation needs.
    """
    return record(
        db,
        action=action,
        entity_type="auth",
        entity_id=user.id if user else None,
        actor=user,
        after={"identifier": identifier} if identifier else None,
        note=note,
        request=request,
    )


def list_for_entity(
    db: Session, entity_type: str, entity_id: str | int, limit: int = 100
) -> list[AuditLog]:
    stmt = (
        select(AuditLog)
        .where(
            AuditLog.entity_type == entity_type, AuditLog.entity_id == str(entity_id)
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).scalars())
