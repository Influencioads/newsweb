"""Sanjaya (సంజయ), the newsroom assistant in the admin panel.

    GET    /cms/assistant/status               — can it answer, and with which tools
    GET    /cms/assistant/conversations        — the caller's threads, newest first
    POST   /cms/assistant/messages             — send a message; 202, the turn runs in the background
    GET    /cms/assistant/conversations/{id}   — the thread as the page draws it (poll this)
    DELETE /cms/assistant/conversations/{id}
    GET    /cms/assistant/jobs/{id}            — one background job's progress (poll this)

Every route needs `ai.use`, and every thread and job is visible to its owner
only. The model's reply is not in the POST response: a turn is several model
calls and tools, longer than the browser and nginx will wait, so the page polls
the conversation until `status` leaves `running`.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_permission
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.ratelimit import rate_limit
from app.db.base import utcnow
from app.db.session import get_db
from app.models.assistant import AssistantConversation, AssistantJob, AssistantMessage
from app.models.enums import AuditAction
from app.models.user import User
from app.services import audit_service, settings_service

# Importing the package registers every tool and job runner.
from app.services.assistant import agent, registry

router = APIRouter(prefix="/cms/assistant", tags=["assistant"])

_USE = require_permission("ai.use")

_BUSY = (
    "Sanjaya is still answering your last message. Wait for it to finish.",
    "సంజయ ఇంకా మీ గత సందేశానికి సమాధానం ఇస్తున్నారు. అది పూర్తయ్యే వరకు ఆగండి.",
)


class MessageIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    conversation_id: int | None = None
    text: str = Field(min_length=1, max_length=4000)


def _own(db: Session, p: Principal, conversation_id: int) -> AssistantConversation:
    """The caller's conversation, with a turn killed by a restart marked failed."""
    convo = db.get(AssistantConversation, conversation_id)
    if convo is None or convo.user_id != p.id:
        raise NotFoundError()
    registry.sweep_stale_turn(convo)
    return convo


def _one_turn_at_a_time(db: Session, p: Principal) -> None:
    """409 while any of the caller's conversations is mid-turn.

    Per person, not per conversation: a turn holds a thread and a model call for
    minutes, so POSTs with no conversation id would otherwise stack up turns.
    The user-row lock serialises this person's POSTs on MySQL, and the read
    under it is a locking read so REPEATABLE READ sees the latest committed
    status, not this request's snapshot. (SQLite ignores FOR UPDATE; it has a
    single writer anyway.)
    """
    db.execute(select(User.id).where(User.id == p.id).with_for_update())
    running = db.scalars(
        select(AssistantConversation)
        .where(
            AssistantConversation.user_id == p.id,
            AssistantConversation.status == "running",
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    if [c for c in running if not registry.sweep_stale_turn(c)]:
        raise ConflictError(*_BUSY)


@router.get("/status")
def status(db: Session = Depends(get_db), p: Principal = Depends(_USE)) -> dict:
    ready, reason_en, reason_te = agent.ai_ready(db)
    creds = settings_service.ai_credentials(db)
    return {
        "name_en": registry.ASSISTANT_NAME_EN,
        "name_te": registry.ASSISTANT_NAME_TE,
        "ready": ready,
        "reason_en": reason_en,
        "reason_te": reason_te,
        "ai_enabled": settings_service.ai_enabled(db),
        "research_enabled": settings_service.get_bool(db, "ai.research_enabled"),
        "provider": creds["provider"],
        "model": creds["model"] or None,
        "tools": [agent.tool_label(t.name) for t in registry.tools_for(db, p)],
    }


@router.get("/conversations")
def conversations(
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    p: Principal = Depends(_USE),
) -> dict:
    rows = db.scalars(
        select(AssistantConversation)
        .where(AssistantConversation.user_id == p.id)
        .order_by(
            AssistantConversation.updated_at.desc(), AssistantConversation.id.desc()
        )
        .limit(limit)
    ).all()
    return {
        "items": [
            {
                "id": c.id,
                "title": c.title,
                "status": c.status,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in rows
        ]
    }


@router.post("/messages", status_code=202)
def send_message(
    payload: MessageIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    p: Principal = Depends(_USE),
    _rl: None = Depends(rate_limit("assistant", 20)),
) -> dict:
    _one_turn_at_a_time(db, p)
    convo = None
    if payload.conversation_id is not None:
        convo = _own(db, p, payload.conversation_id)
    ready, reason_en, reason_te = agent.ai_ready(db)
    if not ready:
        raise ValidationError(reason_en, reason_te)
    if convo is None:
        convo = AssistantConversation(
            user_id=p.id, title=" ".join(payload.text.split())[:80]
        )
        db.add(convo)
        db.flush()
    db.add(
        AssistantMessage(conversation_id=convo.id, role="user", content=payload.text)
    )
    convo.status, convo.error, convo.heartbeat_at = "running", None, utcnow()
    db.flush()
    # Background tasks run after get_db has committed, so the turn's own
    # session finds the message and the `running` status. `spawn` gives the
    # turn its own thread: minutes of it must not hold a request-pool thread.
    background.add_task(registry.spawn, agent.run_turn, convo.id)
    return agent.display(db, convo)


@router.get("/conversations/{conversation_id}")
def conversation(
    conversation_id: int, db: Session = Depends(get_db), p: Principal = Depends(_USE)
) -> dict:
    return agent.display(db, _own(db, p, conversation_id))


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: int, db: Session = Depends(get_db), p: Principal = Depends(_USE)
) -> Response:
    convo = _own(db, p, conversation_id)
    if convo.status == "running":
        # The live turn's next commit (its billed round included) would fail.
        raise ConflictError(*_BUSY)
    # Explicit rather than the FK cascade / SET NULL: SQLite enforces neither
    # and reuses the id, so the next thread would inherit this transcript.
    db.execute(
        delete(AssistantMessage).where(AssistantMessage.conversation_id == convo.id)
    )
    db.execute(
        update(AssistantJob)
        .where(AssistantJob.conversation_id == convo.id)
        .values(conversation_id=None)
    )
    audit_service.record(
        db,
        action=AuditAction.DELETE,
        entity_type="assistant_conversation",
        entity_id=convo.id,
        actor=p.user,
        before={"title": convo.title},
    )
    db.delete(convo)
    return Response(status_code=204)


@router.get("/jobs/{job_id}")
def job(
    job_id: int, db: Session = Depends(get_db), p: Principal = Depends(_USE)
) -> dict:
    row = db.get(AssistantJob, job_id)
    if row is None or row.user_id != p.id:
        raise NotFoundError()
    registry.sweep_stale_job(row)
    return registry.job_row(row)
