"""Media library (§5 MEDIA, brief §17).

Storage is provider-agnostic: the row records *which* provider holds the object
and under what key, so the same article renders whether the file lives in local
dev storage, Zata.ai, or Bunny (brief §1: "Do NOT tightly couple the application
to one storage provider").

Secret keys never appear here — only the bucket-relative `storage_key` and the
public CDN URL.
"""

from __future__ import annotations

from typing import Any

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
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, SoftDeleteMixin, TimestampMixin
from app.models.enums import MediaType


class Media(PKMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "media"
    __table_args__ = (
        Index("ix_media_type_created_at", "type", "created_at"),
        Index("ix_media_uploaded_by", "uploaded_by"),
        Index(
            "ix_media_storage_provider_storage_key", "storage_provider", "storage_key"
        ),
        MYSQL_TABLE_ARGS,
    )

    type: Mapped[MediaType] = mapped_column(
        Enum(MediaType, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=MediaType.IMAGE,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime: Mapped[str] = mapped_column(String(120), nullable=False)
    bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    storage_provider: Mapped[str] = mapped_column(
        String(20), nullable=False, default="local", doc="local | zata | bunny | s3"
    )
    storage_key: Mapped[str] = mapped_column(
        String(500), nullable=False, doc="Bucket-relative key. Never a signed URL."
    )
    cdn_url: Mapped[str | None] = mapped_column(String(700), nullable=True)

    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_sec: Mapped[float | None] = mapped_column(nullable=True)
    blurhash: Mapped[str | None] = mapped_column(
        String(60),
        nullable=True,
        doc="Placeholder while the image loads — protects CLS (§10.3)",
    )

    # §12.5 makes credit a hard requirement when the photo is not our own.
    caption_te: Mapped[str | None] = mapped_column(Text, nullable=True)
    alt_te: Mapped[str | None] = mapped_column(
        String(500), nullable=True, doc="Accessibility alt text, in Telugu"
    )
    credit: Mapped[str | None] = mapped_column(String(200), nullable=True)
    copyright: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="own", server_default="own"
    )

    # §7.4 — AI-generated images carry a visible label. Non-optional.
    ai_generated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    ai_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_model: Mapped[str | None] = mapped_column(String(80), nullable=True)

    #: Derivative renditions (WebP/AVIF at 400/800/1200/1600) keyed by width.
    variants: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    uploaded_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    article_links: Mapped[list["ArticleMedia"]] = relationship(
        back_populates="media", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Media {self.id} {self.type} {self.filename}>"


class ArticleMedia(Base):
    """§5 article_media(article_id, media_id, role, sort) — role: hero/inline/gallery."""

    __tablename__ = "article_media"
    __table_args__ = (MYSQL_TABLE_ARGS,)

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True
    )
    media_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("media.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(
        String(20), primary_key=True, default="inline", doc="hero | inline | gallery"
    )
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    media: Mapped["Media"] = relationship(back_populates="article_links", lazy="joined")
