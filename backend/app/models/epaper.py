"""Generated and personalized newspaper editions.

The public edition is immutable once published. Editors may regenerate drafts;
publishing records the approving user and a content revision so cached PDF and
audio assets can be invalidated safely.
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, ActorMixin, Base, PKMixin, TimestampMixin
from app.db.types import UTCDateTime


class EpaperPageTemplate(PKMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "epaper_page_templates"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_epaper_page_templates_slug"),
        Index("ix_epaper_page_templates_visible_sort", "is_visible", "sort"),
        MYSQL_TABLE_ARGS,
    )

    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    title_te: Mapped[str] = mapped_column(String(180), nullable=False)
    title_en: Mapped[str] = mapped_column(String(180), nullable=False)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    category_ids: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    story_count: Mapped[int] = mapped_column(Integer, nullable=False, default=6)
    layout_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="lead_grid"
    )
    is_visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class EpaperEdition(PKMixin, TimestampMixin, Base):
    __tablename__ = "epaper_editions"
    __table_args__ = (
        UniqueConstraint(
            "edition_date",
            "edition_type",
            "owner_user_id",
            name="uq_epaper_edition_day_type_owner",
        ),
        Index("ix_epaper_editions_status_date", "status", "edition_date"),
        MYSQL_TABLE_ARGS,
    )

    title: Mapped[str] = mapped_column(String(240), nullable=False)
    edition_date: Mapped[date] = mapped_column(Date, nullable=False)
    edition_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="DAILY"
    )
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="te")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    owner_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    pages: Mapped[list["EpaperPage"]] = relationship(
        back_populates="edition",
        cascade="all, delete-orphan",
        order_by="EpaperPage.page_number",
    )
    assets: Mapped[list["EpaperAsset"]] = relationship(
        back_populates="edition", cascade="all, delete-orphan"
    )


class EpaperPage(PKMixin, TimestampMixin, Base):
    __tablename__ = "epaper_pages"
    __table_args__ = (
        UniqueConstraint(
            "edition_id", "page_number", name="uq_epaper_pages_edition_number"
        ),
        Index("ix_epaper_pages_edition_status", "edition_id", "status"),
        MYSQL_TABLE_ARGS,
    )

    edition_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("epaper_editions.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("epaper_page_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    layout_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="lead_grid"
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")
    poll_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("polls.id", ondelete="SET NULL"), nullable=True
    )
    edition: Mapped[EpaperEdition] = relationship(back_populates="pages")
    articles: Mapped[list["EpaperPageArticle"]] = relationship(
        back_populates="page",
        cascade="all, delete-orphan",
        order_by="EpaperPageArticle.position",
    )


class EpaperPageArticle(PKMixin, Base):
    __tablename__ = "epaper_page_articles"
    __table_args__ = (
        UniqueConstraint("page_id", "article_id", name="uq_epaper_page_article"),
        UniqueConstraint("page_id", "position", name="uq_epaper_page_position"),
        MYSQL_TABLE_ARGS,
    )

    page_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("epaper_pages.id", ondelete="CASCADE"), nullable=False
    )
    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    display_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="standard"
    )
    page: Mapped[EpaperPage] = relationship(back_populates="articles")
    article: Mapped[Any] = relationship("Article", lazy="joined")


class EpaperAsset(PKMixin, TimestampMixin, Base):
    __tablename__ = "epaper_assets"
    __table_args__ = (
        UniqueConstraint(
            "edition_id", "kind", "revision", name="uq_epaper_asset_revision"
        ),
        Index("ix_epaper_assets_edition_kind_status", "edition_id", "kind", "status"),
        MYSQL_TABLE_ARGS,
    )

    edition_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("epaper_editions.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # PDF | AUDIO
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    public_url: Mapped[str | None] = mapped_column(String(700), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    edition: Mapped[EpaperEdition] = relationship(back_populates="assets")


class EpaperPageShare(PKMixin, TimestampMixin, Base):
    __tablename__ = "epaper_page_shares"
    __table_args__ = (
        Index("ix_epaper_page_shares_page_created", "page_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )
    page_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("epaper_pages.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    channel: Mapped[str] = mapped_column(String(30), nullable=False, default="native")


class EpaperUserEdition(PKMixin, TimestampMixin, Base):
    __tablename__ = "epaper_user_editions"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_epaper_user_edition_name"),
        MYSQL_TABLE_ARGS,
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_generate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    generation_time: Mapped[time] = mapped_column(
        Time, nullable=False, default=time(6, 0)
    )
    preferences: Mapped[list["EpaperUserEditionPreference"]] = relationship(
        cascade="all, delete-orphan", order_by="EpaperUserEditionPreference.priority"
    )


class EpaperUserEditionPreference(PKMixin, Base):
    __tablename__ = "epaper_user_edition_preferences"
    __table_args__ = (
        UniqueConstraint(
            "user_edition_id",
            "preference_type",
            "target_id",
            name="uq_epaper_user_preference",
        ),
        MYSQL_TABLE_ARGS,
    )
    user_edition_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("epaper_user_editions.id", ondelete="CASCADE"),
        nullable=False,
    )
    preference_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # category/district/mandal/tag
    target_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
