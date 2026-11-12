"""Scheduled publishing: a beat tick puts every article whose scheduled time
has passed live (workflow_service.publish_due), then clears the cached pages
so readers see it at once."""

from __future__ import annotations

from app.db.session import session_scope
from app.workers.celery_app import celery


@celery.task(name="articles.publish_due")
def publish_due() -> dict[str, int]:
    from app.services import workflow_service

    with session_scope() as db:
        published = workflow_service.publish_due(db)
    if published:
        from app.core.redis_client import cache_delete_prefix

        for prefix in ("home:", "breaking", "trending:", "article:"):
            cache_delete_prefix(prefix)
    return {"published": len(published)}
