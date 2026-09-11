"""Deleting identity documents when their retention window closes.

This task is the difference between "we check contributors' identity" and "we
keep a folder of strangers' passport scans indefinitely". Rejected applications
lose their files after 90 days; approved ones lose them when the verification
expires, and the contributor re-verifies.

Purpose limitation under the DPDP Act is the legal framing. The practical one
is simpler: data nobody deleted is data somebody will eventually leak.
"""

from __future__ import annotations

from app.core.logging import get_logger
from app.db.session import session_scope
from app.services import kyc_service
from app.workers.celery_app import celery

logger = get_logger(__name__)


@celery.task(name="kyc.purge")
def purge() -> dict[str, int]:
    with session_scope() as db:
        purged = kyc_service.purge_expired(db)
    return {"purged": purged}
