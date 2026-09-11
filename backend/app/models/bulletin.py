"""The three-hourly audio newspaper.

Six bulletins a day — 06, 09, 12, 15, 18 and 21 IST — each about three minutes
long, assembled from stories an editor has already approved and published.

**Why this is a new table rather than an `AudioAsset`.** `AudioAsset.article_id`
is NOT NULL and the row is keyed `(article_id, content_hash)`, which is what
makes the §21 "never pay twice for the same words" guarantee work. Making that
column nullable would break it silently: MySQL permits *multiple* NULLs in a
unique index, so bulletins would stop deduplicating and nobody would notice
until the bill arrived. The character accounting is recovered explicitly —
`tts_service.month_chars_used` sums both tables, so there is still one budget.

**Why not `EpaperAsset(kind="AUDIO")`**, which already exists unused: it is
unique on `(edition_id, kind, revision)`, so six bulletins a day cannot coexist,
and it would tie the 09:00 bulletin to an e-paper edition generated at 05:00.

`headline_te` and `spoken_te` on the item rows are **frozen copies**. Once the
audio is rendered it cannot change, so the transcript a listener reads has to
match what they hear — even after the source article is corrected.
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
from app.models.enums import BulletinStatus


class AudioBulletin(PKMixin, TimestampMixin, Base):
    __tablename__ = "audio_bulletins"
    __table_args__ = (
        UniqueConstraint("bulletin_date", "slot", name="uq_audio_bulletins_date_slot"),
        Index("ix_audio_bulletins_status_date_slot", "status", "bulletin_date", "slot"),
        MYSQL_TABLE_ARGS,
    )

    #: The IST calendar day, not UTC — a 21:00 bulletin belongs to its own
    #: evening, and in UTC that is already tomorrow.
    bulletin_date: Mapped[date] = mapped_column(Date, nullable=False)
    #: The IST hour: 6, 9, 12, 15, 18 or 21.
    slot: Mapped[int] = mapped_column(Integer, nullable=False)
    slot_label_te: Mapped[str] = mapped_column(String(60), nullable=False, default="")

    status: Mapped[BulletinStatus] = mapped_column(
        Enum(BulletinStatus, native_enum=False, length=12, validate_strings=True),
        nullable=False,
        default=BulletinStatus.PENDING,
        server_default=BulletinStatus.PENDING.name,
    )
    #: Bumped by a regenerate, so a new render is a new immutable object rather
    #: than a stale CDN hit on the old key.
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    #: Render attempts. The retry task gives up after three rather than
    #: hammering a provider that is down all evening.
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    #: Exactly the words that are spoken. Editable before a render.
    script_te: Mapped[str | None] = mapped_column(Text, nullable=True)
    script_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    char_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    provider: Mapped[str] = mapped_column(
        String(30), nullable=False, default="local", server_default="local"
    )
    voice: Mapped[str | None] = mapped_column(String(60), nullable=True)
    language: Mapped[str] = mapped_column(
        String(10), nullable=False, default="te-IN", server_default="te-IN"
    )

    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    url: Mapped[str | None] = mapped_column(String(700), nullable=True)
    mime: Mapped[str] = mapped_column(
        String(60), nullable=False, default="audio/mpeg", server_default="audio/mpeg"
    )
    bytes: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    duration_sec: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    segment_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )

    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    approved_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    requested_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    items: Mapped[list["AudioBulletinItem"]] = relationship(
        back_populates="bulletin",
        cascade="all, delete-orphan",
        order_by="AudioBulletinItem.position",
    )

    @property
    def is_live(self) -> bool:
        return self.status == BulletinStatus.PUBLISHED and bool(self.url)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AudioBulletin {self.bulletin_date} {self.slot:02d}h {self.status}>"


class AudioBulletinItem(PKMixin, Base):
    __tablename__ = "audio_bulletin_items"
    __table_args__ = (
        UniqueConstraint(
            "bulletin_id", "article_id", name="uq_audio_bulletin_items_bulletin_article"
        ),
        UniqueConstraint(
            "bulletin_id", "position", name="uq_audio_bulletin_items_bulletin_position"
        ),
        MYSQL_TABLE_ARGS,
    )

    bulletin_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("audio_bulletins.id", ondelete="CASCADE"), nullable=False
    )
    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    #: Frozen at render time. The audio cannot be edited, so the transcript
    #: must not drift from it when the source story is later corrected.
    headline_te: Mapped[str] = mapped_column(String(400), nullable=False, default="")
    spoken_te: Mapped[str] = mapped_column(Text, nullable=False, default="")

    bulletin: Mapped["AudioBulletin"] = relationship(back_populates="items")
    article = relationship("Article", lazy="joined")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AudioBulletinItem {self.bulletin_id}#{self.position}>"
