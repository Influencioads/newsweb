from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_any_permission, require_permission
from app.core.errors import NotFoundError
from app.db.base import utcnow
from app.db.session import get_db
from app.models.audio import AudioAsset
from app.models.content import Article
from app.models.discovery import Pin
from app.models.enums import ArticleType, AuditAction, WorkflowState
from app.models.media import ArticleMedia, Media
from app.models.video import Video
from app.schemas.cms import (
    ArticlePatch,
    ArticleWrite,
    CmsArticleList,
    CmsArticleOut,
    CmsAudioRef,
    CmsMediaRef,
    CmsTagRef,
    CmsVideoRef,
    PlacementIn,
    TransitionIn,
)
from app.services import audit_service, workflow_service

router = APIRouter(prefix="/cms/articles", tags=["articles"])


def _get(db: Session, article_id: int) -> Article:
    article = db.get(Article, article_id)
    if not article or article.deleted_at:
        raise NotFoundError()
    return article


def _media_ref(media: Media) -> CmsMediaRef:
    return CmsMediaRef(id=media.id, url=media.cdn_url or f"/media/{media.storage_key}",
                       alt_te=media.alt_te, credit=media.credit,
                       width=media.width, height=media.height)


#: Column names the response carries. Built from the model rather than
#: `model_validate(article)` because `Article.tags` holds ArticleTag *links*
#: while the response's `tags` holds resolved tag references — validating from
#: attributes would pick up the wrong object for that name.
_COLUMN_FIELDS = tuple(
    c.name for c in Article.__table__.columns if c.name in CmsArticleOut.model_fields
)


def _out(db: Session, article: Article) -> CmsArticleOut:
    """Serialise with the relations the §1 form needs to round-trip.

    A list of 50 would issue 150 queries doing this per row, so `list_articles`
    deliberately does not call it — the list only needs columns.
    """
    payload = CmsArticleOut(**{name: getattr(article, name) for name in _COLUMN_FIELDS})
    if article.hero_media_id:
        hero = db.get(Media, article.hero_media_id)
        if hero is not None:
            payload.hero_media = _media_ref(hero)
    gallery = db.execute(
        select(Media).join(ArticleMedia, ArticleMedia.media_id == Media.id)
        .where(ArticleMedia.article_id == article.id, ArticleMedia.role == "gallery",
               Media.deleted_at.is_(None))
        .order_by(ArticleMedia.sort)
    ).scalars().all()
    payload.gallery = [_media_ref(m) for m in gallery]
    if article.video_id:
        video = db.get(Video, article.video_id)
        if video is not None:
            payload.video = CmsVideoRef(id=video.id, youtube_id=video.youtube_id,
                                        title_te=video.title_te,
                                        thumbnail_url=video.thumbnail_url)
    payload.tags = [
        CmsTagRef(id=link.tag.id, slug=link.tag.slug, name_te=link.tag.name_te,
                  name_en=link.tag.name_en)
        for link in sorted(article.tags, key=lambda x: x.sort) if link.tag
    ]
    if article.audio_asset_id:
        audio = db.get(AudioAsset, article.audio_asset_id)
        if audio is not None:
            payload.audio = CmsAudioRef(
                id=audio.id, url=audio.url, mime=audio.mime,
                duration_sec=audio.duration_sec, provider=audio.provider,
                status=audio.status,
            )
    # §8/§9 — what is actually running, not just what was requested. A pin the
    # editor set an hour ago may already have expired.
    now = utcnow()
    payload.active_pins = [
        {"placement": p.placement, "ends_at": p.ends_at,
         "seconds_remaining": max(0, int((p.ends_at - now).total_seconds()))}
        for p in db.scalars(select(Pin).where(
            Pin.article_id == article.id, Pin.starts_at <= now, Pin.ends_at > now
        ).order_by(Pin.placement)).all()
    ]
    return payload


@router.get("", response_model=CmsArticleList)
def list_articles(state: str | None = None, search: str | None = Query(None, max_length=200),
                  offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
                  db: Session = Depends(get_db),
                  principal: Principal = Depends(require_any_permission("article.view", "article.view_own"))):
    stmt = select(Article).where(Article.deleted_at.is_(None))
    if not principal.is_global:
        stmt = stmt.where(Article.district_id.in_(principal.district_ids))
    if state:
        stmt = stmt.where(Article.workflow_state == state)
    if search:
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(Article.title_te.ilike(term), Article.title_en.ilike(term),
                              Article.short_id.ilike(term)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.execute(stmt.order_by(Article.updated_at.desc()).offset(offset).limit(limit)).scalars())
    return CmsArticleList(articles=rows, total=total)


@router.get("/pending", response_model=CmsArticleList)
def pending_articles(
    article_type: ArticleType | None = None,
    category_id: int | None = None,
    district_id: int | None = None,
    mandal_id: int | None = None,
    author_id: int | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    search: str | None = Query(None, max_length=200),
    offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_any_permission("article.review", "article.view")),
):
    """§7/§25 — one queue for everything awaiting a decision, whatever produced
    it. Desk copy, reader submissions and AI drafts all arrive here, separated
    by `article_type` rather than by living in three different screens."""
    stmt = select(Article).where(
        Article.deleted_at.is_(None),
        Article.workflow_state.in_([WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW]),
    )
    if not principal.is_global:
        stmt = stmt.where(Article.district_id.in_(principal.district_ids))
    if article_type is not None:
        stmt = stmt.where(Article.article_type == article_type)
    for column, value in (("category_id", category_id), ("district_id", district_id),
                          ("mandal_id", mandal_id), ("author_id", author_id)):
        if value is not None:
            stmt = stmt.where(getattr(Article, column) == value)
    if from_date is not None:
        stmt = stmt.where(Article.updated_at >= from_date)
    if to_date is not None:
        stmt = stmt.where(Article.updated_at <= to_date)
    if search:
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(Article.title_te.ilike(term), Article.title_en.ilike(term),
                              Article.short_id.ilike(term)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.execute(
        stmt.order_by(Article.updated_at.asc()).offset(offset).limit(limit)).scalars())
    return CmsArticleList(articles=rows, total=total)


@router.post("", response_model=CmsArticleOut, status_code=201)
def create_article(payload: ArticleWrite, request: Request, db: Session = Depends(get_db),
                   principal: Principal = Depends(require_permission("article.create", scoped=True))):
    article = workflow_service.create(db, principal, payload.model_dump())
    audit_service.record(db, action=AuditAction.CREATE, entity_type="article", entity_id=article.id,
                         actor=principal.user, after={"title_te": article.title_te}, request=request)
    return _out(db, article)


@router.get("/{article_id}", response_model=CmsArticleOut)
def get_article(article_id: int, db: Session = Depends(get_db),
                principal: Principal = Depends(require_any_permission("article.view", "article.view_own"))):
    article = _get(db, article_id)
    workflow_service._scope(principal, article)
    return _out(db, article)


@router.patch("/{article_id}", response_model=CmsArticleOut)
def update_article(article_id: int, payload: ArticlePatch, request: Request,
                   db: Session = Depends(get_db),
                   principal: Principal = Depends(require_any_permission("article.edit", "article.edit_own"))):
    article = workflow_service.update(db, principal, _get(db, article_id), payload.model_dump(exclude_unset=True))
    audit_service.record(db, action=AuditAction.UPDATE, entity_type="article", entity_id=article.id,
                         actor=principal.user, request=request)
    return _out(db, article)


_PERMISSION = {"submit":"article.submit", "review":"article.review", "approve":"article.approve",
               "request-changes":"article.reject", "reject":"article.reject",
               "publish":"article.publish", "unpublish":"article.unpublish"}
_AUDIT = {"submit":AuditAction.SUBMIT, "review":AuditAction.REVIEW_START, "approve":AuditAction.APPROVE,
          "request-changes":AuditAction.REQUEST_CHANGES, "reject":AuditAction.REJECT,
          "publish":AuditAction.PUBLISH, "unpublish":AuditAction.UNPUBLISH}


@router.post("/{article_id}/placement", response_model=CmsArticleOut)
def set_placement(article_id: int, payload: PlacementIn, request: Request,
                  db: Session = Depends(get_db),
                  principal: Principal = Depends(require_permission("article.publish"))):
    """§8 / §9 — "pin to home page" and "show in Top trending" from the article
    form.

    Its own route rather than part of PATCH because a published article cannot
    be edited, and placement is exactly the decision an editor revisits after
    publication. Sending `null` for a slot clears the intent; the pin itself is
    ended through the pin screen, which keeps the unpin audit trail in one
    place.
    """
    article = _get(db, article_id)
    workflow_service._scope(principal, article)

    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(article, key, value)
    applied = workflow_service.apply_placement_pins(db, article, principal.id)

    audit_service.record(db, action=AuditAction.UPDATE, entity_type="article",
                         entity_id=article.id, actor=principal.user,
                         after={**changes, "pins_applied": applied}, request=request)
    if applied:
        from app.core.redis_client import cache_delete_prefix

        cache_delete_prefix("home:")
        cache_delete_prefix("trending:")
    return _out(db, article)


class BreakingControlIn(BaseModel):
    """§9 — extend or end the breaking window, and optionally notify again."""

    minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 7,
                                description="New window from now. Omit to leave it unchanged.")
    clear: bool = False
    repush: bool = Field(default=False, description="Send the breaking notification again")


@router.post("/{article_id}/breaking", response_model=CmsArticleOut)
def breaking_control(article_id: int, payload: BreakingControlIn, request: Request,
                     db: Session = Depends(get_db),
                     principal: Principal = Depends(require_permission("article.breaking"))):
    """The §9 controls the ticker was missing: how long it runs, and a manual
    re-push for a story that developed after the first alert.

    Deliberately gated on `article.breaking` (role level >= 80), the same
    authority needed to set the flag — a re-push reaches every subscribed
    device, so it is not an editing action."""
    from app.db.base import utcnow

    article = _get(db, article_id)
    workflow_service._scope(principal, article)

    if payload.clear:
        article.is_breaking = False
        article.breaking_until = None
    elif payload.minutes is not None:
        article.is_breaking = True
        article.breaking_until = utcnow() + timedelta(minutes=payload.minutes)

    if payload.repush and article.is_breaking:
        from app.services.notification_service import fan_out_for_article

        fan_out_for_article(db, article)

    audit_service.record(db, action=AuditAction.UPDATE, entity_type="article",
                         entity_id=article.id, actor=principal.user,
                         after={"is_breaking": article.is_breaking,
                                "breaking_until": (article.breaking_until.isoformat()
                                                   if article.breaking_until else None),
                                "repush": payload.repush},
                         request=request)
    from app.core.redis_client import cache_delete_prefix

    cache_delete_prefix("home:")
    cache_delete_prefix("breaking")
    return _out(db, article)


@router.post("/{article_id}/{action}", response_model=CmsArticleOut)
def change_state(article_id: int, action: str, payload: TransitionIn, request: Request,
                 db: Session = Depends(get_db), principal: Principal = Depends(require_any_permission(
                     "article.submit", "article.review", "article.approve", "article.reject", "article.publish", "article.unpublish"))):
    if action not in _PERMISSION:
        raise NotFoundError()
    principal.require(_PERMISSION[action])
    article = workflow_service.transition(db, principal, _get(db, article_id), action,
                                          payload.note, payload.scheduled_at)
    scheduled = action == "publish" and article.workflow_state == WorkflowState.SCHEDULED
    audit_service.record(db, action=AuditAction.SCHEDULE if scheduled else _AUDIT[action],
                         entity_type="article", entity_id=article.id,
                         actor=principal.user, note=payload.note, request=request)
    if action in {"publish", "unpublish"} and not scheduled:
        # §10.1: a change in public visibility purges the affected cache keys
        # so readers see it immediately, not after the TTL runs out.
        from app.core.redis_client import cache_delete_prefix

        cache_delete_prefix("home:")
        cache_delete_prefix("breaking")
        cache_delete_prefix("trending:")
    return _out(db, article)
