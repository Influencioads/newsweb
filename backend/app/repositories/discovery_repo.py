"""Read paths for trending and pins."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.content import Article
from app.models.discovery import Pin, TrendingScore
from app.models.enums import PinPlacement, TrendingScope
from app.repositories.article_repo import published_query


def trending_articles(
    db: Session,
    *,
    scope_type: TrendingScope = TrendingScope.GLOBAL,
    scope_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
    exclude_ids: set[int] | None = None,
) -> list[Article]:
    stmt = (
        published_query()
        .join(TrendingScore, TrendingScore.article_id == Article.id)
        .where(TrendingScore.scope_type == scope_type)
        .order_by(TrendingScore.score.desc(), Article.published_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if scope_type == TrendingScope.GLOBAL:
        stmt = stmt.where(TrendingScore.scope_id.is_(None))
    else:
        stmt = stmt.where(TrendingScore.scope_id == scope_id)
    if exclude_ids:
        stmt = stmt.where(Article.id.notin_(exclude_ids))
    return list(db.execute(stmt).unique().scalars())


def scored_rows(
    db: Session, *, scope_type: TrendingScope = TrendingScope.GLOBAL, limit: int = 50
) -> list[tuple[TrendingScore, Article]]:
    """CMS view (§19 Trending): scores with their articles, rank order."""
    stmt = (
        select(TrendingScore, Article)
        .join(Article, Article.id == TrendingScore.article_id)
        .where(TrendingScore.scope_type == scope_type)
        .order_by(TrendingScore.rank)
        .limit(limit)
    )
    if scope_type == TrendingScope.GLOBAL:
        stmt = stmt.where(TrendingScore.scope_id.is_(None))
    return [(row[0], row[1]) for row in db.execute(stmt)]


def _active_pin_filter():
    now = utcnow()
    return [Pin.starts_at <= now, Pin.ends_at > now]


def active_pins(
    db: Session,
    *,
    placement: PinPlacement,
    category_id: int | None = None,
    district_id: int | None = None,
    limit: int = 5,
) -> list[Article]:
    """Live pinned articles for a slot. The `ends_at > now` predicate IS the
    §1.3 rule that an expired pin can never hold the top slot."""
    stmt = (
        published_query()
        .join(Pin, Pin.article_id == Article.id)
        .where(Pin.placement == placement, *_active_pin_filter())
        .order_by(Pin.sort, Pin.starts_at.desc())
        .limit(limit)
    )
    if placement == PinPlacement.CATEGORY:
        stmt = stmt.where(Pin.category_id == category_id)
    elif placement == PinPlacement.LOCAL:
        stmt = stmt.where(Pin.district_id == district_id)
    return list(db.execute(stmt).unique().scalars())


def all_pins(db: Session, *, include_expired: bool = False) -> list[Pin]:
    stmt = select(Pin).order_by(Pin.ends_at.desc())
    if not include_expired:
        stmt = stmt.where(Pin.ends_at > utcnow())
    return list(db.execute(stmt).unique().scalars())


def article_is_pinned(db: Session, article_id: int) -> bool:
    stmt = select(Pin.id).where(Pin.article_id == article_id, *_active_pin_filter()).limit(1)
    return db.execute(stmt).scalar_one_or_none() is not None
