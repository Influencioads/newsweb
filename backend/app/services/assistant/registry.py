"""Sanjaya's tool registry and background-job runner.

A tool is a plain function the model may call, registered with the permissions
the equivalent CMS route demands. `tools_for()` only ever offers the model the
tools this staff member could use by hand, and `execute()` re-checks anyway, so
the assistant can never do more than the person typing to it.

Contract every tool follows
---------------------------
* `handler(ctx, args) -> dict`. The dict goes back to the model as JSON, so keep
  it compact (ids, counts, short strings — never raw bodies, never PII: no
  email, phone, IP, token, KYC field, reader identifier).
* Optional key `"cards"`: a list of card dicts the admin page draws under the
  reply. It is stripped before the model sees the result. Card shapes are the
  frontend contract — see `CARD_TYPES` below.
* Raise `AppError` subclasses for refusals; `execute()` turns them into
  `{"error": code, "message": ...}` for the model instead of failing the turn.
* Anything that takes longer than a few seconds is a **job**: call
  `start_job(ctx, kind, params, title)` and return what it returns.

Nothing here publishes, approves, or sends. Outward actions are proposed as an
`action` card; a human presses the button and the existing route does the work
with all of its own checks.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, build_principal
from app.core.errors import AppError, ConflictError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.db.session import session_scope
from app.models.assistant import AssistantConversation, AssistantJob
from app.models.user import User

logger = get_logger(__name__)

ASSISTANT_NAME_EN = "Sanjaya"
ASSISTANT_NAME_TE = "సంజయ"

#: A turn or job whose heartbeat is older than this was killed (deploy, reload).
STALE_AFTER = timedelta(minutes=5)
#: Per-user ceiling on jobs in flight — a model stuck in a loop cannot fan out.
MAX_ACTIVE_JOBS = 3
#: What the model is sent of one tool result; the page still gets every card.
MAX_RESULT_CHARS = 8000

#: The card shapes the admin page knows how to draw. `Text` below means either
#: a plain string or {"te": str, "en": str}; the page picks by UI language.
CARD_TYPES = {
    "stats": '{"type":"stats","title"?:Text,"items":[{"label":Text,"value":str|num,"hint"?:Text}]}',
    "bars": '{"type":"bars","title"?:Text,"unit"?:str,"items":[{"label":Text,"value":num,"display"?:str}]}',
    "table": '{"type":"table","title"?:Text,"columns":[{"key":str,"label":Text,"align"?:"left"|"right"}],"rows":[{key:str|num|null}]}',
    "articles": '{"type":"articles","title"?:Text,"items":[{"id":int,"short_id":str,"title":str,"workflow_state":str,"note"?:Text}]}',
    "sources": '{"type":"sources","title"?:Text,"items":[{"title":str,"url":str,"date"?:str,"snippet"?:str}]}',
    "job": '{"type":"job","job_id":int}',
    "bulletin": '{"type":"bulletin","id":int,"date":str,"slot":int,"slot_label_te":str,"status":str,"url":str|null,"duration_sec":num|null}',
    "action": '{"type":"action","action":"approve_article"|"publish_article"|"send_push"|"publish_bulletin","label":Text,"summary":Text,"params":{...}}',
    "image": '{"type":"image","url":str,"alt":str}',
}


# --------------------------------------------------------------------------- #
# Sessions and threads — module attributes so tests can point them elsewhere.
# --------------------------------------------------------------------------- #
@contextmanager
def open_session() -> Iterator[Session]:
    """The session background work runs in. Tests monkeypatch this."""
    with session_scope() as db:
        yield db


def spawn(fn: Callable[..., Any], *args: Any) -> None:
    """Run `fn(*args)` off the request thread. Tests monkeypatch this to inline.

    ponytail: a daemon thread in the API process, like the e-paper PDF job. A
    deploy kills it mid-run; the heartbeat sweep marks it failed. Move to a
    Celery queue of its own if jobs outgrow that.
    """
    threading.Thread(target=fn, args=args, daemon=True, name=f"assistant-{fn.__name__}").start()


# --------------------------------------------------------------------------- #
# Tools
# --------------------------------------------------------------------------- #
@dataclass
class ToolContext:
    db: Session
    principal: Principal
    conversation_id: int | None = None

    @property
    def user_id(self) -> int:
        return self.principal.id


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    handler: Callable[[ToolContext, dict[str, Any]], dict[str, Any]]
    parameters: dict[str, Any] = field(
        default_factory=lambda: {"type": "object", "properties": {}}
    )
    #: Every one of these is required.
    permissions: tuple[str, ...] = ()
    #: At least one of these is required (for routes guarded by require_any).
    any_of: tuple[str, ...] = ()
    #: A runtime switch (e.g. `ai.research_enabled`). False hides the tool.
    enabled: Callable[[Session], bool] | None = None
    #: What the page shows while/after the tool runs ("Web research").
    label_te: str = ""
    label_en: str = ""

    def allowed(self, principal: Principal) -> bool:
        if not all(principal.has(p) for p in self.permissions):
            return False
        return not self.any_of or any(principal.has(p) for p in self.any_of)

    def spec(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


TOOLS: dict[str, Tool] = {}


def tool(
    name: str,
    description: str,
    parameters: dict[str, Any] | None = None,
    *,
    permissions: tuple[str, ...] = (),
    any_of: tuple[str, ...] = (),
    enabled: Callable[[Session], bool] | None = None,
    label: tuple[str, str] = ("", ""),
) -> Callable[[Callable[[ToolContext, dict[str, Any]], dict[str, Any]]], Callable[..., Any]]:
    """Register a tool. `parameters` is a JSON schema object; `label` is
    (Telugu, English) for the page."""

    def register(fn: Callable[[ToolContext, dict[str, Any]], dict[str, Any]]) -> Callable[..., Any]:
        if name in TOOLS:
            raise RuntimeError(f"assistant tool {name!r} registered twice")
        TOOLS[name] = Tool(
            name=name,
            description=description,
            handler=fn,
            parameters=parameters or {"type": "object", "properties": {}},
            permissions=permissions,
            any_of=any_of,
            enabled=enabled,
            label_te=label[0],
            label_en=label[1],
        )
        return fn

    return register


def tools_for(db: Session, principal: Principal) -> list[Tool]:
    """The tools this person may use right now, in registration order."""
    out = []
    for t in TOOLS.values():
        if not t.allowed(principal):
            continue
        if t.enabled is not None and not t.enabled(db):
            continue
        out.append(t)
    return out


def _error(code: str, message_en: str, message_te: str = "", **details: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"error": code, "message": message_en}
    if message_te:
        out["message_te"] = message_te
    if details:
        out["details"] = details
    return out


def execute(
    ctx: ToolContext, name: str, raw_args: str | dict[str, Any] | None
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Run one tool call. Returns (data for the model, cards for the page).

    Never raises. The caller must have committed before calling: a failing tool
    is rolled back, and that rollback must not take the transcript with it.
    """
    t = TOOLS.get(name)
    if t is None:
        return _error("UNKNOWN_TOOL", f"There is no tool called {name}."), []

    if isinstance(raw_args, dict):
        args = raw_args
    else:
        try:
            args = json.loads(raw_args or "{}")
        except (TypeError, ValueError):
            return _error("BAD_ARGUMENTS", "Arguments were not valid JSON."), []
        if not isinstance(args, dict):
            return _error("BAD_ARGUMENTS", "Arguments must be a JSON object."), []

    if not t.allowed(ctx.principal):
        need = list(t.permissions) or list(t.any_of)
        return _error(
            "PERMISSION_DENIED",
            "You do not have permission for this.",
            "దీనికి మీకు అనుమతి లేదు.",
            required=need,
        ), []
    if t.enabled is not None and not t.enabled(ctx.db):
        return _error(
            "DISABLED",
            "This is switched off in Settings.",
            "ఇది సెట్టింగ్స్‌లో ఆఫ్ చేసి ఉంది.",
        ), []

    try:
        result = t.handler(ctx, args) or {}
    except AppError as exc:
        ctx.db.rollback()
        return _error(
            getattr(exc, "code", "ERROR"), exc.message_en, exc.message_te, **(exc.details or {})
        ), []
    except Exception:  # noqa: BLE001 — one broken tool must not end the conversation
        ctx.db.rollback()
        logger.exception("assistant tool failed", tool=name)
        return _error(
            "TOOL_FAILED",
            "That tool failed unexpectedly.",
            "ఆ పని అనుకోకుండా విఫలమైంది.",
        ), []

    cards = result.pop("cards", None) or []
    return result, [c for c in cards if isinstance(c, dict)]


def result_for_model(data: dict[str, Any]) -> str:
    """The tool message content: compact JSON, clipped to `MAX_RESULT_CHARS`."""
    text = json.dumps(data, ensure_ascii=False, default=str, separators=(",", ":"))
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + '…"(truncated)"'
    return text


# --------------------------------------------------------------------------- #
# Jobs
# --------------------------------------------------------------------------- #
@dataclass
class JobContext:
    db: Session
    principal: Principal
    job: AssistantJob

    @property
    def user_id(self) -> int:
        return self.principal.id

    @property
    def params(self) -> dict[str, Any]:
        return dict(self.job.params or {})

    def step(self, progress: int, text: str) -> None:
        """Report progress and heartbeat. Commits, so the page sees it and any
        paid work done so far survives a later failure."""
        self.job.progress = max(0, min(99, int(progress)))
        self.job.step_text = text[:300]
        self.job.heartbeat_at = utcnow()
        self.db.commit()


JobRunner = Callable[[JobContext], dict[str, Any]]
JOB_RUNNERS: dict[str, JobRunner] = {}


def job_runner(kind: str) -> Callable[[JobRunner], JobRunner]:
    """Register the function that runs jobs of `kind`.

    It returns the job's `result`: `{"summary": str, "cards": [...], ...}`.
    `summary` is what the model is told when it checks the job; `cards` are
    drawn on the job card when it finishes. Raise `AppError` to fail cleanly.
    """

    def register(fn: JobRunner) -> JobRunner:
        if kind in JOB_RUNNERS:
            raise RuntimeError(f"assistant job {kind!r} registered twice")
        JOB_RUNNERS[kind] = fn
        return fn

    return register


def start_job(
    ctx: ToolContext, kind: str, params: dict[str, Any], title: str
) -> dict[str, Any]:
    """Create a job row, commit it, and run it in the background.

    Returns a tool result: the model learns the job id, the page gets a job card.
    """
    if kind not in JOB_RUNNERS:
        raise RuntimeError(f"no runner for assistant job {kind!r}")
    active = ctx.db.execute(
        select(func.count(AssistantJob.id)).where(
            AssistantJob.user_id == ctx.user_id,
            AssistantJob.status.in_(("queued", "running")),
        )
    ).scalar_one()
    if active >= MAX_ACTIVE_JOBS:
        raise ConflictError(
            f"You already have {active} jobs running. Wait for one to finish.",
            f"ఇప్పటికే {active} పనులు నడుస్తున్నాయి. ఒకటి పూర్తయ్యే వరకు ఆగండి.",
        )
    job = AssistantJob(
        user_id=ctx.user_id,
        conversation_id=ctx.conversation_id,
        kind=kind,
        title=title[:200],
        params=params,
        status="queued",
        heartbeat_at=utcnow(),
    )
    ctx.db.add(job)
    ctx.db.commit()
    spawn(run_job, job.id)
    return {
        "job_id": job.id,
        "status": "queued",
        "note": "Running in the background; the user sees live progress on the job card.",
        "cards": [{"type": "job", "job_id": job.id}],
    }


def _fail(job: AssistantJob, exc: AppError | None) -> None:
    job.status = "failed"
    job.finished_at = utcnow()
    if exc is None:
        job.error = "The job failed unexpectedly."
        job.result = {
            "error": {
                "code": "INTERNAL_ERROR",
                "message_en": job.error,
                "message_te": "ఈ పని అనుకోకుండా విఫలమైంది.",
            }
        }
    else:
        job.error = exc.message_en
        job.result = {
            "error": {
                "code": getattr(exc, "code", "ERROR"),
                "message_en": exc.message_en,
                "message_te": exc.message_te,
            }
        }


def principal_for(db: Session, user_id: int) -> Principal | None:
    """Rebuild the staff member's permissions at execution time.

    Not the HTTP token (it expires in 15 minutes): the live user row, so a
    suspended account or a revoked role stops a job that has not started yet.
    """
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        return None
    return build_principal(user, "assistant")


def run_job(job_id: int) -> None:
    """Background entry point. Never raises."""
    try:
        with open_session() as db:
            job = db.get(AssistantJob, job_id)
            if job is None or job.status != "queued":
                return
            principal = principal_for(db, job.user_id)
            # Read now: after a runner's own rollback `job` is expired, and
            # reloading it from a session left broken would leave the job
            # "running" until the stale sweep.
            kind = job.kind
            runner = JOB_RUNNERS.get(kind)
            if principal is None or runner is None:
                _fail(job, None)
                return
            now = utcnow()
            job.status, job.started_at, job.heartbeat_at = "running", now, now
            db.commit()
            try:
                result = runner(JobContext(db=db, principal=principal, job=job)) or {}
            except AppError as exc:
                db.rollback()
                job = db.get(AssistantJob, job_id)
                if job is not None:
                    _fail(job, exc)
                return
            except Exception:  # noqa: BLE001
                logger.exception("assistant job failed", job_id=job_id, kind=kind)
                db.rollback()
                job = db.get(AssistantJob, job_id)
                if job is not None:
                    _fail(job, None)
                return
            # The JSON column serialises with plain json.dumps: a Decimal or a
            # date in a result would fail the commit and strand the job.
            job.result = json.loads(json.dumps(result, ensure_ascii=False, default=str))
            job.status = "done"
            job.progress = 100
            job.step_text = None
            job.finished_at = utcnow()
    except Exception:  # noqa: BLE001 — a thread has nobody to raise to
        logger.exception("assistant job crashed", job_id=job_id)


def sweep_stale_job(job: AssistantJob) -> bool:
    """Mark a job killed by a restart as failed. True if it changed."""
    if job.status not in ("queued", "running"):
        return False
    beat = job.heartbeat_at or job.created_at
    if beat is None or utcnow() - beat < STALE_AFTER:
        return False
    _fail(
        job,
        ConflictError(
            "The job was interrupted (the server restarted). Start it again.",
            "సర్వర్ రీస్టార్ట్ కావడంతో ఈ పని ఆగిపోయింది. మళ్లీ ప్రారంభించండి.",
        ),
    )
    return True


def sweep_stale_turn(convo: AssistantConversation) -> bool:
    """Same for a conversation whose turn died mid-flight."""
    if convo.status != "running":
        return False
    beat = convo.heartbeat_at or convo.updated_at
    if beat is None or utcnow() - beat < STALE_AFTER:
        return False
    convo.status = "failed"
    # "te\nen", as agent._both writes it: the page shows one line by UI language.
    convo.error = (
        "సర్వర్ రీస్టార్ట్ కావడంతో ఈ సమాధానం ఆగిపోయింది. మళ్లీ పంపండి.\n"
        "The reply was interrupted (the server restarted). Send it again."
    )
    return True


def job_row(job: AssistantJob) -> dict[str, Any]:
    """The job as the page and the model see it."""
    return {
        "id": job.id,
        "kind": job.kind,
        "title": job.title,
        "status": job.status,
        "progress": job.progress,
        "step_text": job.step_text,
        "result": job.result,
        "error": job.error,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }
