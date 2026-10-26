"""Hourly crawl tasks.

Three beat entries rather than one chain, deliberately:

  * `crawl.hourly` fetches and `crawl.rewrite_pass` rewrites. Beat fires both
    every five minutes and each decides whether this tick is one of its own
    (`crawl.fetch_every_minutes` / `crawl.rewrite_every_minutes`; hourly lands
    on :05 and :20 as it always has). Chaining them would couple the rewrite
    to the fetch completing and add a Redis-backed failure mode for no
    editorial benefit. Decoupled, a slow or failed fetch simply means those
    items are picked up next pass.
  * `crawl.breaking` runs every five minutes over the breaking beat only,
    because hourly breaking news is not breaking.

Every task gates on the admin switches *inside* the task — on/off, the IST
crawl hours, the cadence — reading them from the database exactly as
`epaper.schedule` does, so a change takes effect within the settings cache TTL
and needs no deploy.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.db.session import session_scope
from app.models.enums import SourceBeat
from app.services import crawl_service, settings_service
from app.workers.celery_app import celery

logger = get_logger(__name__)

#: Seconds. The pass stops starting work on its own well before this
#: (`crawl_service.PASS_DEADLINE_S`); the soft limit is the backstop for a
#: single call that hangs. "Run now" fetches first, so it gets longer.
PASS_SOFT_LIMIT = 20 * 60
RUN_NOW_SOFT_LIMIT = 30 * 60


def _skip(db: Session, every_key: str | None, offset: int = 0) -> str | None:
    """Why this tick should do nothing, or None when it should run."""
    if not crawl_service.crawl_enabled(db):
        return "disabled"
    # No cadence key is the breaking beat, which may ignore the crawl hours.
    if every_key is None and settings_service.get_bool(db, "crawl.breaking_all_day"):
        return None
    if not settings_service.crawl_active_now(db):
        return "outside_hours"
    if every_key and not crawl_service.claim_tick(db, every_key, offset=offset):
        return "not_due"
    return None


@celery.task(name="crawl.hourly", soft_time_limit=PASS_SOFT_LIMIT)
def crawl_hourly() -> dict[str, object]:
    with session_scope() as db:
        if skipped := _skip(db, "crawl.fetch_every_minutes", offset=5):
            return {"skipped": skipped}
        return crawl_service.run_fetch_pass(db)


@celery.task(name="crawl.rewrite_pass", soft_time_limit=PASS_SOFT_LIMIT)
def crawl_rewrite_pass() -> dict[str, object]:
    with session_scope() as db:
        if skipped := _skip(db, "crawl.rewrite_every_minutes", offset=20):
            return {"skipped": skipped}
        return crawl_service.run_rewrite_pass(db)


@celery.task(name="crawl.breaking", soft_time_limit=PASS_SOFT_LIMIT)
def crawl_breaking() -> dict[str, object]:
    """Fetch and rewrite the breaking beat on its own faster cadence."""
    with session_scope() as db:
        if skipped := _skip(db, None):
            return {"skipped": skipped}
        beats = {SourceBeat.BREAKING}
        out: dict[str, object] = crawl_service.run_fetch_pass(db, beats=beats, workers=3)
        out.update(
            crawl_service.run_rewrite_pass(
                db,
                beats=beats,
                cap_override=settings_service.get_int(db, "crawl.breaking_hourly_cap"),
            )
        )
        return out


@celery.task(name="crawl.run_now", soft_time_limit=RUN_NOW_SOFT_LIMIT)
def crawl_run_now(
    fetch: bool = True,
    rewrite: bool = True,
    beat: str | None = None,
    actor_id: int | None = None,
) -> dict[str, object]:
    """The admin's "Run crawl now": ignores the hours and cadence, not the caps.

    Queued, not run in the request. A pass is minutes of sequential model
    calls; on the `ingest` queue it waits its turn behind any scheduled pass
    (one task at a time), so two passes never pay for the same item.
    """
    with session_scope() as db:
        if not crawl_service.crawl_enabled(db):
            return {"skipped": "disabled"}
        beats = {SourceBeat(beat)} if beat else None
        out: dict[str, object] = {}
        if fetch:
            out["fetch"] = crawl_service.run_fetch_pass(db, beats=beats)
        if rewrite:
            out["rewrite"] = crawl_service.run_rewrite_pass(
                db, beats=beats, actor_id=actor_id
            )
        return out
