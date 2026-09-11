"""CMS discovery surface: pins (§9, §19), the trending view (§19), and the
analytics dashboard (§25)."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_permission
from app.core.errors import NotFoundError, ValidationError
from app.core.redis_client import cache_delete_prefix
from app.db.base import utcnow
from app.db.session import get_db
from app.models.content import Article, Category
from app.models.discovery import Pin
from app.models.engagement import Bookmark, Comment, Follow, Like, ReadingSession
from app.models.enums import AuditAction, PinPlacement, RoleKey, TrendingScope
from app.models.geo import District
from app.models.site import SearchQuery
from app.models.user import Role, UserRole
from app.repositories import discovery_repo
from app.services import audit_service, trending_service

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
    _p: Principal = Depends(require_permission("article.publish")),
) -> dict:
    rows = discovery_repo.all_pins(db, include_expired=include_expired)
    return {"items": [_pin_row(p) for p in rows], "total": len(rows)}


@router.post("/pins", status_code=201)
def create_pin(
    payload: PinIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("article.publish")),
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
    p: Principal = Depends(require_permission("article.publish")),
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
    _p: Principal = Depends(require_permission("article.publish")),
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
    now = utcnow()
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    def distinct_viewers(since) -> int:
        return int(
            db.execute(
                select(func.count(distinct(ReadingSession.viewer_key))).where(
                    ReadingSession.updated_at >= since
                )
            ).scalar()
            or 0
        )

    sessions_7d = db.execute(
        select(
            func.count(ReadingSession.id),
            func.avg(ReadingSession.seconds),
            func.avg(ReadingSession.max_scroll_pct),
        ).where(ReadingSession.updated_at >= week_ago)
    ).one()

    top_articles = db.execute(
        select(
            Article.title_te,
            Article.short_id,
            func.count(ReadingSession.id).label("reads"),
        )
        .join(ReadingSession, ReadingSession.article_id == Article.id)
        .where(ReadingSession.updated_at >= week_ago)
        .group_by(Article.id)
        .order_by(func.count(ReadingSession.id).desc())
        .limit(10)
    ).all()

    top_categories = db.execute(
        select(
            Category.name_te,
            Category.slug,
            func.count(ReadingSession.id).label("reads"),
        )
        .join(Article, Article.category_id == Category.id)
        .join(ReadingSession, ReadingSession.article_id == Article.id)
        .where(ReadingSession.updated_at >= week_ago)
        .group_by(Category.id)
        .order_by(func.count(ReadingSession.id).desc())
        .limit(8)
    ).all()

    top_districts = db.execute(
        select(
            District.name_te,
            District.slug,
            func.count(ReadingSession.id).label("reads"),
        )
        .join(Article, Article.district_id == District.id)
        .join(ReadingSession, ReadingSession.article_id == Article.id)
        .where(ReadingSession.updated_at >= week_ago)
        .group_by(District.id)
        .order_by(func.count(ReadingSession.id).desc())
        .limit(8)
    ).all()

    top_searches = db.execute(
        select(SearchQuery.normalized, func.count(SearchQuery.id).label("n"))
        .where(SearchQuery.created_at >= week_ago)
        .group_by(SearchQuery.normalized)
        .order_by(func.count(SearchQuery.id).desc())
        .limit(10)
    ).all()

    readers = int(
        db.execute(
            select(func.count(distinct(UserRole.user_id)))
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.key == RoleKey.SUBSCRIBER.value)
        ).scalar()
        or 0
    )

    def table_count(model) -> int:
        return int(db.execute(select(func.count()).select_from(model)).scalar() or 0)

    return {
        "dau": distinct_viewers(day_ago),
        "wau": distinct_viewers(week_ago),
        "mau": distinct_viewers(month_ago),
        "reads_7d": int(sessions_7d[0] or 0),
        "avg_read_seconds_7d": round(float(sessions_7d[1] or 0), 1),
        "avg_scroll_pct_7d": round(float(sessions_7d[2] or 0), 1),
        "registered_readers": readers,
        "likes_total": table_count(Like),
        "bookmarks_total": table_count(Bookmark),
        "comments_total": table_count(Comment),
        "follows_total": table_count(Follow),
        "top_articles_7d": [
            {"title_te": t, "short_id": s, "reads": int(n)} for t, s, n in top_articles
        ],
        "top_categories_7d": [
            {"name_te": t, "slug": s, "reads": int(n)} for t, s, n in top_categories
        ],
        "top_districts_7d": [
            {"name_te": t, "slug": s, "reads": int(n)} for t, s, n in top_districts
        ],
        "top_searches_7d": [{"query": q, "count": int(n)} for q, n in top_searches],
        "generated_at": now,
    }
