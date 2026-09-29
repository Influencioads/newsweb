"""Push delivery.

A beat tick rather than `.delay` from the API: `get_db` commits after the
handler returns, so a task enqueued from the request could run before the
campaign row it is meant to send exists. The tick also releases scheduled
campaigns, and `push.enabled` is read inside `dispatch_due`, so switching push
off takes effect without a deploy.
"""

from __future__ import annotations

from app.db.session import session_scope
from app.services import notification_service
from app.workers.celery_app import celery


@celery.task(name="notify.dispatch")
def dispatch() -> dict[str, int]:
    with session_scope() as db:
        return notification_service.dispatch_due(db)
