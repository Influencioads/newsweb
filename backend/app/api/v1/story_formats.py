"""One story, four formats.

    GET /public/articles/{short_id}/formats
    GET /public/articles/{short_id}/card.png

Every story is an article. Most can be listened to. Most can be shared as a
card. Some have a video. The client asks once and is told which of the four
exist, so it can render exactly those and nothing else.

**A missing video renders nothing** — no placeholder, no "coming soon". That
was the product decision, and it is why `video` reports `available: false`
rather than being omitted: an explicitly absent format is easier to reason
about on the client than a key that sometimes is not there.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.audio import _payload as audio_payload
from app.core.errors import NotFoundError
from app.db.session import get_db
from app.models.content import Article
from app.models.enums import ArticleStatus
from app.models.video import Video
from app.services import share_card_service, tts_service

router = APIRouter(tags=["public"])


def _published(db: Session, short_id: str) -> Article:
    article = db.scalar(
        select(Article).where(
            Article.short_id == short_id,
            Article.status == ArticleStatus.PUBLISHED,
            Article.deleted_at.is_(None),
        )
    )
    if article is None:
        raise NotFoundError()
    return article


def video_for(db: Session, article: Article) -> Video | None:
    """The story's video, if it has one and it is live."""
    if not article.video_id:
        return None
    video = db.get(Video, article.video_id)
    if video is None or not video.is_published or video.deleted_at is not None:
        return None
    return video


@router.get("/public/articles/{short_id}/formats")
def story_formats(short_id: str, response: Response, db: Session = Depends(get_db)):
    article = _published(db, short_id)
    response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
    response.headers["CDN-Cache-Control"] = "public, s-maxage=120"

    # Reuses the article-audio payload verbatim rather than describing audio a
    # second time — one shape, one place it can be wrong.
    audio = audio_payload(article, tts_service.existing_ready(db, article))

    video = video_for(db, article)
    card_url = share_card_service.ensure_card(db, article)

    return {
        "short_id": article.short_id,
        "url": article.url_path,
        "title_te": article.title_te,
        "article": {"available": True, "url": article.url_path},
        "audio": audio,
        "card": {
            "available": bool(card_url),
            "url": f"/api/v1/public/articles/{article.short_id}/card.png"
            if card_url
            else None,
        },
        "video": {
            "available": video is not None,
            "url": video.watch_url if video else None,
            "embed_url": video.embed_url if video else None,
            "thumbnail_url": video.thumbnail_url if video else None,
            "duration_sec": video.duration_sec if video else 0,
        },
    }


@router.get("/public/articles/{short_id}/card.png")
def share_card(short_id: str, db: Session = Depends(get_db)):
    """Redirect to the stored card, mirroring how the e-paper serves its PDF.

    404 rather than 500 when cards are unavailable on this host — a reader
    sharing text and a link is the documented fallback, not an error.
    """
    article = _published(db, short_id)
    url = share_card_service.ensure_card(db, article)
    if not url:
        raise NotFoundError()
    return RedirectResponse(url, status_code=307)
