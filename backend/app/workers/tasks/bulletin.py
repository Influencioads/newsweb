"""The three-hourly audio bulletin tasks.

`crontab(minute=0, hour="6,9,12,15,18,21")` rather than the e-paper's
tick-and-compare idiom, because the six slots are a product decision and not an
admin setting. Celery's timezone is already Asia/Kolkata, so the entry fires on
the IST hour, wakes the worker six times a day instead of 288, and cannot
double-produce because `(bulletin_date, slot)` is unique.

`bulletin.retry` exists because a provider 502 at 06:00 would otherwise mean no
morning bulletin at all. Re-rendering at :15 and :45 turns a transient failure
into a fifteen-minute delay.
"""

from __future__ import annotations

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.session import session_scope
from app.models.bulletin import AudioBulletin
from app.models.enums import BulletinStatus
from app.services import bulletin_service
from app.workers.celery_app import celery

logger = get_logger(__name__)

#: Stop re-rendering a slot that keeps failing. Three attempts across the
#: retry windows is enough to ride out a provider blip; more than that is a
#: configuration problem a person has to look at.
MAX_ATTEMPTS = 3


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
    """Re-render today's failed or un-rendered slots."""
    retried = 0
    with session_scope() as db:
        if not bulletin_service.enabled(db):
            return {"retried": 0}
        rows = db.scalars(
            select(AudioBulletin).where(
                AudioBulletin.bulletin_date == bulletin_service.today(),
                AudioBulletin.status.in_(
                    (BulletinStatus.FAILED, BulletinStatus.SCRIPTED)
                ),
                AudioBulletin.attempts < MAX_ATTEMPTS,
            )
        ).all()
        for bulletin in rows:
            bulletin_service.render(db, bulletin)
            if (
                bulletin.status == BulletinStatus.READY
                and not bulletin_service.requires_approval(db)
            ):
                bulletin_service.publish(db, bulletin)
            retried += 1
    return {"retried": retried}
