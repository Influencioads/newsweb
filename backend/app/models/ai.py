"""AI news assistance (updated doc §15–18).

Three tables, one rule: **nothing here ever reaches a reader on its own.**

  * `ai_suggestions`  — topics the discovery pass thinks are worth covering.
    A suggestion is a prompt to a human, not content.
  * `ai_sources`      — where a suggestion came from, one row per source, kept
    so §17's attribution requirement is satisfiable and so an editor can check
    the claim before writing. Publisher name + URL + the snippet actually used;
    never a scraped copy of the article body.
  * `ai_article_drafts` — a draft written from a suggestion. Turning one into a
    real Article puts it into the ordinary editorial workflow at SUBMITTED, so
    a human still approves and a *different* human still publishes (§6.3, §15).

There is deliberately no "auto-publish" column and no `ai.publish_without_review`
permission. A test asserts that permission never exists.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin
from app.db.types import UTCDateTime
from app.models.enums import AiDraftStatus, AiSuggestionStatus


class AiSuggestion(PKMixin, TimestampMixin, Base):
    """§16 — one story idea, shown on the admin's "today's suggestions" screen."""

    __tablename__ = "ai_suggestions"
    __table_args__ = (
        Index("ix_ai_suggestions_status_created_at", "status", "created_at"),
        Index("ix_ai_suggestions_category_id", "category_id"),
        MYSQL_TABLE_ARGS,
    )

    topic_te: Mapped[str] = mapped_column(String(400), nullable=False)
    topic_en: Mapped[str | None] = mapped_column(String(400), nullable=True)
    rationale_te: Mapped[str | None] = mapped_column(
        Text, nullable=True, doc="Why this is worth covering — shown to the editor"
    )
    category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    district_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("districts.id", ondelete="SET NULL"), nullable=True
    )

    status: Mapped[AiSuggestionStatus] = mapped_column(
        Enum(AiSuggestionStatus, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=AiSuggestionStatus.NEW,
        server_default=AiSuggestionStatus.NEW.value,
    )
    score: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, doc="Ranking hint, 0..1 — never a publish gate"
    )
    engine: Mapped[str] = mapped_column(String(60), nullable=False, default="heuristic")
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)

    reviewed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    review_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    sources: Mapped[list["AiSource"]] = relationship(
        back_populates="suggestion", cascade="all, delete-orphan", lazy="selectin"
    )
    drafts: Mapped[list["AiArticleDraft"]] = relationship(
        back_populates="suggestion", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AiSuggestion {self.id} {self.status}>"


class AiSource(PKMixin, TimestampMixin, Base):
    """§17 attribution. `excerpt` is a short quotation kept for the editor to
    verify a claim — deliberately capped, never the full body, and never
    rendered to readers."""

    __tablename__ = "ai_sources"
    __table_args__ = (
        Index("ix_ai_sources_suggestion_id", "suggestion_id"),
        MYSQL_TABLE_ARGS,
    )

    suggestion_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ai_suggestions.id", ondelete="CASCADE"), nullable=False
    )
    publisher: Mapped[str] = mapped_column(String(200), nullable=False)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    url: Mapped[str] = mapped_column(String(900), nullable=False)
    licence: Mapped[str] = mapped_column(
        String(60), nullable=False, default="unknown",
        doc="What we are permitted to do with it: api | rss | press-release | cc-by | unknown",
    )
    excerpt: Mapped[str | None] = mapped_column(
        Text, nullable=True, doc="Short verification quote only. Not for publication."
    )
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    suggestion: Mapped["AiSuggestion"] = relationship(back_populates="sources")


class AiArticleDraft(PKMixin, TimestampMixin, Base):
    """§15 — AI-written copy, parked here until an editor turns it into an
    Article. `article_id` is set once that happens, so the provenance survives."""

    __tablename__ = "ai_article_drafts"
    __table_args__ = (
        Index("ix_ai_article_drafts_status_created_at", "status", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    suggestion_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("ai_suggestions.id", ondelete="SET NULL"), nullable=True
    )
    title_te: Mapped[str] = mapped_column(String(400), nullable=False)
    summary_te: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    body: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True, doc="Tiptap JSON, same shape as articles.body"
    )
    body_plain: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    district_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("districts.id", ondelete="SET NULL"), nullable=True
    )

    status: Mapped[AiDraftStatus] = mapped_column(
        Enum(AiDraftStatus, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=AiDraftStatus.DRAFT,
        server_default=AiDraftStatus.DRAFT.value,
    )
    engine: Mapped[str] = mapped_column(String(60), nullable=False, default="heuristic")
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    requires_review: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1",
        doc="Never settable to False by any API — kept as a column so the intent is explicit in the data",
    )

    article_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    suggestion: Mapped["AiSuggestion | None"] = relationship(back_populates="drafts")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AiArticleDraft {self.id} {self.status}>"
