"""Engagement models (updated doc Phase C): the event stream, reading
sessions, likes, bookmarks, comments, reports and follows.

Architecture note (plan §2): `article_events` is the single append-only stream
that trending (§8), analytics (§25) and personalization (§3.2) read — those
features are queries over this table, written once here. `reading_sessions`
is the deduplicating aggregate the stream folds into: one row per
viewer × article × day, which is simultaneously the §8 anti-refresh guard
(view_count increments only when a row is created) and the reader's
"continue reading" history (§11).
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin
from app.db.types import UTCDateTime
from app.models.enums import (
    CommentStatus,
    CommentTargetType,
    EventType,
    FollowTargetType,
    ReactionKind,
    ReportStatus,
    ReportTargetType,
)


class ArticleEvent(PKMixin, Base):
    """Append-only. Never updated, never deleted; analytics jobs aggregate it."""

    __tablename__ = "article_events"
    __table_args__ = (
        Index(
            "ix_article_events_article_id_type_created_at",
            "article_id",
            "event_type",
            "created_at",
        ),
        Index("ix_article_events_user_id_created_at", "user_id", "created_at"),
        Index("ix_article_events_created_at", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Client-generated stable id for anonymous readers (localStorage/device).
    anon_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_type: Mapped[EventType] = mapped_column(
        Enum(EventType, native_enum=False, length=20, validate_strings=True),
        nullable=False,
    )
    value: Mapped[int | None] = mapped_column(
        Integer, nullable=True, doc="READ: seconds · SCROLL: max depth percent"
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)


class ReadingSession(PKMixin, Base):
    """One row per viewer × article × day (see module docstring).

    `viewer_key` is `user:<id>` for signed-in readers and `anon:<anon_id>`
    otherwise, so the unique key works without nullable-column tricks.
    """

    __tablename__ = "reading_sessions"
    __table_args__ = (
        UniqueConstraint(
            "article_id",
            "viewer_key",
            "day",
            name="uq_reading_sessions_article_viewer_day",
        ),
        Index("ix_reading_sessions_user_id_updated_at", "user_id", "updated_at"),
        MYSQL_TABLE_ARGS,
    )

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    viewer_key: Mapped[str] = mapped_column(String(80), nullable=False)
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    day: Mapped[date] = mapped_column(Date, nullable=False)
    seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_scroll_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)


class Like(Base):
    __tablename__ = "likes"
    __table_args__ = (
        Index("ix_likes_user_id_created_at", "user_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)


class Bookmark(Base):
    __tablename__ = "bookmarks"
    __table_args__ = (
        Index("ix_bookmarks_user_id_created_at", "user_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)


class Comment(PKMixin, TimestampMixin, Base):
    """One reply level (parent_id), post-moderation (§5, §19 Moderation).

    Comments hang off an article *or* a video (§15). `target_type` says which,
    and exactly one of the two foreign keys is set — kept as real FKs rather
    than a bare `target_id` so the database still cascades a delete and the
    moderation queue can join to the parent in one query.
    """

    __tablename__ = "comments"
    __table_args__ = (
        Index(
            "ix_comments_article_id_status_created_at",
            "article_id",
            "status",
            "created_at",
        ),
        Index(
            "ix_comments_video_id_status_created_at", "video_id", "status", "created_at"
        ),
        Index("ix_comments_user_id_created_at", "user_id", "created_at"),
        Index("ix_comments_status_created_at", "status", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    target_type: Mapped[CommentTargetType] = mapped_column(
        Enum(CommentTargetType, native_enum=False, length=10, validate_strings=True),
        nullable=False,
        default=CommentTargetType.ARTICLE,
        server_default=CommentTargetType.ARTICLE.name,
    )
    article_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=True
    )
    video_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("videos.id", ondelete="CASCADE"), nullable=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("comments.id", ondelete="CASCADE"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[CommentStatus] = mapped_column(
        Enum(CommentStatus, native_enum=False, length=10, validate_strings=True),
        nullable=False,
        default=CommentStatus.VISIBLE,
        # Non-native enums persist the NAME (see how articles.status stores
        # 'PUBLISHED'), so the server default must be the name too.
        server_default=CommentStatus.VISIBLE.name,
    )
    #: Who hid it (moderation audit shortcut; audit_log holds the full record).
    moderated_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    user = relationship("User", foreign_keys=[user_id], lazy="joined")


class Reaction(PKMixin, Base):
    """The three-way sentiment bar (§15, "మీ స్పందన ఏంటి?").

    One row per reader per item, replaced when they change their mind — so the
    percentages describe *people*, not clicks, the same anti-inflation rule
    trending follows. Anonymous readers count too, keyed by the same
    `viewer_key` the reading sessions use, because requiring a login to react
    would make the bar measure sign-ups rather than sentiment.
    """

    __tablename__ = "reactions"
    __table_args__ = (
        UniqueConstraint(
            "target_type", "target_id", "viewer_key", name="uq_reactions_target_viewer"
        ),
        Index("ix_reactions_target", "target_type", "target_id"),
        MYSQL_TABLE_ARGS,
    )

    target_type: Mapped[CommentTargetType] = mapped_column(
        Enum(CommentTargetType, native_enum=False, length=10, validate_strings=True),
        nullable=False,
    )
    target_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    viewer_key: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
        doc="user:<id> or anon:<anon_id>, as in reading_sessions",
    )
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[ReactionKind] = mapped_column(
        Enum(ReactionKind, native_enum=False, length=10, validate_strings=True),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)


class Report(PKMixin, TimestampMixin, Base):
    """Reader reports for articles and comments (§2 "report article")."""

    __tablename__ = "reports"
    __table_args__ = (
        Index("ix_reports_status_created_at", "status", "created_at"),
        Index("ix_reports_target", "target_type", "target_id"),
        MYSQL_TABLE_ARGS,
    )

    target_type: Mapped[ReportTargetType] = mapped_column(
        Enum(ReportTargetType, native_enum=False, length=10, validate_strings=True),
        nullable=False,
    )
    target_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reason: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        doc="spam | abuse | misinformation | copyright | other",
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[ReportStatus] = mapped_column(
        Enum(ReportStatus, native_enum=False, length=10, validate_strings=True),
        nullable=False,
        default=ReportStatus.OPEN,
        server_default=ReportStatus.OPEN.name,
    )
    resolved_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(String(500), nullable=True)


class Follow(PKMixin, Base):
    """user → {category | tag | district | mandal | author} (§12).

    `target_id` is interpreted per `target_type`, the same pattern user_roles
    uses for scope_id; the service validates the target exists on create.
    """

    __tablename__ = "follows"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "target_type", "target_id", name="uq_follows_user_target"
        ),
        Index("ix_follows_target", "target_type", "target_id"),
        Index("ix_follows_user_id", "user_id"),
        MYSQL_TABLE_ARGS,
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    target_type: Mapped[FollowTargetType] = mapped_column(
        Enum(FollowTargetType, native_enum=False, length=10, validate_strings=True),
        nullable=False,
    )
    target_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
