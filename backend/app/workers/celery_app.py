"""Background jobs for non-blocking editorial automation.

The scheduler only creates reviewable daily drafts. Publication always remains
an explicit editor action. Personalized editions are private to their owner.
"""

from __future__ import annotations

from datetime import datetime

from celery import Celery
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.session import session_scope
from app.models.epaper import (
    EpaperEdition,
    EpaperPage,
    EpaperPageArticle,
    EpaperUserEdition,
)
from app.services import epaper_service, settings_service, tts_service

celery = Celery(
    "telugu_news",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)
celery.conf.update(timezone="Asia/Kolkata", enable_utc=True, task_track_started=True)
celery.conf.beat_schedule = {
    "epaper-scheduler": {"task": "epaper.schedule", "schedule": 300.0},
    "epaper-audio": {"task": "epaper.audio", "schedule": 600.0},
}


@celery.task(name="epaper.schedule")
def schedule_epapers() -> dict[str, int]:
    daily = personal = 0
    now = datetime.now(epaper_service.IST)
    with session_scope() as db:
        configured = str(
            settings_service.get(db, "epaper.auto_generate_time") or "05:00"
        )[:5]
        if (
            settings_service.get_bool(db, "epaper.auto_generate")
            and now.strftime("%H:%M") >= configured
        ):
            edition = epaper_service.generate_daily(db, now.date())
            daily = 1 if edition else 0
        rows = db.scalars(
            select(EpaperUserEdition)
            .options(selectinload(EpaperUserEdition.preferences))
            .where(
                EpaperUserEdition.is_active.is_(True),
                EpaperUserEdition.auto_generate.is_(True),
                EpaperUserEdition.generation_time <= now.time().replace(tzinfo=None),
            )
        ).all()
        if settings_service.get_bool(db, "epaper.personalized_enabled"):
            for saved in rows:
                epaper_service.generate_personal(db, saved, now.date())
                personal += 1
    return {"daily": daily, "personal": personal}


@celery.task(name="epaper.audio")
def generate_epaper_audio() -> dict[str, int]:
    generated = 0
    with session_scope() as db:
        if not settings_service.get_bool(db, "epaper.audio_enabled"):
            return {"generated": 0}
        editions = db.scalars(
            select(EpaperEdition)
            .options(
                selectinload(EpaperEdition.pages)
                .selectinload(EpaperPage.articles)
                .selectinload(EpaperPageArticle.article)
            )
            .where(EpaperEdition.status.in_(("APPROVED", "PUBLISHED")))
        ).all()
        seen: set[int] = set()
        for edition in editions:
            for page in edition.pages:
                for link in page.articles:
                    if link.article_id in seen:
                        continue
                    seen.add(link.article_id)
                    if tts_service.ensure_audio(db, link.article) is not None:
                        generated += 1
    return {"generated": generated}
