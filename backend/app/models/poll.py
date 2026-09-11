"""Interactive polls and editorially-overridable trending topics."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, ActorMixin, Base, PKMixin, TimestampMixin
from app.db.types import UTCDateTime


class Poll(PKMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "polls"
    __table_args__ = (
        Index("ix_polls_status_dates", "status", "start_time", "end_time"),
        MYSQL_TABLE_ARGS,
    )
    question_te: Mapped[str] = mapped_column(String(500), nullable=False)
    question_en: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    district_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("districts.id", ondelete="SET NULL"), nullable=True
    )
    article_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="SET NULL"), nullable=True
    )
    start_time: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")
    is_big_question: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    options: Mapped[list["PollOption"]] = relationship(
        back_populates="poll",
        cascade="all, delete-orphan",
        order_by="PollOption.display_order",
    )


class PollOption(PKMixin, Base):
    __tablename__ = "poll_options"
    __table_args__ = (
        UniqueConstraint("poll_id", "display_order", name="uq_poll_option_order"),
        MYSQL_TABLE_ARGS,
    )
    poll_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("polls.id", ondelete="CASCADE"), nullable=False
    )
    option_text_te: Mapped[str] = mapped_column(String(300), nullable=False)
    option_text_en: Mapped[str | None] = mapped_column(String(300), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)
    vote_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    poll: Mapped[Poll] = relationship(back_populates="options")


class PollVote(PKMixin, TimestampMixin, Base):
    __tablename__ = "poll_votes"
    __table_args__ = (
        UniqueConstraint("poll_id", "voter_key", name="uq_poll_vote_voter"),
        Index("ix_poll_votes_poll_option", "poll_id", "option_id"),
        MYSQL_TABLE_ARGS,
    )
    poll_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("polls.id", ondelete="CASCADE"), nullable=False
    )
    option_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("poll_options.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    voter_key: Mapped[str] = mapped_column(String(80), nullable=False)


class TrendingTopic(PKMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "trending_topics"
    __table_args__ = (
        Index("ix_trending_topics_active_rank", "is_active", "override_rank"),
        MYSQL_TABLE_ARGS,
    )
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    title_te: Mapped[str] = mapped_column(String(180), nullable=False)
    title_en: Mapped[str | None] = mapped_column(String(180), nullable=True)
    category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    tag_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("tags.id", ondelete="SET NULL"), nullable=True
    )
    override_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score: Mapped[float] = mapped_column(nullable=False, default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
