"""Voice administration — the list, the retry, and the backfill.

    GET  /cms/audio/assets        — every rendition, with why the failed ones failed
    POST /cms/audio/assets/{id}/retry
    POST /cms/audio/backfill      — generate for a batch of published stories

Per-article control deliberately lives elsewhere: the `voice_enabled` toggle
and the "generate now" button sit in the article editor under `article.edit`,
because whether a story gets read aloud is a property of the story, like
`is_featured`, and belongs to whoever owns it.

What needs `voice.manage` is the spending: a backfill can call a provider
hundreds of times, and a retry is a deliberate decision to pay again for
something that already failed once.

The backfill runs **inline and bounded**. A queued job would be tidier, but
the button has to work on a deployment where the broker is down, and fifty
syntheses is a few seconds. The long tail is the nightly `voice.backfill`
task, which stops at 90% of the monthly budget so it can never starve a
manual generate during the news day.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_permission
from app.core.errors import NotFoundError
from app.db.session import get_db
from app.models.audio import AudioAsset
from app.models.content import Article
from app.models.enums import ArticleStatus, AudioStatus, AuditAction
from app.services import audit_service, tts_service

router = APIRouter(prefix="/cms", tags=["voice"])

#: One request must not be able to start hundreds of provider calls.
MAX_BACKFILL = 50


def _asset_row(asset: AudioAsset, article: Article | None) -> dict:
    return {
        "id": asset.id,
        "article_id": asset.article_id,
        "short_id": article.short_id if article else None,
        "title_te": article.title_te if article else None,
        "status": asset.status,
        "provider": asset.provider,
        "voice": asset.voice,
        "language": asset.language,
        "duration_sec": asset.duration_sec,
        "char_count": asset.char_count,
        "bytes": asset.bytes,
        # Above 1 means the copy was long enough to need several provider calls
        # and was joined back together. Normal, not a fault.
        "segment_count": asset.segment_count,
        "error": asset.error,
        "generated_at": asset.generated_at,
        "url": asset.url,
    }


@router.get("/audio/assets")
def list_assets(
    status: AudioStatus | None = None,
    provider: str | None = None,
    q: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("voice.manage")),
):
    stmt = select(AudioAsset, Article).join(
        Article, AudioAsset.article_id == Article.id
    )
    if status is not None:
        stmt = stmt.where(AudioAsset.status == status)
    if provider:
        stmt = stmt.where(AudioAsset.provider == provider)
    if q:
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(Article.title_te.like(needle), Article.short_id.like(needle))
        )

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.execute(
        stmt.order_by(AudioAsset.created_at.desc()).offset(offset).limit(limit)
    ).all()
    return {
        "items": [_asset_row(asset, article) for asset, article in rows],
        "total": total,
        "usage": tts_service.usage_summary(db),
    }


@router.post("/audio/assets/{asset_id}/retry")
def retry_asset(
    asset_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("voice.manage")),
):
    """Re-synthesise one rendition.

    `force=True` because a FAILED row is deliberately never retried on its own
    — otherwise every page view would pay again for the same failure.
    """
    asset = db.get(AudioAsset, asset_id)
    if asset is None:
        raise NotFoundError()
    article = db.get(Article, asset.article_id)
    if article is None:
        raise NotFoundError()

    result = tts_service.ensure_audio(db, article, requested_by=p.id, force=True)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="audio_asset",
        entity_id=asset.id,
        actor=p.user,
        after={"status": result.status if result else "unavailable"},
        request=request,
    )
    db.refresh(asset)
    return {
        "asset": _asset_row(result or asset, article),
        "usage": tts_service.usage_summary(db),
    }


class BackfillIn(BaseModel):
    """Which published stories to generate audio for."""

    scope: str = Field(default="missing", pattern=r"^(missing|failed|category|district)$")
    category_id: int | None = None
    district_id: int | None = None
    since_days: int = Field(default=7, ge=1, le=90)
    limit: int = Field(default=20, ge=1, le=MAX_BACKFILL)
    force: bool = False


@router.post("/audio/backfill")
def backfill(
    payload: BackfillIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("voice.manage")),
):
    from datetime import timedelta

    from app.db.base import utcnow

    since = utcnow() - timedelta(days=payload.since_days)
    stmt = (
        select(Article)
        .where(
            Article.status == ArticleStatus.PUBLISHED,
            Article.deleted_at.is_(None),
            Article.voice_enabled.is_(True),
            Article.published_at >= since,
        )
        .order_by(Article.published_at.desc())
    )
    if payload.scope == "missing":
        stmt = stmt.where(Article.audio_asset_id.is_(None))
    elif payload.scope == "failed":
        stmt = stmt.join(AudioAsset, AudioAsset.article_id == Article.id).where(
            AudioAsset.status == AudioStatus.FAILED
        )
    elif payload.scope == "category" and payload.category_id:
        stmt = stmt.where(Article.category_id == payload.category_id)
    elif payload.scope == "district" and payload.district_id:
        stmt = stmt.where(Article.district_id == payload.district_id)

    articles = list(db.scalars(stmt.limit(min(payload.limit, MAX_BACKFILL))).all())

    generated = skipped = 0
    for article in articles:
        asset = tts_service.ensure_audio(
            db, article, requested_by=p.id, force=payload.force
        )
        if asset is not None:
            generated += 1
        else:
            # None covers every "not possible" case — switched off, budget
            # exhausted, provider down. The caller sees the counts and the
            # usage block explains which.
            skipped += 1

    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="audio_backfill",
        entity_id=payload.scope,
        actor=p.user,
        after={"candidates": len(articles), "generated": generated},
        request=request,
    )
    return {
        "candidates": len(articles),
        "generated": generated,
        "skipped": skipped,
        "usage": tts_service.usage_summary(db),
    }
