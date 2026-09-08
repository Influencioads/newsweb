"""Article audio (updated doc §19–21).

    GET  /public/articles/{short_id}/audio   — what the player should do
    POST /cms/articles/{id}/generate-audio   — force a rendition (article.edit)

The public route is the interesting one: it always answers, and its answer
tells the client which of the two voices to use. `available: false` is a normal
response, not an error — the reader falls back to the device voice, which is
what shipped before this feature existed and still works offline.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_any_permission
from app.core.errors import NotFoundError
from app.db.session import get_db
from app.models.content import Article
from app.models.enums import ArticleStatus, AuditAction
from app.services import audit_service, settings_service, tts_service

router = APIRouter(tags=["audio"])


def _article(db: Session, article_id: int, principal: Principal) -> Article:
    article = db.get(Article, article_id)
    if article is None or article.deleted_at:
        raise NotFoundError()
    principal.assert_scope(district_id=article.district_id, mandal_id=article.mandal_id)
    return article


def _purge_article_caches() -> None:
    """Audio changes what the article endpoint reports, so the cached copy has
    to go — otherwise the player keeps pointing at the old file."""
    from app.core.redis_client import cache_delete_prefix

    cache_delete_prefix("article:")


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


@router.post("/cms/articles/{article_id}/audio", status_code=201)
async def upload_audio(article_id: int, request: Request, file: UploadFile = File(...),
                       duration_sec: int = Form(0),
                       db: Session = Depends(get_db),
                       p: Principal = Depends(require_any_permission("article.edit", "article.edit_own"))):
    """§19 — attach your own audio instead of a synthesised reading.

    For a recorded bulletin, an interview clip, or a presenter reading the
    story properly. It replaces generated audio for this article and, unlike
    generated audio, does not depend on a TTS provider being configured.
    """
    article = _article(db, article_id, p)
    raw = await file.read()
    asset = tts_service.attach_upload(
        db, article, raw=raw, filename=file.filename or "audio",
        mime=file.content_type or "application/octet-stream",
        duration_sec=duration_sec, requested_by=p.id,
    )
    audit_service.record(db, action=AuditAction.MEDIA_UPLOAD, entity_type="audio_asset",
                         entity_id=asset.id, actor=p.user,
                         after={"article_id": article.id, "bytes": asset.bytes,
                                "mime": asset.mime}, request=request)
    _purge_article_caches()
    return _payload(article, asset)


@router.delete("/cms/articles/{article_id}/audio")
def delete_audio(article_id: int, request: Request, db: Session = Depends(get_db),
                 p: Principal = Depends(require_any_permission("article.edit", "article.edit_own"))):
    """Detach the uploaded file. Generated audio, if any, takes over again."""
    article = _article(db, article_id, p)
    removed = tts_service.remove_upload(db, article)
    if removed:
        audit_service.record(db, action=AuditAction.MEDIA_DELETE, entity_type="audio_asset",
                             entity_id=article.id, actor=p.user,
                             after={"article_id": article.id}, request=request)
        _purge_article_caches()
    return {"removed": removed, **_payload(article, tts_service.existing_ready(db, article))}


@router.post("/cms/articles/{article_id}/generate-audio")
def generate_audio(article_id: int, request: Request, force: bool = False,
                   db: Session = Depends(get_db),
                   p: Principal = Depends(require_any_permission("article.edit", "article.edit_own"))):
    article = _article(db, article_id, p)
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
