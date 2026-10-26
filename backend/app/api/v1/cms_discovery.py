"""CMS discovery surface: pins (§9, §19), the trending view (§19), and the
analytics dashboard (§25)."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.deps import Principal, require_permission
from app.core.permissions import LEVEL_PIN_PLACEMENT
from app.core.errors import NotFoundError, ValidationError
from app.core.redis_client import cache_delete_prefix
from app.db.base import utcnow
from app.db.session import get_db
from app.models.content import Article, Category
from app.models.discovery import Pin
from app.models.enums import AuditAction, MediaType, PinPlacement, TrendingScope
from app.models.geo import District
from app.models.media import Media, ShortNewsCard
from app.repositories import article_repo, discovery_repo
from app.services.media_service import STUDIO_ONLY
from app.services import analytics_service, audit_service, trending_service

router = APIRouter(prefix="/cms", tags=["cms-discovery"])


def _purge_feeds() -> None:
    cache_delete_prefix("home:")
    cache_delete_prefix("trending:")


# --------------------------------------------------------------------------- #
# pins (§9)
# --------------------------------------------------------------------------- #
#: §8 presets. Minutes, not hours: pinning a story to the top of the home page
#: for five minutes while it develops is the actual newsroom use, and the old
#: 1h floor made that impossible.
PIN_PRESETS_MINUTES = (5, 10, 15, 30, 60, 180, 360, 720, 1440, 4320)


class PinIn(BaseModel):
    article_id: int
    placement: PinPlacement = PinPlacement.HOME
    category_slug: str | None = None
    district_slug: str | None = None
    duration_minutes: int = Field(
        default=1440,
        gt=0,
        le=60 * 24 * 7,
        description="§8 presets: 5/10/15/30/60/180/360/720/1440/4320 minutes, or any custom value",
    )
    note: str | None = Field(default=None, max_length=200)


def _pin_row(pin: Pin) -> dict:
    return {
        "id": pin.id,
        "article_id": pin.article_id,
        "article_title_te": pin.article.title_te if pin.article else None,
        "article_short_id": pin.article.short_id if pin.article else None,
        "placement": pin.placement,
        "category_id": pin.category_id,
        "district_id": pin.district_id,
        "starts_at": pin.starts_at,
        "ends_at": pin.ends_at,
        "active": pin.starts_at <= utcnow() < pin.ends_at,
        # §8 asks for the remaining time, not just the end timestamp. Computed
        # server-side so a phone with a wrong clock still counts down correctly.
        "seconds_remaining": max(0, int((pin.ends_at - utcnow()).total_seconds())),
        "note": pin.note,
        "created_by": pin.created_by,
    }


@router.get("/pins")
def list_pins(
    include_expired: bool = Query(default=False),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("article.publish", min_level=LEVEL_PIN_PLACEMENT)),
) -> dict:
    rows = discovery_repo.all_pins(db, include_expired=include_expired)
    return {"items": [_pin_row(p) for p in rows], "total": len(rows)}


@router.post("/pins", status_code=201)
def create_pin(
    payload: PinIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("article.publish", min_level=LEVEL_PIN_PLACEMENT)),
) -> dict:
    article = db.get(Article, payload.article_id)
    if article is None:
        raise NotFoundError()

    category_id = district_id = None
    if payload.placement == PinPlacement.CATEGORY:
        category = db.execute(
            select(Category).where(Category.slug == (payload.category_slug or ""))
        ).scalar_one_or_none()
        if category is None:
            raise ValidationError(
                details={"category_slug": "required for a category pin"}
            )
        category_id = category.id
    elif payload.placement == PinPlacement.LOCAL:
        district = db.execute(
            select(District).where(District.slug == (payload.district_slug or ""))
        ).scalar_one_or_none()
        if district is None:
            raise ValidationError(details={"district_slug": "required for a local pin"})
        district_id = district.id

    now = utcnow()
    pin = Pin(
        article_id=article.id,
        placement=payload.placement,
        category_id=category_id,
        district_id=district_id,
        starts_at=now,
        ends_at=now + timedelta(minutes=payload.duration_minutes),
        note=payload.note,
        created_by=p.id,
    )
    db.add(pin)
    db.flush()
    # §9: "maintain an audit log of who pinned/unpinned the story."
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="pin",
        entity_id=pin.id,
        actor=p.user,
        after={
            "article_id": article.id,
            "placement": payload.placement,
            "ends_at": pin.ends_at.isoformat(),
        },
        request=request,
    )
    _purge_feeds()
    return _pin_row(pin)


@router.delete("/pins/{pin_id}")
def unpin(
    pin_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("article.publish", min_level=LEVEL_PIN_PLACEMENT)),
) -> dict:
    pin = db.get(Pin, pin_id)
    if pin is None:
        raise NotFoundError()
    # Unpin = end now, keeping the row for the audit trail (§9).
    pin.ends_at = utcnow()
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="pin",
        entity_id=pin.id,
        actor=p.user,
        note="unpinned",
        request=request,
    )
    _purge_feeds()
    return {"id": pin.id, "ended": True}


# --------------------------------------------------------------------------- #
# short news (§14) — picture cards the desk adds each day
# --------------------------------------------------------------------------- #
#: The two shapes the swipe deck is built for, as width / height.
SHORT_NEWS_SHAPES = {"4:5": 4 / 5, "9:16": 9 / 16}


def short_news_shape(width: int | None, height: int | None) -> str | None:
    """"4:5" / "9:16" within 2 % (resizing rounds a pixel), else None."""
    if not width or not height:
        return None
    ratio = width / height
    return next((k for k, r in SHORT_NEWS_SHAPES.items() if abs(ratio - r) <= r * 0.02), None)


class ShortNewsIn(BaseModel):
    media_id: int
    article_id: int | None = None


def _short_row(card: ShortNewsCard) -> dict:
    m = card.media
    return {
        "id": card.id,
        "media_id": m.id,
        "url": m.cdn_url or f"/media/{m.storage_key}",
        "width": m.width,
        "height": m.height,
        "shape": short_news_shape(m.width, m.height),
        "article_id": card.article_id,
        "article_short_id": card.article.short_id if card.article else None,
        "article_title_te": card.article.title_te if card.article else None,
        "created_at": card.created_at,
    }


@router.get("/short-news")
def list_short_news(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=60, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("article.publish", min_level=LEVEL_PIN_PLACEMENT)),
) -> dict:
    rows = db.execute(
        select(ShortNewsCard)
        .join(ShortNewsCard.media)
        .where(Media.deleted_at.is_(None))
        .options(selectinload(ShortNewsCard.article))
        .order_by(ShortNewsCard.created_at.desc(), ShortNewsCard.id.desc())
        .limit(limit)
        .offset(offset)
    ).scalars()
    total = db.execute(
        select(func.count())
        .select_from(ShortNewsCard)
        .join(ShortNewsCard.media)
        .where(Media.deleted_at.is_(None))
    ).scalar_one()
    return {"items": [_short_row(r) for r in rows], "total": total}


@router.post("/short-news", status_code=201)
def add_short_news(
    payload: ShortNewsIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("article.publish", min_level=LEVEL_PIN_PLACEMENT)),
) -> dict:
    """Put a library image in the Short News swipe. Idempotent per image, so a
    double click or a re-run batch never shows the same card twice, and one
    card per story, so re-making a story's card swaps the picture in place.

    Level 60, as for pins: a level-15 panchayat secretary also holds
    `article.publish`, for their own panchayat's stories, not the app-wide
    swipe. The studio's reference designs and backdrops are refused — the
    library hides them for the same reason: they are never published."""
    media = db.get(Media, payload.media_id)
    if (
        media is None
        or media.deleted_at is not None
        or media.type != MediaType.IMAGE
        or any((media.meta or {}).get(k) for k in STUDIO_ONLY)
    ):
        raise NotFoundError()
    if short_news_shape(media.width, media.height) is None:
        raise ValidationError(
            message_en="Short news takes 4:5 or 9:16 images only.",
            message_te="షార్ట్ న్యూస్‌కు 4:5 లేదా 9:16 చిత్రాలు మాత్రమే.",
            details={"media_id": f"{media.width}x{media.height} is not 4:5 or 9:16"},
        )
    # A card is the story's headline and photo: it goes live only once the
    # story has, or one editor could publish past the approval rule.
    if payload.article_id is not None and db.execute(
        select(Article.id).where(Article.id == payload.article_id, *article_repo.published_filter())
    ).first() is None:
        raise ValidationError(
            message_en="Publish the story first; its card goes live with it.",
            message_te="ముందు కథనాన్ని ప్రచురించండి; దాని కార్డ్ ఆ తర్వాతే.",
            details={"article_id": "not a published story"},
        )

    existing = select(ShortNewsCard).where(ShortNewsCard.media_id == media.id)
    card = db.execute(existing).scalar_one_or_none()
    if card is None and payload.article_id is not None:
        # One card per story: a re-made card (a typo fixed, another size)
        # replaces the story's earlier one where it stands, never a second.
        card = db.execute(
            select(ShortNewsCard).where(ShortNewsCard.article_id == payload.article_id)
        ).scalars().first()
        if card is not None:
            before = card.media_id
            card.media_id = media.id
            db.flush()
            audit_service.record(
                db,
                action=AuditAction.UPDATE,
                entity_type="short_news",
                entity_id=card.id,
                actor=p.user,
                before={"media_id": before},
                after={"media_id": media.id},
                request=request,
            )
    if card is None:
        card = ShortNewsCard(media_id=media.id, article_id=payload.article_id, created_by=p.id)
        try:
            with db.begin_nested():
                db.add(card)
        except IntegrityError:
            # A concurrent request added the same image first (unique media_id).
            # A locking read: REPEATABLE READ's snapshot would not show its row.
            return _short_row(db.execute(existing.with_for_update()).scalar_one())
        audit_service.record(
            db,
            action=AuditAction.CREATE,
            entity_type="short_news",
            entity_id=card.id,
            actor=p.user,
            after={"media_id": media.id, "article_id": payload.article_id},
            request=request,
        )
    db.refresh(card)
    return _short_row(card)


@router.delete("/short-news/{card_id}")
def remove_short_news(
    card_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("article.publish", min_level=LEVEL_PIN_PLACEMENT)),
) -> dict:
    """Off the swipe; the image stays in the media library."""
    card = db.get(ShortNewsCard, card_id)
    if card is None:
        raise NotFoundError()
    audit_service.record(
        db,
        action=AuditAction.DELETE,
        entity_type="short_news",
        entity_id=card.id,
        actor=p.user,
        before={"media_id": card.media_id, "article_id": card.article_id},
        request=request,
    )
    db.delete(card)
    return {"id": card_id, "deleted": True}


# --------------------------------------------------------------------------- #
# trending view (§19)
# --------------------------------------------------------------------------- #
@router.get("/trending")
def trending_scores(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("dashboard.view")),
) -> dict:
    trending_service.ensure_fresh(db)
    rows = discovery_repo.scored_rows(db, scope_type=TrendingScope.GLOBAL, limit=50)
    return {
        "items": [
            {
                "rank": ts.rank,
                "score": ts.score,
                "article_id": a.id,
                "short_id": a.short_id,
                "title_te": a.title_te,
                "view_count": a.view_count,
                "like_count": a.like_count,
                "comment_count": a.comment_count,
                "share_count": a.share_count,
                "is_pinned": discovery_repo.article_is_pinned(db, a.id),
                "computed_at": ts.computed_at,
            }
            for ts, a in rows
        ]
    }


@router.post("/trending/recompute")
def recompute_trending(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("article.publish", min_level=LEVEL_PIN_PLACEMENT)),
) -> dict:
    count = trending_service.compute_trending(db)
    _purge_feeds()
    return {"scored_articles": count}


# --------------------------------------------------------------------------- #
# analytics (§25)
# --------------------------------------------------------------------------- #
@router.get("/analytics")
def analytics(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("analytics.view")),
) -> dict:
    """The §25 screen. The numbers live in `analytics_service` so Sanjaya reads
    the same ones; this keeps the response keys the page was built against."""
    s = analytics_service.audience(db, days=7)
    return {
        "dau": s["dau"],
        "wau": s["wau"],
        "mau": s["mau"],
        "reads_7d": s["reads"],
        "avg_read_seconds_7d": s["avg_read_seconds"],
        "avg_scroll_pct_7d": s["avg_scroll_pct"],
        "registered_readers": s["registered_readers"],
        "likes_total": s["likes_total"],
        "bookmarks_total": s["bookmarks_total"],
        "comments_total": s["comments_total"],
        "follows_total": s["follows_total"],
        "top_articles_7d": [
            {"title_te": r["title_te"], "short_id": r["short_id"], "reads": r["reads"]}
            for r in s["top_articles"]
        ],
        "top_categories_7d": [
            {"name_te": r["name_te"], "slug": r["slug"], "reads": r["reads"]}
            for r in s["top_categories"]
        ],
        "top_districts_7d": [
            {"name_te": r["name_te"], "slug": r["slug"], "reads": r["reads"]}
            for r in s["top_districts"]
        ],
        "top_searches_7d": s["top_searches"],
        "generated_at": s["generated_at"],
    }
