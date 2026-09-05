"""Video model (updated doc §15, per product decision: YouTube links only).

Editors paste a YouTube URL; the platform stores the 11-character video id and
metadata. Thumbnails come straight from YouTube (`i.ytimg.com`), playback is
the privacy-enhanced embed — no upload, storage, or transcoding pipeline.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, SoftDeleteMixin, TimestampMixin
from app.db.types import UTCDateTime


class Video(PKMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "videos"
    __table_args__ = (
        UniqueConstraint("youtube_id", name="uq_videos_youtube_id"),
        Index("ix_videos_published", "is_published", "published_at"),
        Index("ix_videos_category_id_published_at", "category_id", "published_at"),
        MYSQL_TABLE_ARGS,
    )

    youtube_id: Mapped[str] = mapped_column(
        String(11), nullable=False, doc="The 11-char YouTube video id"
    )
    title_te: Mapped[str] = mapped_column(String(400), nullable=False)
    title_en: Mapped[str | None] = mapped_column(String(400), nullable=True)
    description_te: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    district_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("districts.id", ondelete="SET NULL"), nullable=True
    )
    duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    category = relationship("Category", lazy="joined")

    @property
    def thumbnail_url(self) -> str:
        return f"https://i.ytimg.com/vi/{self.youtube_id}/hqdefault.jpg"

    @property
    def embed_url(self) -> str:
        return f"https://www.youtube-nocookie.com/embed/{self.youtube_id}"

    @property
    def watch_url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.youtube_id}"
