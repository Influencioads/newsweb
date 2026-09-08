"""Server-generated article audio (updated doc §19–21).

The device voice (Web Speech / expo-speech) needs no storage, but it cannot be
seeked, cannot be cached, and sounds different on every handset. §19 asks for a
real audio file, so one row here per generated rendition.

§21 (cost control) is the `content_hash` column, not a separate mechanism: the
hash covers the exact text that was sent to the provider, so re-publishing an
article whose words did not change re-uses the existing file instead of paying
to synthesise it again. An edit changes the hash and a new row is generated.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin
from app.db.types import UTCDateTime
from app.models.enums import AudioStatus


class AudioAsset(PKMixin, TimestampMixin, Base):
    __tablename__ = "audio_assets"
    __table_args__ = (
        # The cache key of §21: one row per (article, exact text).
        UniqueConstraint("article_id", "content_hash", name="uq_audio_assets_article_id_content_hash"),
        Index("ix_audio_assets_status_created_at", "status", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    content_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, doc="sha256 of the exact text sent to the provider"
    )
    status: Mapped[AudioStatus] = mapped_column(
        Enum(AudioStatus, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=AudioStatus.PENDING,
        server_default=AudioStatus.PENDING.value,
    )

    provider: Mapped[str] = mapped_column(
        String(30), nullable=False, default="local", doc="google | bhashini | local"
    )
    voice: Mapped[str | None] = mapped_column(String(60), nullable=True)
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="te-IN")

    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    url: Mapped[str | None] = mapped_column(String(700), nullable=True)
    mime: Mapped[str] = mapped_column(String(60), nullable=False, default="audio/mpeg")
    bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    char_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, doc="Billing unit for most TTS providers (§21)"
    )

    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    requested_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # articles.audio_asset_id points the other way, so name the column.
    article = relationship("Article", lazy="selectin", foreign_keys=[article_id])

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AudioAsset article={self.article_id} {self.status}>"
