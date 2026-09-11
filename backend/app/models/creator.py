"""Creator submissions (updated doc §17) and house-ad campaigns (§26).

A submission is plain text from a reader. Approval converts it into a real
`Article` (source_type=contributed, byline = the creator) sitting in the
normal editorial workflow — the platform-wide rule that nothing reaches a
reader without an editor pressing Approve is never bypassed here.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin
from app.db.types import UTCDateTime
from app.models.enums import AdPlacement, SubmissionStatus


class CreatorSubmission(PKMixin, TimestampMixin, Base):
    __tablename__ = "creator_submissions"
    __table_args__ = (
        Index("ix_creator_submissions_status_created_at", "status", "created_at"),
        Index("ix_creator_submissions_user_id_created_at", "user_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title_te: Mapped[str] = mapped_column(String(400), nullable=False)
    body_te: Mapped[str] = mapped_column(
        Text, nullable=False, doc="Plain text; paragraphs split on blank lines"
    )
    category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    district_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("districts.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[SubmissionStatus] = mapped_column(
        Enum(SubmissionStatus, native_enum=False, length=10, validate_strings=True),
        nullable=False,
        default=SubmissionStatus.PENDING,
        server_default=SubmissionStatus.PENDING.name,
    )
    review_note: Mapped[str | None] = mapped_column(
        String(500), nullable=True, doc="Shown to the creator on rejection (§17)"
    )
    reviewed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    article_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("articles.id", ondelete="SET NULL"),
        nullable=True,
        doc="The Article created on approval",
    )

    user = relationship("User", foreign_keys=[user_id], lazy="joined")


class AdCampaign(PKMixin, TimestampMixin, Base):
    """§26 house ads: image + click-through, scheduled, geo/category targeted,
    with the basic impression/click counters the doc asks for."""

    __tablename__ = "ad_campaigns"
    __table_args__ = (
        Index("ix_ad_campaigns_placement_active", "placement", "is_active", "ends_at"),
        MYSQL_TABLE_ARGS,
    )

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    image_url: Mapped[str] = mapped_column(String(600), nullable=False)
    target_url: Mapped[str] = mapped_column(String(600), nullable=False)
    placement: Mapped[AdPlacement] = mapped_column(
        Enum(AdPlacement, native_enum=False, length=15, validate_strings=True),
        nullable=False,
    )
    #: NULL = untargeted; set = only that category/district sees it (§26).
    category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("categories.id", ondelete="CASCADE"), nullable=True
    )
    district_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("districts.id", ondelete="CASCADE"), nullable=True
    )
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    ends_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    weight: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        doc="Rotation weight among matching campaigns",
    )
    impressions: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    clicks: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
