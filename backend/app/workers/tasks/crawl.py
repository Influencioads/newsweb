"""Hourly crawl tasks.

Three beat entries rather than one chain, deliberately:

  * `crawl.hourly` fetches at :05 and `crawl.rewrite_pass` rewrites at :20.
    Chaining them would couple the rewrite to the fetch completing and add a
    Redis-backed failure mode for no editorial benefit. Decoupled, a slow or
    failed fetch simply means those items are picked up next hour.
  * `crawl.breaking` runs every five minutes over the breaking beat only,
    because hourly breaking news is not breaking.

Every task gates on the admin switch *inside* the task, reading it from the
database exactly as `epaper.schedule` does, so turning the crawl off takes
effect within the settings cache TTL and needs no deploy.
"""

from __future__ import annotations

from app.core.logging import get_logger
from app.db.session import session_scope
from app.models.enums import SourceBeat
from app.services import crawl_service, settings_service
from app.workers.celery_app import celery

logger = get_logger(__name__)


@celery.task(name="crawl.hourly")
def crawl_hourly() -> dict[str, object]:
    with session_scope() as db:
        if not crawl_service.crawl_enabled(db):
            return {"skipped": "disabled"}
        return crawl_service.run_fetch_pass(db)


@celery.task(name="crawl.rewrite_pass")
def crawl_rewrite_pass() -> dict[str, object]:
    with session_scope() as db:
        if not crawl_service.crawl_enabled(db):
            return {"skipped": "disabled"}
        return crawl_service.run_rewrite_pass(db)


@celery.task(name="crawl.breaking")
def crawl_breaking() -> dict[str, object]:
    """Fetch and rewrite the breaking beat on its own faster cadence."""
    with session_scope() as db:
        if not crawl_service.crawl_enabled(db):
            return {"skipped": "disabled"}
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
