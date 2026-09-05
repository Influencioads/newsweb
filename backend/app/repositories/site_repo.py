"""Site-configuration read/write paths: homepage sections and the search log."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.site import HomepageSection, SearchQuery


def homepage_sections(db: Session, *, enabled_only: bool = True) -> list[HomepageSection]:
    stmt = select(HomepageSection).order_by(HomepageSection.sort, HomepageSection.id)
    if enabled_only:
        stmt = stmt.where(HomepageSection.is_enabled.is_(True))
    return list(db.execute(stmt).scalars())


def get_section(db: Session, section_id: int) -> HomepageSection | None:
    return db.get(HomepageSection, section_id)


def log_search(db: Session, *, query: str, results_count: int, user_id: int | None) -> None:
    """Fire-and-forget: a failed log write must never fail the search response,
    so callers wrap this in a broad try/except."""
    q = query.strip()[:200]
    db.add(
        SearchQuery(
            query=q,
            normalized=q.lower(),
            user_id=user_id,
            results_count=results_count,
            created_at=utcnow(),
        )
    )


def popular_searches(db: Session, *, days: int = 7, limit: int = 10) -> list[str]:
    """Most-issued queries over the window, only ones that actually found
    something — suggesting a search that returns nothing helps nobody."""
    since = utcnow() - timedelta(days=days)
    stmt = (
        select(SearchQuery.normalized, func.count(SearchQuery.id).label("n"))
        .where(SearchQuery.created_at >= since, SearchQuery.results_count > 0)
        .group_by(SearchQuery.normalized)
        .order_by(func.count(SearchQuery.id).desc())
        .limit(limit)
    )
    return [row[0] for row in db.execute(stmt)]


def recent_searches(db: Session, *, user_id: int, limit: int = 10) -> list[str]:
    """Latest distinct queries for a signed-in reader (updated doc §10)."""
    stmt = (
        select(SearchQuery.normalized, func.max(SearchQuery.created_at).label("last"))
        .where(SearchQuery.user_id == user_id)
        .group_by(SearchQuery.normalized)
        .order_by(func.max(SearchQuery.created_at).desc())
        .limit(limit)
    )
    return [row[0] for row in db.execute(stmt)]
