"""Trending engine (updated doc §8).

Reads the append-only `article_events` stream (plus visible comments) and folds
it into time-decayed scores:

  * **Unique readers, not raw hits** — every (viewer, event type) pair counts
    once per article, so one reader refreshing all day scores exactly like one
    reader visiting once (§8 "prevent one user repeatedly inflating").
    READ is the exception: seconds accumulate, capped per viewer.
  * **Time decay** — each contribution is weighted by exp(-age/12h), so
    yesterday's blockbuster yields to this morning's story (§8).
  * **Scoped** — the same pass writes global, per-category and per-district
    rows (§8 "separate global trending from category/location trending").
  * **Editor override** is NOT a score boost: editors pin (§9), pins outrank
    trending at render time, and the audit trail stays honest.

Runs lazily: any trending read older than TRENDING_MAX_AGE_SECONDS triggers a
recompute in-request (dev-friendly, no worker needed); production can also
call it from Celery Beat. The whole table is rewritten atomically per run.
"""

from __future__ import annotations

import math
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.db.base import utcnow
from app.models.content import Article
from app.models.discovery import TrendingScore
from app.models.engagement import ArticleEvent, Comment
from app.models.enums import ArticleStatus, CommentStatus, EventType, TrendingScope

logger = get_logger(__name__)

#: Engagement weights (§8: views, unique readers, reading time, shares, likes,
#: comments, bookmarks). Negative feedback subtracts (§3.2).
WEIGHTS: dict[EventType, float] = {
    EventType.VIEW: 1.0,
    EventType.SHARE: 5.0,
    EventType.LIKE: 3.0,
    EventType.BOOKMARK: 4.0,
    EventType.UNLIKE: -3.0,
    EventType.UNBOOKMARK: -4.0,
    EventType.NOT_INTERESTED: -2.0,
}
COMMENT_WEIGHT = 3.0
#: One minute of attention ≈ one extra view; capped so a tab left open all
#: night cannot dominate (per viewer).
READ_SECONDS_PER_POINT = 60.0
READ_POINTS_CAP = 5.0
SCROLL_DEEP_THRESHOLD = 70
SCROLL_DEEP_POINTS = 0.5

WINDOW_HOURS = 48
DECAY_TAU_HOURS = 12.0
MAX_ROWS_PER_SCOPE = 100
TRENDING_MAX_AGE_SECONDS = 300


def _decay(age_hours: float) -> float:
    return math.exp(-max(age_hours, 0.0) / DECAY_TAU_HOURS)


def compute_trending(db: Session) -> int:
    """Rebuild trending_scores from the last WINDOW_HOURS of behaviour.

    Returns the number of scored articles.
    """
    now = utcnow()
    cutoff = now - timedelta(hours=WINDOW_HOURS)

    # Portable across MySQL and SQLite (no CONCAT on the latter). A numeric
    # user id colliding with an equal anon string merely merges two viewers'
    # dedup buckets — harmless for scoring.
    viewer = func.coalesce(ArticleEvent.user_id, ArticleEvent.anon_id)
    rows = db.execute(
        select(
            ArticleEvent.article_id,
            ArticleEvent.event_type,
            viewer.label("viewer"),
            func.max(ArticleEvent.created_at).label("last_at"),
            func.sum(ArticleEvent.value).label("sum_value"),
        )
        .where(ArticleEvent.created_at >= cutoff)
        .group_by(ArticleEvent.article_id, ArticleEvent.event_type, viewer)
    ).all()

    scores: dict[int, float] = {}
    for article_id, event_type, _viewer, last_at, sum_value in rows:
        age_hours = (now - last_at).total_seconds() / 3600 if last_at else 0.0
        factor = _decay(age_hours)
        if event_type == EventType.READ:
            seconds = float(sum_value or 0)
            points = min(seconds / READ_SECONDS_PER_POINT, READ_POINTS_CAP)
        elif event_type == EventType.SCROLL:
            points = (
                SCROLL_DEEP_POINTS if (sum_value or 0) >= SCROLL_DEEP_THRESHOLD else 0.0
            )
        else:
            points = WEIGHTS.get(event_type, 0.0)
        if points:
            scores[article_id] = scores.get(article_id, 0.0) + points * factor

    comment_rows = db.execute(
        select(
            Comment.article_id,
            Comment.user_id,
            func.max(Comment.created_at).label("last_at"),
        )
        .where(Comment.created_at >= cutoff, Comment.status == CommentStatus.VISIBLE)
        .group_by(Comment.article_id, Comment.user_id)
    ).all()
    for article_id, _user_id, last_at in comment_rows:
        age_hours = (now - last_at).total_seconds() / 3600 if last_at else 0.0
        scores[article_id] = scores.get(article_id, 0.0) + COMMENT_WEIGHT * _decay(
            age_hours
        )

    # Only live articles trend; a draft accumulating CMS previews must not.
    articles = {
        a.id: a
        for a in db.execute(
            select(Article).where(
                Article.id.in_(list(scores)) if scores else Article.id.is_(None),
                Article.status == ArticleStatus.PUBLISHED,
                Article.deleted_at.is_(None),
            )
        ).scalars()
    }
    scored = sorted(
        (
            (article_id, s)
            for article_id, s in scores.items()
            if article_id in articles and s > 0
        ),
        key=lambda item: item[1],
        reverse=True,
    )

    db.execute(delete(TrendingScore))

    def write_scope(scope_type: TrendingScope, scope_of) -> None:
        per_scope_rank: dict[int | None, int] = {}
        for article_id, score in scored:
            scope_id = scope_of(articles[article_id])
            if scope_type != TrendingScope.GLOBAL and scope_id is None:
                continue
            rank = per_scope_rank.get(scope_id, 0)
            if rank >= MAX_ROWS_PER_SCOPE:
                continue
            per_scope_rank[scope_id] = rank + 1
            db.add(
                TrendingScore(
                    article_id=article_id,
                    scope_type=scope_type,
                    scope_id=scope_id,
                    score=round(score, 4),
                    rank=rank + 1,
                    computed_at=now,
                )
            )

    write_scope(TrendingScope.GLOBAL, lambda a: None)
    write_scope(TrendingScope.CATEGORY, lambda a: a.category_id)
    write_scope(TrendingScope.DISTRICT, lambda a: a.district_id)

    db.flush()
    logger.info("trending_computed", articles=len(scored))
    return len(scored)


def ensure_fresh(db: Session) -> None:
    """Recompute lazily when the table is stale — every trending read path
    calls this, so trending works with or without a worker process."""
    newest = db.execute(select(func.max(TrendingScore.computed_at))).scalar()
    if newest is None or (utcnow() - newest).total_seconds() > TRENDING_MAX_AGE_SECONDS:
        compute_trending(db)
