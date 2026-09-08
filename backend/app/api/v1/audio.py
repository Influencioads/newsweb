"""Article audio (updated doc §19–21).

    GET  /public/articles/{short_id}/audio   — what the player should do
    POST /cms/articles/{id}/generate-audio   — force a rendition (article.edit)

The public route is the interesting one: it always answers, and its answer
tells the client which of the two voices to use. `available: false` is a normal
response, not an error — the reader falls back to the device voice, which is
what shipped before this feature existed and still works offline.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_any_permission
from app.core.errors import NotFoundError
from app.db.session import get_db
from app.models.content import Article
from app.models.enums import ArticleStatus, AuditAction
from app.services import audit_service, settings_service, tts_service

router = APIRouter(tags=["audio"])


def _payload(article: Article, asset) -> dict:
    return {
        "available": asset is not None,
        "url": asset.url if asset else None,
        "mime": asset.mime if asset else None,
        "duration_sec": asset.duration_sec if asset else 0,
        "voice": asset.voice if asset else None,
        "provider": asset.provider if asset else None,
        # The client uses this to decide between the file and device speech.
        "fallback": "device" if asset is None else None,
        "voice_enabled": article.voice_enabled,
    }


@router.get("/public/articles/{short_id}/audio")
def public_audio(short_id: str, response: Response, db: Session = Depends(get_db)):
    article = db.scalar(select(Article).where(
        Article.short_id == short_id, Article.status == ArticleStatus.PUBLISHED,
        Article.deleted_at.is_(None)))
    if article is None:
        raise NotFoundError()

    if not tts_service.is_enabled(db, article):
        # §20: switched off means the player is hidden entirely — not that the
        # reader silently gets the device voice instead.
        return {"available": False, "url": None, "mime": None, "duration_sec": 0,
                "voice": None, "provider": None, "fallback": None,
                "voice_enabled": False}

    asset = tts_service.existing_ready(db, article)
    if asset is None:
        # Generate on first request rather than on publish, unless the admin
        # opted into pre-generation — most stories are never listened to, and
        # §21 is about not paying for those.
        asset = tts_service.ensure_audio(db, article)
    # Cached like any other public read; the URL is content-hashed so a change
    # produces a different one rather than a stale hit.
    response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
    response.headers["CDN-Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=600"
    return _payload(article, asset)


@router.post("/cms/articles/{article_id}/generate-audio")
def generate_audio(article_id: int, request: Request, force: bool = False,
                   db: Session = Depends(get_db),
                   p: Principal = Depends(require_any_permission("article.edit", "article.edit_own"))):
    article = db.get(Article, article_id)
    if article is None or article.deleted_at:
        raise NotFoundError()
    p.assert_scope(district_id=article.district_id, mandal_id=article.mandal_id)

    asset = tts_service.ensure_audio(db, article, requested_by=p.id, force=force)
    audit_service.record(db, action=AuditAction.UPDATE, entity_type="audio_asset",
                         entity_id=(asset.id if asset else "none"), actor=p.user,
                         after={"article_id": article.id,
                                "status": asset.status if asset else "unavailable"},
                         request=request)
    return {
        **_payload(article, asset),
        "global_voice_enabled": settings_service.voice_enabled(db),
        "usage": tts_service.usage_summary(db),
    }
