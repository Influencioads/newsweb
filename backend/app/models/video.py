"""Video model (updated doc §15, per product decision: YouTube links only).

Editors paste a YouTube URL; the platform stores the 11-character video id and
metadata. Thumbnails come straight from YouTube (`i.ytimg.com`), playback is
the privacy-enhanced embed — no upload, storage, or transcoding pipeline.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, SoftDeleteMixin, TimestampMixin
from app.db.types import UTCDateTime


class VideoChannel(PKMixin, TimestampMixin, Base):
    """The publisher a video came from (§15).

    Its own table rather than a name string on `videos` for two reasons: a
    reader can follow a channel the same way they follow a category, and
    attribution — which YouTube's terms require us to show — then has one
    authoritative spelling instead of one per video row.
    """

    __tablename__ = "video_channels"
    __table_args__ = (
        UniqueConstraint(
            "youtube_channel_key", name="uq_video_channels_youtube_channel_key"
        ),
        MYSQL_TABLE_ARGS,
    )

    #: YouTube's channel id when we have it, else a slug of the display name —
    #: oEmbed gives a name but not always an id.
    youtube_channel_key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(700), nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    follower_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        doc="Followers on *our* platform, not YouTube's subscriber count",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<VideoChannel {self.name}>"


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
    channel_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("video_channels.id", ondelete="SET NULL"), nullable=True
    )
    duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Denormalised like the article counters, for the same reason: the video
    # page must not need three COUNT(*) queries to render its footer.
    like_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    comment_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    share_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    category = relationship("Category", lazy="joined")
    channel = relationship("VideoChannel", lazy="joined")
    tags: Mapped[list["VideoTag"]] = relationship(
        back_populates="video", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def thumbnail_url(self) -> str:
        return f"https://i.ytimg.com/vi/{self.youtube_id}/hqdefault.jpg"

    @property
    def embed_url(self) -> str:
        return f"https://www.youtube-nocookie.com/embed/{self.youtube_id}"

    @property
    def watch_url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.youtube_id}"


class VideoTag(Base):
    """§15 hashtag chips under a video. Mirrors `article_tags` so a tag means
    the same thing wherever it appears and a tag page can list both."""

    __tablename__ = "video_tags"
    __table_args__ = (MYSQL_TABLE_ARGS,)

    video_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("videos.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    video: Mapped["Video"] = relationship(back_populates="tags")
    tag = relationship("Tag", lazy="joined")
