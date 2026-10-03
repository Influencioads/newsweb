"""The audio bulletin tasks.

Two crontabs built from `bulletin_service.SLOTS` — rather than the e-paper's
tick-and-compare idiom, because the six slots are a product decision and not
an admin setting. Celery's timezone is already Asia/Kolkata, so they fire on
IST: `bulletin.prepare` records each slot at quarter to (`LEAD_MINUTES`
early) and `bulletin.run_slot` airs it on the hour. Neither can
double-produce, because `(bulletin_date, slot)` is unique.

`bulletin.retry` exists because a provider 502 at 06:45 would otherwise mean no
morning bulletin at all. The hour itself retries a failed early recording;
re-rendering at :15 and :45 turns anything still failing into a delay, and
puts on air a recording whose hour passed while the worker was down.
"""

from __future__ import annotations

from app.core.logging import get_logger
from app.db.session import session_scope
from app.models.enums import BulletinStatus
from app.services import bulletin_service
from app.workers.celery_app import celery

logger = get_logger(__name__)

#: Stop re-rendering a slot that keeps failing. Three attempts across the
#: retry windows is enough to ride out a provider blip; more than that is a
#: configuration problem a person has to look at.
MAX_ATTEMPTS = 3


@celery.task(name="bulletin.prepare")
def prepare() -> dict[str, object]:
    with session_scope() as db:
        bulletin = bulletin_service.prepare_slot(db)
        if bulletin is None:
            return {"prepared": 0, "reason": "disabled or no slot due"}
        return {"prepared": 1, "slot": bulletin.slot, "status": bulletin.status.value}


@celery.task(name="bulletin.run_slot")
def run_slot() -> dict[str, object]:
    with session_scope() as db:
        bulletin = bulletin_service.run_slot(db)
        if bulletin is None:
            return {"produced": 0, "reason": "disabled or no slot due"}
        return {
            "produced": 1,
            "slot": bulletin.slot,
            "status": bulletin.status.value,
            "seconds": bulletin.duration_sec,
        }


@celery.task(name="bulletin.retry")
def retry() -> dict[str, int]:
    """Re-render today's failed or un-rendered slots, and air what is due."""
    retried = 0
    with session_scope() as db:
        if not bulletin_service.enabled(db):
            return {"retried": 0}
        for bulletin in bulletin_service.for_day(db, bulletin_service.today()):
            if (
                bulletin.status in (BulletinStatus.FAILED, BulletinStatus.SCRIPTED)
                and bulletin.attempts < MAX_ATTEMPTS
            ):
                bulletin_service.render(db, bulletin, requested_by=bulletin.requested_by)
                retried += 1
            # One that was live — a hand edit or a failed render — goes back on,
            # as it always did: `publish` stamps `published_at`, edits and
            # renders keep it, and only Pull (or the assistant claiming the
            # row) clears it. One the schedule recorded goes on during its own
            # catch-up window (`current_slot`): never early, never hours stale
            # after a worker outage or the kill switch. A bulletin a person
            # prepared that has never been on air (the assistant's) stays
            # READY for a desk editor.
            if bulletin.status == BulletinStatus.READY and (
                bulletin.published_at is not None
                or (
                    bulletin_service.awaiting_air(bulletin)
                    and bulletin.slot == bulletin_service.current_slot()
                )
            ):
                bulletin_service.publish(db, bulletin)
    return {"retried": retried}
