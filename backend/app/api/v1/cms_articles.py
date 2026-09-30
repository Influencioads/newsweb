from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import Principal, require_any_permission, require_permission
from app.core.errors import NotFoundError
from app.core.permissions import LEVEL_PIN_PLACEMENT
from app.core.ratelimit import rate_limit
from app.db.base import utcnow
from app.db.session import get_db
from app.models.audio import AudioAsset
from app.models.content import Article, ArticleTag, Category
from app.models.discovery import Pin
from app.models.enums import ArticleStatus, ArticleType, AuditAction, WorkflowState
from app.models.geo import District, Mandal
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
from app.services import audit_service, seed_engagement_service, workflow_service

router = APIRouter(prefix="/cms/articles", tags=["articles"])


def _get(db: Session, article_id: int) -> Article:
    article = db.get(Article, article_id)
    if not article or article.deleted_at:
        raise NotFoundError()
    return article


def _media_ref(media: Media) -> CmsMediaRef:
    meta = media.meta or {}
    open_licence = meta.get("open_licence") or {}
    return CmsMediaRef(
        id=media.id,
        url=media.cdn_url or f"/media/{media.storage_key}",
        alt_te=media.alt_te,
        caption_te=media.caption_te,
        credit=media.credit,
        source_type=media.source_type,
        # Licence plus where it came from. The provider's name is fine here and
        # nowhere else: this response is behind the newsroom login.
        licence=" · ".join(
            p for p in (media.copyright, open_licence.get("source")) if p
        )
        or None,
        width=media.width,
        height=media.height,
        ai_generated=bool(media.ai_generated),
        checked=(meta.get("photo_check") or {}).get("verdict") == "clean",
    )


def _attach_heroes(db: Session, rows: list[Article], out: list[CmsArticleOut]) -> None:
    """The hero on each list row — the studio's thumbnail and the review
    queue's photo badges — in one query for the page, not one per row."""
    hero_ids = {a.hero_media_id for a in rows if a.hero_media_id}
    if not hero_ids:
        return
    heroes = {m.id: m for m in db.scalars(select(Media).where(Media.id.in_(hero_ids)))}
    for article, row in zip(rows, out):
        hero = heroes.get(article.hero_media_id) if article.hero_media_id else None
        if hero is not None and hero.deleted_at is None:
            row.hero_media = _media_ref(hero)


#: Column names the response carries. Built from the model rather than
#: `model_validate(article)` because `Article.tags` holds ArticleTag *links*
#: while the response's `tags` holds resolved tag references — validating from
#: attributes would pick up the wrong object for that name.
_COLUMN_FIELDS = tuple(
    c.name for c in Article.__table__.columns if c.name in CmsArticleOut.model_fields
)


#: Eager-load for the list endpoints: one extra query for the whole page
#: instead of two per row, and it is what makes `_list_row` free of DB access.
_LIST_LOADS = (selectinload(Article.tags).selectinload(ArticleTag.tag),)


def _tag_refs(article: Article) -> list[CmsTagRef]:
    return [
        CmsTagRef(
            id=link.tag.id,
            slug=link.tag.slug,
            name_te=link.tag.name_te,
            name_en=link.tag.name_en,
        )
        for link in sorted(article.tags, key=lambda x: x.sort)
        if link.tag
    ]


def _list_row(article: Article) -> CmsArticleOut:
    """One row of a list response.

    Handing the ORM object straight to `CmsArticleList` looks tempting and is a
    trap: `Article.tags` holds ArticleTag *links*, the schema's `tags` holds
    resolved tag references, and pydantic rejects the link objects — so the
    whole list 500s as soon as any article on the page carries a tag. Columns
    are copied by name for exactly that reason (see `_COLUMN_FIELDS`).
    """
    payload = CmsArticleOut(**{name: getattr(article, name) for name in _COLUMN_FIELDS})
    payload.tags = _tag_refs(article)
    return payload


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
    gallery = (
        db.execute(
            select(Media)
            .join(ArticleMedia, ArticleMedia.media_id == Media.id)
            .where(
                ArticleMedia.article_id == article.id,
                ArticleMedia.role == "gallery",
                Media.deleted_at.is_(None),
            )
            .order_by(ArticleMedia.sort)
        )
        .scalars()
        .all()
    )
    payload.gallery = [_media_ref(m) for m in gallery]
    if article.video_id:
        video = db.get(Video, article.video_id)
        if video is not None:
            payload.video = CmsVideoRef(
                id=video.id,
                youtube_id=video.youtube_id,
                title_te=video.title_te,
                thumbnail_url=video.thumbnail_url,
            )
    payload.tags = _tag_refs(article)
    if article.audio_asset_id:
        audio = db.get(AudioAsset, article.audio_asset_id)
        if audio is not None:
            payload.audio = CmsAudioRef(
                id=audio.id,
                url=audio.url,
                mime=audio.mime,
                duration_sec=audio.duration_sec,
                provider=audio.provider,
                status=audio.status,
            )
    # §8/§9 — what is actually running, not just what was requested. A pin the
    # editor set an hour ago may already have expired.
    now = utcnow()
    payload.active_pins = [
        {
            "placement": p.placement,
            "ends_at": p.ends_at,
            "seconds_remaining": max(0, int((p.ends_at - now).total_seconds())),
        }
        for p in db.scalars(
            select(Pin)
            .where(
                Pin.article_id == article.id, Pin.starts_at <= now, Pin.ends_at > now
            )
            .order_by(Pin.placement)
        ).all()
    ]
    return payload


@router.get("", response_model=CmsArticleList)
def list_articles(
    # Typed as the enum, not a bare string: an unknown value reached the query
    # and came back as a 500 instead of a 422 naming the bad parameter.
    state: WorkflowState | None = None,
    search: str | None = Query(None, max_length=200),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    principal: Principal = Depends(
        require_any_permission("article.view", "article.view_own")
    ),
):
    stmt = select(Article).where(Article.deleted_at.is_(None))
    if not principal.is_global:
        stmt = stmt.where(Article.district_id.in_(principal.district_ids))
    if state:
        stmt = stmt.where(Article.workflow_state == state)
    if search:
        term = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Article.title_te.ilike(term),
                Article.title_en.ilike(term),
                Article.short_id.ilike(term),
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(
        db.execute(
            stmt.options(*_LIST_LOADS)
            .order_by(Article.updated_at.desc())
            .offset(offset)
            .limit(limit)
        ).scalars()
    )
    out = [_list_row(a) for a in rows]
    _attach_heroes(db, rows, out)
    return CmsArticleList(articles=out, total=total)


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
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    principal: Principal = Depends(
        require_any_permission("article.review", "article.view")
    ),
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
    for column, value in (
        ("category_id", category_id),
        ("district_id", district_id),
        ("mandal_id", mandal_id),
        ("author_id", author_id),
    ):
        if value is not None:
            stmt = stmt.where(getattr(Article, column) == value)
    if from_date is not None:
        stmt = stmt.where(Article.updated_at >= from_date)
    if to_date is not None:
        stmt = stmt.where(Article.updated_at <= to_date)
    if search:
        term = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Article.title_te.ilike(term),
                Article.title_en.ilike(term),
                Article.short_id.ilike(term),
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(
        db.execute(
            stmt.options(*_LIST_LOADS)
            .order_by(Article.updated_at.asc())
            .offset(offset)
            .limit(limit)
        ).scalars()
    )
    out = [_list_row(a) for a in rows]
    _attach_heroes(db, rows, out)
    return CmsArticleList(articles=out, total=total)


@router.post("", response_model=CmsArticleOut, status_code=201)
def create_article(
    payload: ArticleWrite,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("article.create", scoped=True)),
):
    article = workflow_service.create(db, principal, payload.model_dump())
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="article",
        entity_id=article.id,
        actor=principal.user,
        after={"title_te": article.title_te},
        request=request,
    )
    return _out(db, article)


@router.get("/{article_id}", response_model=CmsArticleOut)
def get_article(
    article_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(
        require_any_permission("article.view", "article.view_own")
    ),
):
    article = _get(db, article_id)
    workflow_service._scope(principal, article)
    return _out(db, article)


@router.get("/{article_id}/origin")
def article_origin(
    article_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(
        require_any_permission("article.review", "article.view")
    ),
):
    """The publisher's original beside our rewrite, for the person approving it.

    The ingest queue has had this comparison since the rewrite feature shipped,
    but it lives one screen earlier: by the time a story is an article awaiting
    approval, the reviewer sees only our words and has to take "this really is
    a rewrite" on trust. Same two columns, moved to where the decision is made.

    `IngestedRewrite.source_text` is the held copy and is the cheap path. When
    it is absent — the story predates the retention change, or the source is
    excerpt-only and no page was ever fetched — the publisher's page is read
    live and thrown away with the response. Nothing about the original is
    stored by this endpoint; `held=false, fetched_live=true` says which
    happened, because a reviewer comparing against a page that has since been
    edited deserves to know that is what they are reading.
    """
    from app.integrations.feeds.extract import extract_article
    from app.models.ingestion import IngestedItem
    from app.services import crawl_service

    article = _get(db, article_id)
    workflow_service._scope(principal, article)

    item = db.scalar(
        select(IngestedItem)
        .where(IngestedItem.article_id == article.id)
        .options(selectinload(IngestedItem.source))
    )
    if item is None:
        raise NotFoundError(
            message_en="This article did not come from a crawled source.",
        )

    rewrite = item.latest_rewrite
    source = item.source
    target = item.canonical_url or item.url

    held = rewrite.source_text if rewrite is not None else None
    text, fetched_live = held, False
    if not text and target and crawl_service._host_allowed(target):
        page = extract_article(target)
        if page.status == "ok" and page.text:
            text, fetched_live = page.text, True

    return {
        "article_id": article.id,
        "item_id": item.id,
        "source": {
            "name": source.name if source else None,
            "slug": source.slug if source else None,
            "licence": source.licence if source else None,
            "content_policy": source.content_policy if source else None,
            "url": target,
        },
        "original": {
            "title": item.title,
            "summary": item.summary,
            "author": item.author,
            "published_at": item.published_at,
            "image_url": item.image_url,
            "text": text,
            # Which of the three things happened, so the UI can say so rather
            # than showing an empty column that looks like a bug.
            "held": bool(held),
            "fetched_live": fetched_live,
        },
        # What the reader would get if this were published right now — the
        # article as it stands, not the rewrite as the model first wrote it.
        # An editor who has already touched the copy must be comparing their
        # own latest version, or the check is theatre.
        "ours": {
            "title_te": article.title_te,
            "summary_te": article.summary_te,
            "body_plain": article.body_plain,
            "word_count": article.word_count,
            "edited_since_import": bool(
                rewrite is not None and (article.body_plain or "") != (rewrite.body_plain or "")
            ),
        },
        "rewrite": (
            {
                "title_te": rewrite.title_te or None,
                "summary_te": rewrite.summary_te,
                "body_plain": rewrite.body_plain,
                "attribution_te": rewrite.attribution_te or None,
                "similarity_percent": rewrite.similarity_percent,
                "confidence": round(rewrite.confidence, 2),
                "unverified": rewrite.unverified,
                "engine": rewrite.engine,
                "model": rewrite.model,
                "word_count": rewrite.word_count,
                "created_at": rewrite.created_at,
            }
            if rewrite is not None
            else None
        ),
        # Where the AI filed it and which photos it looked at, so the reviewer
        # can see the machine's working. Null for items that predate either.
        "ai": _ai_filing(db, rewrite.classification if rewrite is not None else None),
        "photos": item.photo_check,
    }


def _ai_filing(db: Session, cls: dict | None) -> dict | None:
    """`IngestedRewrite.classification` with its ids turned into names. The
    ids were validated when written; `db.get` still tolerates a row deleted
    since, which simply shows as nothing."""
    if not cls:
        return None

    def named(model, row_id):
        row = db.get(model, row_id) if row_id else None
        return (
            {"id": row.id, "name_te": row.name_te, "name_en": row.name_en}
            if row is not None
            else None
        )

    return {
        "category": named(Category, cls.get("category_id")),
        "subcategory": named(Category, cls.get("subcategory_id")),
        "district": named(District, cls.get("district_id")),
        "mandal": named(Mandal, cls.get("mandal_id")),
        "tags": [
            {"name": t.get("name"), "type": t.get("type")}
            for t in cls.get("tags") or []
        ],
        "breaking": bool(cls.get("breaking")),
        "glyph_warning": bool(cls.get("glyph_warning")),
    }


@router.patch("/{article_id}", response_model=CmsArticleOut)
def update_article(
    article_id: int,
    payload: ArticlePatch,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(
        require_any_permission("article.edit", "article.edit_own")
    ),
):
    article = workflow_service.update(
        db, principal, _get(db, article_id), payload.model_dump(exclude_unset=True)
    )
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="article",
        entity_id=article.id,
        actor=principal.user,
        request=request,
    )
    return _out(db, article)


_PERMISSION = {
    "submit": "article.submit",
    "review": "article.review",
    "approve": "article.approve",
    "request-changes": "article.reject",
    "reject": "article.reject",
    "publish": "article.publish",
    "unpublish": "article.unpublish",
}
_AUDIT = {
    "submit": AuditAction.SUBMIT,
    "review": AuditAction.REVIEW_START,
    "approve": AuditAction.APPROVE,
    "request-changes": AuditAction.REQUEST_CHANGES,
    "reject": AuditAction.REJECT,
    "publish": AuditAction.PUBLISH,
    "unpublish": AuditAction.UNPUBLISH,
}


@router.post("/{article_id}/placement", response_model=CmsArticleOut)
def set_placement(
    article_id: int,
    payload: PlacementIn,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(
        # Deciding what leads the front page for two states is desk
        # seniority, and `article.publish` stopped implying it the moment a
        # level-15 panchayat secretary was given it. The same gate is on
        # `_guard_flags` and on every route in cms_discovery.
        require_permission("article.publish", min_level=LEVEL_PIN_PLACEMENT)
    ),
):
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

    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="article",
        entity_id=article.id,
        actor=principal.user,
        after={**changes, "pins_applied": applied},
        request=request,
    )
    if applied:
        from app.core.redis_client import cache_delete_prefix

        cache_delete_prefix("home:")
        cache_delete_prefix("trending:")
    return _out(db, article)


class BreakingControlIn(BaseModel):
    """§9 — extend or end the breaking window, and optionally notify again."""

    minutes: int | None = Field(
        default=None,
        ge=1,
        le=60 * 24 * 7,
        description="New window from now. Omit to leave it unchanged.",
    )
    clear: bool = False
    repush: bool = Field(
        default=False, description="Send the breaking notification again"
    )


@router.post("/{article_id}/breaking", response_model=CmsArticleOut)
def breaking_control(
    article_id: int,
    payload: BreakingControlIn,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("article.breaking")),
):
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
        # Not yet live (the review queue's "Mark breaking"): a window counted
        # from now would be half spent by publication, so leave it open and
        # let publish apply the configured default from the moment it goes out.
        article.breaking_until = (
            utcnow() + timedelta(minutes=payload.minutes)
            if article.published_at is not None
            else None
        )

    # Only a live story is pushed: marking one breaking while it still awaits
    # review must not alert every reader to copy nobody has approved.
    if payload.repush and article.is_breaking and article.status == ArticleStatus.PUBLISHED:
        from app.services.notification_service import fan_out_for_article

        fan_out_for_article(db, article)

    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="article",
        entity_id=article.id,
        actor=principal.user,
        after={
            "is_breaking": article.is_breaking,
            "breaking_until": (
                article.breaking_until.isoformat() if article.breaking_until else None
            ),
            "repush": payload.repush,
        },
        request=request,
    )
    from app.core.redis_client import cache_delete_prefix

    cache_delete_prefix("home:")
    cache_delete_prefix("breaking")
    return _out(db, article)


class CriticNoteIn(BaseModel):
    """The desk's own note on a story. `null` clears it."""

    note_te: str | None = Field(default=None, max_length=4000)


@router.post("/{article_id}/critic-note", response_model=CmsArticleOut)
def critic_note(
    article_id: int,
    payload: CriticNoteIn,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("article.critic_note")),
):
    """Attach or clear the editorial note shown beside a story.

    Its own route rather than a field on PATCH, because `workflow_service.update`
    refuses any article that is not DRAFT or CHANGES_REQUESTED — and a critic
    note is by definition something you add to a story that is already live.
    `set_placement` exists for the same reason.
    """
    article = _get(db, article_id)
    workflow_service._scope(principal, article)

    note = (payload.note_te or "").strip() or None
    article.critic_note_te = note
    db.flush()

    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="article",
        entity_id=article.id,
        actor=principal.user,
        after={"critic_note_te": note},
        request=request,
    )
    from app.core.redis_client import cache_delete_prefix

    cache_delete_prefix("home:")
    return _out(db, article)


class SeedLikesIn(BaseModel):
    """Set the seeded-like offset. Setting it to 0 un-seeds."""

    count: int = Field(ge=0, le=seed_engagement_service.MAX_SEED_LIKES)


class SeedCommentIn(BaseModel):
    """One seeded comment. The name is an index into a fixed pool, never text —
    see `seed_engagement_service.SEED_NAMES`."""

    body_te: str = Field(min_length=1, max_length=2000)
    name_index: int = Field(ge=0)


@router.post("/{article_id}/seed-likes", response_model=CmsArticleOut)
def seed_likes(
    article_id: int,
    payload: SeedLikesIn,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("engagement.seed")),
):
    """Fabricated engagement, audit-logged. See `seed_engagement_service`."""
    article = _get(db, article_id)
    before = article.seed_like_count
    total = seed_engagement_service.seed_likes(db, article=article, count=payload.count)
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="seeded_like",
        entity_id=article.id,
        actor=principal.user,
        before={"seed_like_count": before},
        after={"seed_like_count": payload.count, "reader_total": total},
        request=request,
    )
    from app.core.redis_client import cache_delete_prefix

    cache_delete_prefix("home:")
    return _out(db, article)


@router.post("/{article_id}/seed-comment", response_model=CmsArticleOut)
def seed_comment(
    article_id: int,
    payload: SeedCommentIn,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("engagement.seed")),
):
    """Fabricated engagement, audit-logged with the exact text and name.

    Separate from seed-likes on purpose: one audit row per action reads better
    in the log than one row describing two different things.
    """
    article = _get(db, article_id)
    comment = seed_engagement_service.seed_comment(
        db, article=article, body=payload.body_te, name_index=payload.name_index
    )
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="seeded_comment",
        entity_id=comment.id,
        actor=principal.user,
        after={
            "article_id": article.id,
            "body": comment.body,
            "seed_author_name": comment.seed_author_name,
        },
        request=request,
    )
    return _out(db, article)


@router.post("/{article_id}/{action}", response_model=CmsArticleOut)
def change_state(
    article_id: int,
    action: str,
    payload: TransitionIn,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(
        require_any_permission(
            "article.submit",
            "article.review",
            "article.approve",
            "article.reject",
            "article.publish",
            "article.unpublish",
        )
    ),
):
    if action not in _PERMISSION:
        raise NotFoundError()
    principal.require(_PERMISSION[action])
    # The panchayat self-publish exception is the only way an account below
    # desk-editor level reaches `publish`, and the only publish with no editor
    # in front of it. Five a minute is generous for one panchayat and cheap
    # enough that a stolen session cannot flood the section. Applied here
    # rather than as a route dependency so no editor's queue is throttled.
    if action == "publish" and principal.level < LEVEL_PIN_PLACEMENT:
        rate_limit("panchayat_publish", 5, fail_closed=True)(request)
    article = workflow_service.transition(
        db, principal, _get(db, article_id), action, payload.note, payload.scheduled_at
    )
    scheduled = (
        action == "publish" and article.workflow_state == WorkflowState.SCHEDULED
    )
    audit_service.record(
        db,
        action=AuditAction.SCHEDULE if scheduled else _AUDIT[action],
        entity_type="article",
        entity_id=article.id,
        actor=principal.user,
        note=payload.note,
        request=request,
    )
    if action in {"publish", "unpublish"} and not scheduled:
        # §10.1: a change in public visibility purges the affected cache keys
        # so readers see it immediately, not after the TTL runs out.
        from app.core.redis_client import cache_delete_prefix

        cache_delete_prefix("home:")
        cache_delete_prefix("breaking")
        cache_delete_prefix("trending:")
    return _out(db, article)
