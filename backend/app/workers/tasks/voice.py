"""Nightly audio backfill.

Runs at 02:20 IST, when nobody is generating by hand, and stops at 90% of the
monthly character budget. The ceiling is the point: a backfill that ran to the
full limit overnight would leave the morning desk unable to generate audio for
the day's lead story, and the failure would look like the feature being broken
rather than the budget being spent.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.base import utcnow
from app.db.session import session_scope
from app.models.content import Article
from app.models.enums import ArticleStatus
from app.services import settings_service, tts_service
from app.workers.celery_app import celery

logger = get_logger(__name__)

#: Leave a tenth of the month's characters for the newsroom to spend by hand.
BUDGET_HEADROOM = 0.9

#: One night's work. The rest is picked up tomorrow.
MAX_PER_RUN = 200


@celery.task(name="voice.backfill")
def backfill() -> dict[str, int]:
    generated = 0
    with session_scope() as db:
        if not (
            settings_service.voice_enabled(db)
            and settings_service.get_bool(db, "voice.backfill_enabled")
        ):
            return {"generated": 0, "skipped": 1}

        budget = settings_service.get_int(db, "voice.monthly_char_budget")
        ceiling = int(budget * BUDGET_HEADROOM) if budget else 0

        articles = db.scalars(
            select(Article)
            .where(
                Article.status == ArticleStatus.PUBLISHED,
                Article.deleted_at.is_(None),
                Article.voice_enabled.is_(True),
                Article.audio_asset_id.is_(None),
                Article.published_at >= utcnow() - timedelta(days=7),
            )
            .order_by(Article.published_at.desc())
            .limit(MAX_PER_RUN)
        ).all()

        for article in articles:
            if ceiling and tts_service.month_chars_used(db) >= ceiling:
                logger.info("voice_backfill_stopped_at_headroom", generated=generated)
                break
            if tts_service.ensure_audio(db, article) is not None:
                generated += 1

    return {"generated": generated, "skipped": 0}


#: Stories older than this get their audio from their first listener instead;
#: the window only bounds what each tick scans.
SWEEP_WINDOW = timedelta(days=2)

#: Renders per tick, so one sweep cannot hold a worker slot past the next.
SWEEP_BATCH = 10


@celery.task(name="voice.publish_sweep")
def publish_sweep() -> dict[str, int]:
    """§20 rule: every published story has its audio attached within a tick.

    A sweep rather than a call inside publish: the editor's click never waits
    on a provider, and the same pass catches scheduled publishes and edits to
    a live story. Each render commits on its own so readers get it at once.
    Known failures are not retried here (`ensure_audio` refuses without
    `force`); the Voice screen's Retry does that.
    """
    generated = 0
    with session_scope() as db:
        if not (
            settings_service.voice_enabled(db)
            and settings_service.get_bool(db, "voice.auto_generate_on_publish")
        ):
            return {"generated": 0}

        articles = db.scalars(
            select(Article)
            .where(
                Article.status == ArticleStatus.PUBLISHED,
                Article.deleted_at.is_(None),
                Article.voice_enabled.is_(True),
                Article.published_at >= utcnow() - SWEEP_WINDOW,
            )
            .order_by(Article.published_at.desc())
        ).all()

        for article in articles:
            if generated >= SWEEP_BATCH:
                break
            if tts_service.existing_ready(db, article) is not None:
                continue
            try:
                if tts_service.ensure_audio(db, article) is not None:
                    generated += 1
                db.commit()
            except Exception:  # noqa: BLE001 — one story must not stall the rest
                db.rollback()
                logger.exception("voice_sweep_failed", article_id=article.id)

    return {"generated": generated}
