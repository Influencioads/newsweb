"""Engagement read paths: bookmarks, history, comments, follows, the
following feed, and the moderation queues."""

from __future__ import annotations

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.content import Article, ArticleTag
from app.models.engagement import Bookmark, Comment, Follow, Like, ReadingSession, Report
from app.models.enums import CommentStatus, FollowTargetType, ReportStatus
from app.repositories.article_repo import published_query


def my_flags(db: Session, *, article_id: int, user_id: int) -> tuple[bool, bool]:
    """(liked, bookmarked) for the signed-in reader — the article page asks
    this separately so the article payload itself stays edge-cacheable."""
    liked = db.get(Like, (article_id, user_id)) is not None
    bookmarked = db.get(Bookmark, (article_id, user_id)) is not None
    return liked, bookmarked


def bookmarked_articles(
    db: Session, *, user_id: int, limit: int = 20, offset: int = 0
) -> list[Article]:
    stmt = (
        published_query()
        .join(Bookmark, Bookmark.article_id == Article.id)
        .where(Bookmark.user_id == user_id)
        .order_by(Bookmark.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db.execute(stmt).unique().scalars())


def reading_history(
    db: Session, *, user_id: int, limit: int = 20, offset: int = 0
) -> list[tuple[Article, ReadingSession]]:
    """Most-recently-read articles with their progress (§11 reading history).

    One row per article (the newest session), so re-reading yesterday's story
    moves it to the top instead of duplicating it.
    """
    latest = (
        select(
            ReadingSession.article_id,
            func.max(ReadingSession.updated_at).label("last_read"),
        )
        .where(ReadingSession.user_id == user_id)
        .group_by(ReadingSession.article_id)
        .subquery()
    )
    stmt = (
        published_query()
        .add_columns(ReadingSession)
        .join(latest, latest.c.article_id == Article.id)
        .join(
            ReadingSession,
            and_(
                ReadingSession.article_id == Article.id,
                ReadingSession.user_id == user_id,
                ReadingSession.updated_at == latest.c.last_read,
            ),
        )
        .order_by(latest.c.last_read.desc())
        .limit(limit)
        .offset(offset)
    )
    return [(row[0], row[1]) for row in db.execute(stmt).unique()]


# --------------------------------------------------------------------------- #
# comments
# --------------------------------------------------------------------------- #
def comments_for_article(
    db: Session, *, article_id: int, limit: int = 50, offset: int = 0
) -> list[Comment]:
    """Top-level VISIBLE comments plus their visible replies, newest thread first."""
    top = (
        select(Comment)
        .where(
            Comment.article_id == article_id,
            Comment.parent_id.is_(None),
            Comment.status == CommentStatus.VISIBLE,
        )
        .order_by(Comment.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    parents = list(db.execute(top).unique().scalars())
    if not parents:
        return []
    replies = (
        select(Comment)
        .where(
            Comment.parent_id.in_([c.id for c in parents]),
            Comment.status == CommentStatus.VISIBLE,
        )
        .order_by(Comment.created_at.asc())
    )
    return parents + list(db.execute(replies).unique().scalars())


def comment_queue(
    db: Session, *, status: CommentStatus | None, limit: int, offset: int
) -> tuple[list[Comment], int]:
    where = [Comment.status == status] if status else []
    stmt = (
        select(Comment).where(*where).order_by(Comment.created_at.desc()).limit(limit).offset(offset)
    )
    total = int(db.execute(select(func.count(Comment.id)).where(*where)).scalar() or 0)
    return list(db.execute(stmt).unique().scalars()), total


def report_queue(
    db: Session, *, status: ReportStatus | None, limit: int, offset: int
) -> tuple[list[Report], int]:
    where = [Report.status == status] if status else []
    stmt = (
        select(Report).where(*where).order_by(Report.created_at.desc()).limit(limit).offset(offset)
    )
    total = int(db.execute(select(func.count(Report.id)).where(*where)).scalar() or 0)
    return list(db.execute(stmt).scalars()), total


# --------------------------------------------------------------------------- #
# follows
# --------------------------------------------------------------------------- #
def follows_for_user(db: Session, *, user_id: int) -> list[Follow]:
    stmt = select(Follow).where(Follow.user_id == user_id).order_by(Follow.created_at.desc())
    return list(db.execute(stmt).scalars())


def following_feed(
    db: Session, *, user_id: int, limit: int = 20, offset: int = 0
) -> list[Article]:
    """Stories from everything the reader follows (§12), newest first.

    One query: the OR of per-type membership predicates. Empty follow list
    returns an empty feed — the UI invites the reader to follow things.
    """
    follows = follows_for_user(db, user_id=user_id)
    if not follows:
        return []

    by_type: dict[FollowTargetType, list[int]] = {}
    for f in follows:
        by_type.setdefault(f.target_type, []).append(f.target_id)

    predicates = []
    if ids := by_type.get(FollowTargetType.CATEGORY):
        predicates.append(Article.category_id.in_(ids))
    if ids := by_type.get(FollowTargetType.DISTRICT):
        predicates.append(Article.district_id.in_(ids))
    if ids := by_type.get(FollowTargetType.MANDAL):
        predicates.append(Article.mandal_id.in_(ids))
    if ids := by_type.get(FollowTargetType.AUTHOR):
        predicates.append(Article.author_id.in_(ids))
    if ids := by_type.get(FollowTargetType.TAG):
        predicates.append(
            Article.id.in_(select(ArticleTag.article_id).where(ArticleTag.tag_id.in_(ids)))
        )

    stmt = (
        published_query()
        .where(or_(*predicates))
        .order_by(Article.published_at.desc(), Article.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db.execute(stmt).unique().scalars())


def count_open_reports(db: Session) -> int:
    return int(
        db.execute(
            select(func.count(Report.id)).where(Report.status == ReportStatus.OPEN)
        ).scalar()
        or 0
    )


def articles_by_ids(db: Session, ids: list[int]) -> dict[int, Article]:
    """Bulk-load articles by id for moderation-queue enrichment. Deliberately
    unfiltered: a story unpublished after being reported must stay visible to
    the moderator handling the report."""
    if not ids:
        return {}
    stmt = select(Article).where(Article.id.in_(ids))
    return {a.id: a for a in db.execute(stmt).unique().scalars()}
