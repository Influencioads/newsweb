"""Daily AI topic discovery (§18).

`ai.auto_suggest` existed as a settings switch and a toggle on the settings
screen, but nothing read it: no task, no beat entry. Turning it on silently did
nothing, which is worse than not offering the switch — an editor would wait for
suggestions that were never going to arrive.

The task gates *inside* itself, reading both switches from the database exactly
as the crawl tasks do, so turning discovery off takes effect within the settings
cache TTL and needs no deploy.

Nothing here publishes. `generate_suggestions` writes AiSuggestion rows, which
are proposals an editor accepts or rejects; the separate-approver rule in the
workflow still applies to anything that becomes an article.
"""

from __future__ import annotations

from app.core.logging import get_logger
from app.db.session import session_scope
from app.services import ai_service, settings_service
from app.workers.celery_app import celery

logger = get_logger(__name__)


@celery.task(name="ai.auto_suggest")
def ai_auto_suggest() -> dict[str, object]:
    with session_scope() as db:
        if not settings_service.ai_enabled(db):
            return {"skipped": "ai disabled"}
        if not settings_service.get_bool(db, "ai.auto_suggest"):
            return {"skipped": "auto_suggest off"}
        try:
            created = ai_service.generate_suggestions(db, actor_id=None)
        except Exception:  # noqa: BLE001 — a provider outage must not kill the beat
            logger.warning("ai_auto_suggest_failed", exc_info=True)
            return {"skipped": "provider error"}
        # `generate_suggestions` enforces ai.daily_suggestion_limit itself and
        # raises ConflictError once the day's ceiling is reached, so a second
        # run in the same day is a no-op rather than a doubling of spend.
        count = len(created) if created is not None else 0
        logger.info("ai_auto_suggest_done", created=count)
        return {"created": count}
