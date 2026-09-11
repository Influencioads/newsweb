"""Discovery models (updated doc Phase D): trending scores and pins.

`trending_scores` is a *derived* table — the trending job folds the
`article_events` stream into time-decayed scores per scope and rewrites it
wholesale. Nothing edits rows in place; a recompute replaces them.

`pins` is the editorial override (§9): placement + start/end timestamps.
Expiry is enforced by the read predicate (`ends_at > now`), so an expired pin
can never occupy a top slot no matter what a job forgot to do (§1.3).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Enum, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin
from app.db.types import UTCDateTime
from app.models.enums import PinPlacement, TrendingScope


class TrendingScore(PKMixin, Base):
    __tablename__ = "trending_scores"
    __table_args__ = (
        Index("ix_trending_scores_scope_score", "scope_type", "scope_id", "score"),
        Index("ix_trending_scores_article_id", "article_id"),
        MYSQL_TABLE_ARGS,
    )

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    scope_type: Mapped[TrendingScope] = mapped_column(
        Enum(TrendingScope, native_enum=False, length=10, validate_strings=True),
        nullable=False,
    )
    scope_id: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True, doc="category id or district id; NULL for global"
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    computed_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)


class Pin(PKMixin, TimestampMixin, Base):
    __tablename__ = "pins"
    __table_args__ = (
        Index("ix_pins_placement_ends_at", "placement", "ends_at"),
        Index("ix_pins_article_id", "article_id"),
        MYSQL_TABLE_ARGS,
    )

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    placement: Mapped[PinPlacement] = mapped_column(
        Enum(PinPlacement, native_enum=False, length=10, validate_strings=True),
        nullable=False,
    )
    category_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("categories.id", ondelete="CASCADE"),
        nullable=True,
        doc="Required for placement=CATEGORY",
    )
    district_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("districts.id", ondelete="CASCADE"),
        nullable=True,
        doc="Required for placement=LOCAL",
    )
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    ends_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    article = relationship("Article", lazy="joined")
