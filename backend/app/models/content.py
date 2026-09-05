"""Content: categories, tags, articles, versions, workflow history.

§5 CONTENT. Two deviations from the literal spec, both forced by MySQL and both
recorded in docs/SOURCE_CONFLICTS.md C-2:

  * `body jsonb`        -> MySQL `JSON`. Tiptap JSON remains the source of truth.
  * `search_aliases[]`  -> a normalised `article_search_aliases` child table,
                           because MySQL has no array type and the brief (§30)
                           requires proper normalisation anyway.
"""

from __future__ import annotations

from datetime import datetime
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
    UniqueConstraint,
)
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import (
    MYSQL_TABLE_ARGS,
    ActorMixin,
    Base,
    PKMixin,
    SoftDeleteMixin,
    TimestampMixin,
)
from app.db.types import UTCDateTime
from app.models.enums import ArticleStatus, TagType, WorkflowState


# --------------------------------------------------------------------------- #
# Taxonomy
# --------------------------------------------------------------------------- #
class Category(PKMixin, TimestampMixin, Base):
    """§5 categories. Self-referencing for sub-sections (సినిమా > టాలీవుడ్)."""

    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_categories_slug"),
        Index("ix_categories_parent_id_sort", "parent_id", "sort"),
        MYSQL_TABLE_ARGS,
    )

    parent_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name_te: Mapped[str] = mapped_column(String(120), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    description_te: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    show_in_nav: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, doc="Appears in the masthead nav (mockup 1b)"
    )
    seo_title: Mapped[str | None] = mapped_column(String(180), nullable=True)
    seo_description: Mapped[str | None] = mapped_column(String(320), nullable=True)

    parent: Mapped["Category | None"] = relationship(remote_side="Category.id")
    articles: Mapped[list["Article"]] = relationship(back_populates="category")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Category {self.slug}>"


class Tag(PKMixin, TimestampMixin, Base):
    """§5 tags(..., type) — person / place / org / topic.

    The `person` rows double as the name blocklist the AI image generator checks
    before dispatch (§7.4): we do not generate photoreal images of real people.
    """

    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_tags_slug"),
        Index("ix_tags_type", "type"),
        MYSQL_TABLE_ARGS,
    )

    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    name_te: Mapped[str] = mapped_column(String(140), nullable=False)
    name_en: Mapped[str] = mapped_column(String(140), nullable=False)
    type: Mapped[TagType] = mapped_column(
        Enum(TagType, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=TagType.TOPIC,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    usage_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    articles: Mapped[list["ArticleTag"]] = relationship(
        back_populates="tag", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Tag {self.slug} ({self.type})>"


class TermGlossary(PKMixin, TimestampMixin, Base):
    """§5 term_glossary — canonical spellings for politicians, parties, schemes,
    place names. Injected into AI prompt context (§7.2) and used by sub-editors."""

    __tablename__ = "term_glossary"
    __table_args__ = (
        UniqueConstraint("term_en", name="uq_term_glossary_term_en"),
        MYSQL_TABLE_ARGS,
    )

    term_en: Mapped[str] = mapped_column(String(160), nullable=False)
    term_te: Mapped[str] = mapped_column(String(160), nullable=False)
    type: Mapped[TagType] = mapped_column(
        Enum(TagType, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=TagType.TOPIC,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


# --------------------------------------------------------------------------- #
# Articles
# --------------------------------------------------------------------------- #
class Article(PKMixin, TimestampMixin, SoftDeleteMixin, ActorMixin, Base):
    """The central content entity (§5).

    `status` is the coarse lifecycle; `workflow_state` is the editorial state
    machine of §6.3. They are kept separate so a published article being edited
    can sit in UPDATE_REVIEW while its status stays PUBLISHED — which is exactly
    what "the live version stays live until re-approved" requires.
    """

    __tablename__ = "articles"
    __table_args__ = (
        UniqueConstraint("short_id", name="uq_articles_short_id"),
        # §5 indexing block, translated to MySQL composites.
        Index("ix_articles_status_published_at", "status", "published_at"),
        Index("ix_articles_category_id_published_at", "category_id", "published_at"),
        Index("ix_articles_district_id_published_at", "district_id", "published_at"),
        Index("ix_articles_mandal_id_published_at", "mandal_id", "published_at"),
        Index("ix_articles_locality_id_published_at", "locality_id", "published_at"),
        # MySQL has no partial index; this composite serves the public feed query
        # `WHERE status='published' AND deleted_at IS NULL ORDER BY published_at DESC`.
        Index("ix_articles_status_deleted_at_published_at", "status", "deleted_at", "published_at"),
        # §5: "articles(workflow_state, updated_at) — the editor queue query"
        Index("ix_articles_workflow_state_updated_at", "workflow_state", "updated_at"),
        Index("ix_articles_author_id_published_at", "author_id", "published_at"),
        Index("ix_articles_slug", "slug"),
        Index("ix_articles_scheduled_at", "scheduled_at"),
        MYSQL_TABLE_ARGS,
    )

    # --- identity (§4.5) ---------------------------------------------------
    short_id: Mapped[str] = mapped_column(
        String(12), nullable=False, doc="6-char nanoid; the stable part of the URL"
    )
    slug: Mapped[str] = mapped_column(
        String(180), nullable=False, doc="Transliterated English (§4.5), never Telugu"
    )

    # --- headline and copy -------------------------------------------------
    title_te: Mapped[str] = mapped_column(String(400), nullable=False)
    title_en: Mapped[str | None] = mapped_column(
        String(400), nullable=True, doc="Transliterated/English headline — required for search (§4.4)"
    )
    sub_title_te: Mapped[str | None] = mapped_column(String(500), nullable=True)
    summary_te: Mapped[str | None] = mapped_column(
        String(1000), nullable=True, doc="~40-word standfirst"
    )

    body: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True, doc="Tiptap/ProseMirror JSON — the source of truth (§1)"
    )
    body_plain: Mapped[str | None] = mapped_column(
        Text, nullable=True, doc="Derived from body on save; feeds Meilisearch (§4.4)"
    )
    body_html: Mapped[str | None] = mapped_column(
        Text, nullable=True, doc="Derived cache for RSS and crawlers. Never authoritative."
    )

    # --- placement ---------------------------------------------------------
    category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    district_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("districts.id", ondelete="SET NULL"), nullable=True
    )
    mandal_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("mandals.id", ondelete="SET NULL"), nullable=True
    )
    locality_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("localities.id", ondelete="SET NULL"),
        nullable=True,
        doc="City/village granularity (updated doc §4); usually NULL",
    )
    hero_media_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("media.id", ondelete="SET NULL"), nullable=True
    )

    # --- state -------------------------------------------------------------
    status: Mapped[ArticleStatus] = mapped_column(
        Enum(ArticleStatus, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=ArticleStatus.DRAFT,
        server_default=ArticleStatus.DRAFT.value,
    )
    workflow_state: Mapped[WorkflowState] = mapped_column(
        Enum(WorkflowState, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=WorkflowState.DRAFT,
        server_default=WorkflowState.DRAFT.value,
    )
    is_breaking: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, doc="Requires role level >= 80 (§6.3)"
    )
    is_exclusive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # --- byline (§12.5 wire-copy rules) ------------------------------------
    author_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    byline_te: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_credit: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
        doc="Agency credit (PTI/IANS/ANI). Publishing is blocked without it when source != own.",
    )
    source_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="own", server_default="own",
        doc="own | agency | contributed | syndicated",
    )

    # --- AI provenance (§7.2) ---------------------------------------------
    ai_generated: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
        doc="Set by the system; cannot be unset via the API (§7.2)",
    )
    ai_job_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ai_model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    ai_confidence: Mapped[float | None] = mapped_column(nullable=True)

    # --- SEO ---------------------------------------------------------------
    seo_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    seo_description: Mapped[str | None] = mapped_column(String(400), nullable=True)
    canonical_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # --- metrics -----------------------------------------------------------
    reading_time_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    view_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    # Denormalised engagement counters (Phase C), kept in sync by
    # engagement_service so the article page never needs a COUNT(*).
    like_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    comment_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    share_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # --- timing ------------------------------------------------------------
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    first_published_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True, doc="Kept across unpublish/republish for NewsArticle JSON-LD"
    )
    corrected_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True, doc="Drives the 'సవరించబడింది: {date}' line (§12.5)"
    )
    correction_note_te: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- approval (§6.3) ---------------------------------------------------
    approved_by: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        doc="Must differ from author_id. Self-approval is blocked in the service layer.",
    )
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    published_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # --- relationships -----------------------------------------------------
    category: Mapped["Category | None"] = relationship(back_populates="articles", lazy="joined")
    tags: Mapped[list["ArticleTag"]] = relationship(
        back_populates="article", cascade="all, delete-orphan"
    )
    aliases: Mapped[list["ArticleSearchAlias"]] = relationship(
        back_populates="article", cascade="all, delete-orphan"
    )
    versions: Mapped[list["ArticleVersion"]] = relationship(
        back_populates="article", cascade="all, delete-orphan"
    )
    transitions: Mapped[list["WorkflowTransition"]] = relationship(
        back_populates="article", cascade="all, delete-orphan"
    )

    @property
    def is_live(self) -> bool:
        """Visible to readers. The single check every public query must apply."""
        return self.status == ArticleStatus.PUBLISHED and self.deleted_at is None

    @property
    def url_path(self) -> str:
        """§4.5 URL pattern: /{category}/{slug}-{shortId}"""
        cat = self.category.slug if self.category else "news"
        return f"/{cat}/{self.slug}-{self.short_id}"

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Article {self.short_id} {self.workflow_state}>"


class ArticleTag(Base):
    __tablename__ = "article_tags"
    __table_args__ = (MYSQL_TABLE_ARGS,)

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    article: Mapped["Article"] = relationship(back_populates="tags")
    tag: Mapped["Tag"] = relationship(back_populates="articles", lazy="joined")


class ArticleSearchAlias(PKMixin, Base):
    """MySQL replacement for §5's `search_aliases text[]` (SOURCE_CONFLICTS C-2).

    Normalised rather than a JSON column so aliases stay indexable and an editor
    can correct one alias without rewriting the whole array.
    """

    __tablename__ = "article_search_aliases"
    __table_args__ = (
        UniqueConstraint("article_id", "alias", name="uq_article_search_aliases_article_id_alias"),
        Index("ix_article_search_aliases_alias", "alias"),
        MYSQL_TABLE_ARGS,
    )

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    alias: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="auto", doc="auto | ai | editor"
    )

    article: Mapped["Article"] = relationship(back_populates="aliases")


class ArticleVersion(PKMixin, Base):
    """§5 article_versions — a full snapshot per meaningful edit (brief §12).

    §6.3: "Every approval snapshots the full article into article_versions."
    """

    __tablename__ = "article_versions"
    __table_args__ = (
        UniqueConstraint("article_id", "version", name="uq_article_versions_article_id_version"),
        Index("ix_article_versions_article_id_created_at", "article_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, doc="Complete article state at this version"
    )
    changed_fields: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    change_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)

    article: Mapped["Article"] = relationship(back_populates="versions")


class WorkflowTransition(PKMixin, Base):
    """§5 workflow_transitions — every state change, no exceptions (§6.3)."""

    __tablename__ = "workflow_transitions"
    __table_args__ = (
        Index("ix_workflow_transitions_article_id_created_at", "article_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )
    from_state: Mapped[WorkflowState | None] = mapped_column(
        Enum(WorkflowState, native_enum=False, length=20, validate_strings=True), nullable=True
    )
    to_state: Mapped[WorkflowState] = mapped_column(
        Enum(WorkflowState, native_enum=False, length=20, validate_strings=True), nullable=False
    )
    actor_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)

    article: Mapped["Article"] = relationship(back_populates="transitions")
