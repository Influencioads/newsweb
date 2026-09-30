"""Reader analytics (§25): what `/cms/analytics` shows and what Sanjaya reads.

One function so the dashboard and the assistant cannot drift into two answers
to "how many people read us this week". It also fixes three things the route
used to get wrong: a deleted or unpublished story could top the "most read"
list, the category and district rankings counted reads of those same stories,
and `comments_total` counted seeded, hidden and deleted comments alongside
real ones (the model itself says analytics must not).

Windows are rolling from now, in UTC — the same basis as `reading_sessions`
(`updated_at`), so "7 days" means the last 168 hours, not seven calendar days.
DAU/WAU/MAU count distinct `viewer_key`s: signed-in users *plus* anonymous
devices, not people.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.content import Article, Category
from app.models.engagement import Bookmark, Comment, Follow, Like, ReadingSession
from app.models.enums import ArticleStatus, CommentStatus, RoleKey
from app.models.geo import District
from app.models.site import SearchQuery
from app.models.user import Role, UserRole

#: Only live stories rank: a story taken down must not stay "most read".
_LIVE = (Article.deleted_at.is_(None), Article.status == ArticleStatus.PUBLISHED)

#: A search term is shown only once this many searches used it.
_MIN_SEARCHES = 3


def audience(db: Session, *, days: int = 7) -> dict[str, Any]:
    now = utcnow()
    since = now - timedelta(days=days)

    def viewers(start) -> int:
        return int(
            db.scalar(
                select(func.count(distinct(ReadingSession.viewer_key))).where(
                    ReadingSession.updated_at >= start
                )
            )
            or 0
        )

    reads, avg_seconds, avg_scroll = db.execute(
        select(
            func.count(ReadingSession.id),
            func.coalesce(func.avg(ReadingSession.seconds), 0),
            func.coalesce(func.avg(ReadingSession.max_scroll_pct), 0),
        ).where(ReadingSession.updated_at >= since)
    ).one()

    n_reads = func.count(ReadingSession.id)
    top_articles = db.execute(
        select(Article.id, Article.short_id, Article.title_te, n_reads)
        .join(ReadingSession, ReadingSession.article_id == Article.id)
        .where(ReadingSession.updated_at >= since, *_LIVE)
        .group_by(Article.id, Article.short_id, Article.title_te)
        .order_by(n_reads.desc())
        .limit(10)
    ).all()

    def top_by(model, fk) -> list[dict[str, Any]]:
        rows = db.execute(
            select(model.name_te, model.name_en, model.slug, n_reads)
            .join(Article, fk == model.id)
            .join(ReadingSession, ReadingSession.article_id == Article.id)
            .where(ReadingSession.updated_at >= since, *_LIVE)
            .group_by(model.id, model.name_te, model.name_en, model.slug)
            .order_by(n_reads.desc())
            .limit(8)
        ).all()
        return [
            {"name_te": te, "name_en": en, "slug": slug, "reads": int(n)}
            for te, en, slug, n in rows
        ]

    # `normalized` is still the reader's own text (lower-cased), so a term
    # only ranks once it was searched at least _MIN_SEARCHES times, and
    # anything carrying a phone-length run of digits never does: one reader's
    # "ramesh 9876543210" must not reach the dashboard or the model.
    n_searches = func.count(SearchQuery.id)
    top_searches = [
        (q, n)
        for q, n in db.execute(
            select(SearchQuery.normalized, n_searches)
            .where(SearchQuery.created_at >= since, SearchQuery.normalized != "")
            .group_by(SearchQuery.normalized)
            .having(n_searches >= _MIN_SEARCHES)
            .order_by(n_searches.desc())
            .limit(20)
        )
        if sum(ch.isdigit() for ch in q) < 7
    ][:10]

    def count(stmt) -> int:
        return int(db.scalar(stmt) or 0)

    return {
        "days": days,
        "dau": viewers(now - timedelta(days=1)),
        "wau": viewers(now - timedelta(days=7)),
        "mau": viewers(now - timedelta(days=30)),
        "reads": int(reads or 0),
        "avg_read_seconds": round(float(avg_seconds or 0), 1),
        "avg_scroll_pct": round(float(avg_scroll or 0), 1),
        "registered_readers": count(
            select(func.count(distinct(UserRole.user_id)))
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.key == RoleKey.SUBSCRIBER.value)
        ),
        "likes_total": count(select(func.count()).select_from(Like)),
        "bookmarks_total": count(select(func.count()).select_from(Bookmark)),
        "comments_total": count(
            select(func.count(Comment.id)).where(
                Comment.is_seeded.is_(False), Comment.status == CommentStatus.VISIBLE
            )
        ),
        "follows_total": count(select(func.count()).select_from(Follow)),
        "top_articles": [
            {"id": i, "short_id": s, "title_te": t, "reads": int(n)}
            for i, s, t, n in top_articles
        ],
        "top_categories": top_by(Category, Article.category_id),
        "top_districts": top_by(District, Article.district_id),
        "top_searches": [{"query": q, "count": int(n)} for q, n in top_searches],
        "generated_at": now,
    }
