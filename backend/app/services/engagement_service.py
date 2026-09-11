"""Engagement writes: the event beacon, likes, bookmarks, comments, reports,
follows. Reads live in repositories/engagement_repo.py.

Counter policy: articles.like_count / comment_count / share_count are
denormalised and adjusted here inside the same transaction as the state row,
so they can drift only if someone writes the tables by hand.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.models.content import Article, Category, Tag
from app.models.engagement import (
    ArticleEvent,
    Bookmark,
    Comment,
    Follow,
    Like,
    Reaction,
    ReadingSession,
    Report,
)
from app.models.enums import (
    CommentStatus,
    CommentTargetType,
    EventType,
    FollowTargetType,
    ReactionKind,
    ReportStatus,
    ReportTargetType,
)
from app.models.geo import District, Mandal
from app.models.user import User
from app.models.video import Video, VideoChannel

logger = get_logger(__name__)

#: Beacon batches larger than this are truncated — a stuck client retrying an
#: ever-growing queue must not be able to bloat one request into thousands of rows.
MAX_BEACON_EVENTS = 20

#: Event types a beacon may submit. LIKE/BOOKMARK state changes come through
#: their endpoints (which log the event themselves); accepting them raw would
#: let anyone inflate engagement without holding the state.
BEACON_EVENT_TYPES = {
    EventType.VIEW,
    EventType.READ,
    EventType.SCROLL,
    EventType.SHARE,
    EventType.NOT_INTERESTED,
}


def _viewer_key(user_id: int | None, anon_id: str | None) -> str | None:
    if user_id is not None:
        return f"user:{user_id}"
    if anon_id:
        return f"anon:{anon_id[:56]}"
    return None


def _log_event(
    db: Session,
    *,
    article_id: int,
    event_type: EventType,
    user_id: int | None,
    anon_id: str | None = None,
    value: int | None = None,
) -> None:
    db.add(
        ArticleEvent(
            article_id=article_id,
            user_id=user_id,
            anon_id=anon_id[:64] if anon_id else None,
            event_type=event_type,
            value=value,
            created_at=utcnow(),
        )
    )


def ingest_beacon(
    db: Session,
    *,
    events: list[dict],
    user_id: int | None,
    anon_id: str | None,
) -> int:
    """Store a batch of behaviour events (§3.1). Returns the accepted count.

    Deduplication (§8 "prevent one user repeatedly refreshing"): VIEW bumps
    `articles.view_count` only when this viewer's reading-session row for the
    article is created — refreshing all day counts once per day per viewer.
    READ seconds accumulate and SCROLL keeps the maximum on that same row.
    """
    accepted = 0
    now = utcnow()
    today = now.date()
    viewer = _viewer_key(user_id, anon_id)

    # Resolve every short_id in one query.
    short_ids = {str(e.get("short_id", ""))[:12] for e in events if e.get("short_id")}
    if not short_ids:
        return 0
    articles = {
        a.short_id: a
        for a in db.execute(
            select(Article).where(Article.short_id.in_(short_ids))
        ).scalars()
    }

    sessions: dict[int, ReadingSession] = {}

    def session_for(article: Article) -> ReadingSession | None:
        if viewer is None:
            return None
        if article.id in sessions:
            return sessions[article.id]
        row = db.execute(
            select(ReadingSession).where(
                ReadingSession.article_id == article.id,
                ReadingSession.viewer_key == viewer,
                ReadingSession.day == today,
            )
        ).scalar_one_or_none()
        if row is None:
            row = ReadingSession(
                article_id=article.id,
                viewer_key=viewer,
                user_id=user_id,
                day=today,
                seconds=0,
                max_scroll_pct=0,
                created_at=now,
                updated_at=now,
            )
            db.add(row)
            # First sight of this viewer today — the deduplicated view count.
            article.view_count = (article.view_count or 0) + 1
        sessions[article.id] = row
        return row

    for raw in events[:MAX_BEACON_EVENTS]:
        article = articles.get(str(raw.get("short_id", ""))[:12])
        if article is None:
            continue
        try:
            event_type = EventType(str(raw.get("type", "")))
        except ValueError:
            continue
        if event_type not in BEACON_EVENT_TYPES:
            continue

        value = raw.get("value")
        value = int(value) if isinstance(value, (int, float)) else None

        if event_type == EventType.VIEW:
            session_for(article)
        elif event_type == EventType.READ and value and value > 0:
            row = session_for(article)
            if row is not None:
                # A heartbeat can never claim more time than the interval it
                # covers; 120 s caps a tab that slept through many intervals.
                row.seconds += min(value, 120)
                row.updated_at = now
            value = min(value, 120)
        elif event_type == EventType.SCROLL and value is not None:
            row = session_for(article)
            clamped = max(0, min(int(value), 100))
            if row is not None and clamped > row.max_scroll_pct:
                row.max_scroll_pct = clamped
                row.updated_at = now
            value = clamped
        elif event_type == EventType.SHARE:
            article.share_count = (article.share_count or 0) + 1

        _log_event(
            db,
            article_id=article.id,
            event_type=event_type,
            user_id=user_id,
            anon_id=anon_id,
            value=value,
        )
        accepted += 1

    return accepted


# --------------------------------------------------------------------------- #
# likes & bookmarks — idempotent state + counter + event, one transaction
# --------------------------------------------------------------------------- #
def get_live_article(db: Session, short_id: str) -> Article:
    from app.repositories.article_repo import get_by_short_id

    article = get_by_short_id(db, short_id)
    if article is None:
        raise NotFoundError(
            message_en="That article is not available.",
            message_te="ఆ కథనం అందుబాటులో లేదు.",
        )
    return article


def set_like(db: Session, *, short_id: str, user_id: int, liked: bool) -> Article:
    article = get_live_article(db, short_id)
    existing = db.get(Like, (article.id, user_id))
    if liked and existing is None:
        db.add(Like(article_id=article.id, user_id=user_id, created_at=utcnow()))
        article.like_count = (article.like_count or 0) + 1
        _log_event(
            db, article_id=article.id, event_type=EventType.LIKE, user_id=user_id
        )
    elif not liked and existing is not None:
        db.delete(existing)
        article.like_count = max((article.like_count or 0) - 1, 0)
        _log_event(
            db, article_id=article.id, event_type=EventType.UNLIKE, user_id=user_id
        )
    return article


def set_bookmark(
    db: Session, *, short_id: str, user_id: int, bookmarked: bool
) -> Article:
    article = get_live_article(db, short_id)
    existing = db.get(Bookmark, (article.id, user_id))
    if bookmarked and existing is None:
        db.add(Bookmark(article_id=article.id, user_id=user_id, created_at=utcnow()))
        _log_event(
            db, article_id=article.id, event_type=EventType.BOOKMARK, user_id=user_id
        )
    elif not bookmarked and existing is not None:
        db.delete(existing)
        _log_event(
            db, article_id=article.id, event_type=EventType.UNBOOKMARK, user_id=user_id
        )
    return article


# --------------------------------------------------------------------------- #
# comments
# --------------------------------------------------------------------------- #
COMMENT_MAX_LENGTH = 2000


def get_live_video(db: Session, video_id: int) -> Video:
    """A video readers may act on: published and not soft-deleted."""
    video = db.get(Video, video_id)
    if video is None or video.deleted_at is not None or not video.is_published:
        raise NotFoundError()
    return video


def comment_parent(db: Session, target_type: CommentTargetType, target_key: str | int):
    """Resolve whichever thing a comment thread hangs off (§15).

    One function so the API, the counters and the moderation queue all agree on
    what "the parent" means, rather than three places each unpacking the two
    foreign keys their own way.
    """
    if target_type == CommentTargetType.VIDEO:
        return get_live_video(db, int(target_key))
    return get_live_article(db, str(target_key))


def _counter_owner(db: Session, comment: Comment):
    if comment.target_type == CommentTargetType.VIDEO:
        return db.get(Video, comment.video_id) if comment.video_id else None
    return db.get(Article, comment.article_id) if comment.article_id else None


def add_comment(
    db: Session,
    *,
    user_id: int,
    body: str,
    parent_id: int | None,
    short_id: str | None = None,
    video_id: int | None = None,
) -> Comment:
    """Add a comment to an article (`short_id`) or a video (`video_id`)."""
    if (short_id is None) == (video_id is None):
        raise ValidationError(details={"target": "exactly one of short_id or video_id"})

    target_type = (
        CommentTargetType.VIDEO if video_id is not None else CommentTargetType.ARTICLE
    )
    parent_obj = comment_parent(
        db, target_type, video_id if video_id is not None else short_id
    )

    text = body.strip()
    if not text:
        raise ValidationError(details={"body": "empty"})
    if len(text) > COMMENT_MAX_LENGTH:
        raise ValidationError(details={"body": f"over {COMMENT_MAX_LENGTH} characters"})

    own_id_field = (
        "video_id" if target_type == CommentTargetType.VIDEO else "article_id"
    )
    if parent_id is not None:
        parent = db.get(Comment, parent_id)
        if parent is None or getattr(parent, own_id_field) != parent_obj.id:
            raise ValidationError(details={"parent_id": "not a comment on this item"})
        if parent.parent_id is not None:
            # One reply level only — reply to the thread, not to a reply.
            parent_id = parent.parent_id

    comment = Comment(
        target_type=target_type,
        article_id=parent_obj.id if target_type == CommentTargetType.ARTICLE else None,
        video_id=parent_obj.id if target_type == CommentTargetType.VIDEO else None,
        user_id=user_id,
        parent_id=parent_id,
        body=text,
        status=CommentStatus.VISIBLE,
    )
    db.add(comment)
    parent_obj.comment_count = (parent_obj.comment_count or 0) + 1
    db.flush()
    return comment


def delete_own_comment(db: Session, *, comment_id: int, user_id: int) -> None:
    comment = db.get(Comment, comment_id)
    if comment is None or comment.user_id != user_id:
        raise NotFoundError()
    if comment.status == CommentStatus.DELETED:
        return
    was_public = comment.status == CommentStatus.VISIBLE
    comment.status = CommentStatus.DELETED
    if was_public:
        owner = _counter_owner(db, comment)
        if owner is not None:
            owner.comment_count = max((owner.comment_count or 0) - 1, 0)


def moderate_comment(
    db: Session, *, comment_id: int, moderator_id: int, hide: bool
) -> Comment:
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise NotFoundError()
    target = CommentStatus.HIDDEN if hide else CommentStatus.VISIBLE
    if comment.status == target or comment.status == CommentStatus.DELETED:
        return comment
    owner = _counter_owner(db, comment)
    if owner is not None:
        delta = -1 if hide else 1
        owner.comment_count = max((owner.comment_count or 0) + delta, 0)
    comment.status = target
    comment.moderated_by = moderator_id
    return comment


# --------------------------------------------------------------------------- #
# reactions (§15 sentiment bar)
# --------------------------------------------------------------------------- #
def set_reaction(
    db: Session,
    *,
    target_type: CommentTargetType,
    target_key: str | int,
    kind: ReactionKind | None,
    user_id: int | None,
    anon_id: str | None,
) -> dict:
    """Record (or clear) one reader's reaction and return the tallies.

    Anonymous readers count, keyed the same way reading sessions are — a bar
    that only measured signed-in readers would measure sign-ups, not sentiment.
    Changing your mind replaces the row rather than adding one, so the
    percentages describe people.
    """
    viewer = _viewer_key(user_id, anon_id)
    parent_obj = comment_parent(db, target_type, target_key)
    if viewer is None:
        return reaction_summary(
            db, target_type=target_type, target_id=parent_obj.id, viewer=None
        )

    existing = db.scalar(
        select(Reaction).where(
            Reaction.target_type == target_type,
            Reaction.target_id == parent_obj.id,
            Reaction.viewer_key == viewer,
        )
    )
    now = utcnow()
    if kind is None:
        if existing is not None:
            db.delete(existing)
    elif existing is None:
        db.add(
            Reaction(
                target_type=target_type,
                target_id=parent_obj.id,
                viewer_key=viewer,
                user_id=user_id,
                kind=kind,
                created_at=now,
                updated_at=now,
            )
        )
    else:
        existing.kind = kind
        existing.user_id = user_id
        existing.updated_at = now
    db.flush()
    return reaction_summary(
        db, target_type=target_type, target_id=parent_obj.id, viewer=viewer
    )


def reaction_summary(
    db: Session, *, target_type: CommentTargetType, target_id: int, viewer: str | None
) -> dict:
    """Counts and whole-number percentages, plus what this reader chose.

    Percentages are rounded independently and therefore need not total 100 —
    the UI shows them per option, never as a stacked bar, so that is honest
    rather than a rounding bug waiting to be noticed.
    """
    rows = db.execute(
        select(Reaction.kind, func.count(Reaction.id))
        .where(Reaction.target_type == target_type, Reaction.target_id == target_id)
        .group_by(Reaction.kind)
    ).all()
    counts = {kind.value: 0 for kind in ReactionKind}
    for kind, count in rows:
        counts[ReactionKind(kind).value] = int(count)
    total = sum(counts.values())
    mine = None
    if viewer:
        chosen = db.scalar(
            select(Reaction.kind).where(
                Reaction.target_type == target_type,
                Reaction.target_id == target_id,
                Reaction.viewer_key == viewer,
            )
        )
        mine = ReactionKind(chosen).value if chosen else None
    return {
        "total": total,
        "counts": counts,
        "percent": {
            k: (round(v * 100 / total) if total else 0) for k, v in counts.items()
        },
        "mine": mine,
    }


# --------------------------------------------------------------------------- #
# reports
# --------------------------------------------------------------------------- #
REPORT_REASONS = {"spam", "abuse", "misinformation", "copyright", "other"}


def add_report(
    db: Session,
    *,
    target_type: ReportTargetType,
    target_id: int,
    user_id: int | None,
    reason: str,
    note: str | None,
) -> Report:
    if reason not in REPORT_REASONS:
        raise ValidationError(details={"reason": f"one of {sorted(REPORT_REASONS)}"})

    if target_type == ReportTargetType.ARTICLE:
        if db.get(Article, target_id) is None:
            raise NotFoundError()
    else:
        if db.get(Comment, target_id) is None:
            raise NotFoundError()

    # One open report per user per target — repeat taps do not stack the queue.
    if user_id is not None:
        existing = db.execute(
            select(Report).where(
                Report.target_type == target_type,
                Report.target_id == target_id,
                Report.user_id == user_id,
                Report.status == ReportStatus.OPEN,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing

    report = Report(
        target_type=target_type,
        target_id=target_id,
        user_id=user_id,
        reason=reason,
        note=(note or "").strip()[:500] or None,
    )
    db.add(report)
    db.flush()
    return report


def close_report(
    db: Session, *, report_id: int, moderator_id: int, dismiss: bool, note: str | None
) -> Report:
    report = db.get(Report, report_id)
    if report is None:
        raise NotFoundError()
    report.status = ReportStatus.DISMISSED if dismiss else ReportStatus.RESOLVED
    report.resolved_by = moderator_id
    report.resolved_at = utcnow()
    report.resolution_note = (note or "").strip()[:500] or None
    return report


# --------------------------------------------------------------------------- #
# follows
# --------------------------------------------------------------------------- #
def resolve_follow_target(
    db: Session, *, target_type: FollowTargetType, slug: str
) -> tuple[int, str, str]:
    """slug → (id, name_te, name_en); raises NotFoundError for a bad slug."""
    row: object | None
    if target_type == FollowTargetType.CATEGORY:
        row = db.execute(
            select(Category).where(Category.slug == slug, Category.is_active.is_(True))
        ).scalar_one_or_none()
    elif target_type == FollowTargetType.TAG:
        row = db.execute(
            select(Tag).where(Tag.slug == slug, Tag.is_active.is_(True))
        ).scalar_one_or_none()
    elif target_type == FollowTargetType.DISTRICT:
        row = db.execute(
            select(District).where(District.slug == slug, District.is_active.is_(True))
        ).scalar_one_or_none()
    elif target_type == FollowTargetType.MANDAL:
        row = db.execute(
            select(Mandal).where(Mandal.slug == slug, Mandal.is_active.is_(True))
        ).scalar_one_or_none()
    elif target_type == FollowTargetType.CHANNEL:
        # A channel has one name, not a Telugu/English pair — YouTube gives us
        # what the publisher calls itself, and renaming somebody else's
        # newsroom for them would be wrong.
        channel = db.execute(
            select(VideoChannel).where(VideoChannel.youtube_channel_key == slug)
        ).scalar_one_or_none()
        if channel is None:
            raise NotFoundError(
                message_en="Nothing to follow at that address.",
                message_te="ఆ చిరునామాలో ఫాలో చేయదగినది లేదు.",
            )
        return channel.id, channel.name, channel.name
    else:
        row = db.execute(
            select(User).where(
                User.author_slug == slug,
                User.is_author.is_(True),
                User.deleted_at.is_(None),
            )
        ).scalar_one_or_none()

    if row is None:
        raise NotFoundError(
            message_en="Nothing to follow at that address.",
            message_te="ఆ చిరునామాలో ఫాలో చేయదగినది లేదు.",
        )
    return row.id, row.name_te, row.name_en  # type: ignore[union-attr]


def set_follow(
    db: Session,
    *,
    user_id: int,
    target_type: FollowTargetType,
    slug: str,
    following: bool,
) -> bool:
    target_id, _te, _en = resolve_follow_target(db, target_type=target_type, slug=slug)
    existing = db.execute(
        select(Follow).where(
            Follow.user_id == user_id,
            Follow.target_type == target_type,
            Follow.target_id == target_id,
        )
    ).scalar_one_or_none()

    if following and existing is None:
        db.add(
            Follow(
                user_id=user_id,
                target_type=target_type,
                target_id=target_id,
                created_at=utcnow(),
            )
        )
    elif not following and existing is not None:
        db.delete(existing)
    return following
