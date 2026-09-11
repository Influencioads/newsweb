"""Content ingestion from external publishers (updated doc §17).

This is how an aggregator actually gets its content, and it is worth being
precise about, because the obvious guess is wrong. Inspecting a large Indian
aggregator's own payload shows each item carrying:

    source.type      = "OGC"                 (a contracted publisher)
    publisherStoryUrl = the publisher's page  (canonical, linked back)
    source.badgeType  = "VERIFIED"
    content           = the publisher's text, unmodified, with the line
                        "auto-published from an agency feed ... not reviewed
                        by an editor"

In other words: licensed feeds, republished verbatim under agreement, labelled
as such — not a crawler pulling text off other people's pages. §17 says the
same thing in one sentence: "Do not scrape copyrighted content blindly. Use
source attribution and respect website/API terms and copyright."

So the model here makes the licence a first-class, per-source field, and the
service refuses to store more than the licence allows. A source added without
an explicit agreement can only ever produce a headline, a short excerpt and a
link out — which is what every feed reader has always done — and full-text
republication requires an admin to state, on the record, that a contract
exists.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Enum,
    Float,
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
from app.models.enums import (
    ContentPolicy,
    IngestStatus,
    MandalMatchMethod,
    RewriteStatus,
    SourceBeat,
    SourceLicence,
)


class ContentSource(PKMixin, TimestampMixin, Base):
    """A publisher or agency we ingest from (§17)."""

    __tablename__ = "content_sources"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_content_sources_slug"),
        Index("ix_content_sources_active_next", "is_active", "last_fetched_at"),
        Index("ix_content_sources_beat_active", "beat", "is_active"),
        MYSQL_TABLE_ARGS,
    )

    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_te: Mapped[str | None] = mapped_column(String(200), nullable=True)
    homepage_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(700), nullable=True)

    feed_url: Mapped[str] = mapped_column(String(900), nullable=False)
    feed_kind: Mapped[str] = mapped_column(
        String(20), nullable=False, default="rss", doc="rss | atom | json"
    )

    #: What we are permitted to do with this source's words. The service reads
    #: this before storing anything, so a mislabelled source cannot leak full
    #: text into the database.
    licence: Mapped[SourceLicence] = mapped_column(
        Enum(SourceLicence, native_enum=False, length=24, validate_strings=True),
        nullable=False,
        default=SourceLicence.RSS_PUBLIC,
        server_default=SourceLicence.RSS_PUBLIC.name,
    )
    content_policy: Mapped[ContentPolicy] = mapped_column(
        Enum(ContentPolicy, native_enum=False, length=16, validate_strings=True),
        nullable=False,
        default=ContentPolicy.EXCERPT_ONLY,
        server_default=ContentPolicy.EXCERPT_ONLY.name,
        doc="EXCERPT_ONLY unless a contract is recorded in licence_note",
    )
    licence_note: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        doc="Which agreement permits this. Required before FULL_TEXT is allowed.",
    )
    attribution_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    #: Never true by default. Even a full-text licence goes through review
    #: unless an admin deliberately turns this on for that source.
    auto_publish: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    default_category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    default_district_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("districts.id", ondelete="SET NULL"), nullable=True
    )
    #: For the rare genuinely local outlet — a single-mandal community site or
    #: a mandal office bulletin. Not the primary mechanism: there is no feed
    #: per mandal, so most items get their mandal from the text instead.
    default_mandal_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("mandals.id", ondelete="SET NULL"), nullable=True
    )
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="te")

    # --- hourly crawl ------------------------------------------------------
    #: What this source is for. GENERAL is the migration default and carries a
    #: zero hourly quota, so adding the crawl cannot change what existing
    #: sources do until an admin classifies them.
    beat: Mapped[SourceBeat] = mapped_column(
        Enum(SourceBeat, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=SourceBeat.GENERAL,
        server_default=SourceBeat.GENERAL.name,
    )
    #: Per-hour ceiling on items from this source sent to the AI rewrite. The
    #: reason this exists at all: without it one chatty national aggregator
    #: posting forty items an hour consumes the entire budget and district
    #: coverage silently goes to zero, while the dashboard looks healthy.
    max_items_per_hour: Mapped[int] = mapped_column(
        Integer, nullable=False, default=8, server_default="8"
    )
    #: Fetch the article page when the feed carries only a stub. Off by
    #: default, and `_guard_licence` additionally requires a written
    #: `licence_note` before it can be turned on — the admin has to record why
    #: fetching this publisher's pages is acceptable.
    allow_html_fallback: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    #: Run the Telugu AI rewrite for this source's items.
    rewrite_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    #: Guess a mandal from the item text when no default mandal is set.
    mandal_autotag: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )

    fetch_interval_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, default=30, server_default="30"
    )
    # Conditional-GET state. Sending these back means an unchanged feed costs a
    # 304 instead of a full download — the difference between being a good
    # citizen and being blocked.
    etag: Mapped[str | None] = mapped_column(String(300), nullable=True)
    last_modified: Mapped[str | None] = mapped_column(String(120), nullable=True)
    last_fetched_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_error_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    items_ingested: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )

    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    category = relationship("Category", lazy="joined")

    @property
    def may_store_full_text(self) -> bool:
        """The single check that keeps §17 true.

        Full text needs both a policy saying so *and* a licence that could
        plausibly permit it. A public RSS feed is a discovery mechanism, not a
        republication licence, however the policy field is set.
        """
        return self.content_policy == ContentPolicy.FULL_TEXT and self.licence in {
            SourceLicence.AGENCY_CONTRACT,
            SourceLicence.PUBLISHER_PARTNER,
            SourceLicence.PRESS_RELEASE,
            SourceLicence.GOVERNMENT,
            SourceLicence.CREATIVE_COMMONS,
            SourceLicence.OWN_NETWORK,
        }

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ContentSource {self.slug} {self.licence}>"


class IngestedItem(PKMixin, TimestampMixin, Base):
    """One entry pulled from a feed, before an editor decides what to do with it.

    Kept separate from `articles` on purpose: a fetch must never create
    reader-visible content by itself, and a queue an editor can reject is the
    difference between a newsroom tool and an unattended republication bot.
    """

    __tablename__ = "ingested_items"
    __table_args__ = (
        # The feed's own id is the primary dedup key; re-running a fetch must
        # not create a second copy of the same story.
        UniqueConstraint("source_id", "guid", name="uq_ingested_items_source_guid"),
        Index("ix_ingested_items_status_published", "status", "published_at"),
        Index("ix_ingested_items_content_hash", "content_hash"),
        Index("ix_ingested_items_rewrite_fetched", "rewrite_status", "fetched_at"),
        MYSQL_TABLE_ARGS,
    )

    source_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("content_sources.id", ondelete="CASCADE"), nullable=False
    )
    guid: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        doc="The feed entry's own id, or its URL when absent",
    )
    url: Mapped[str | None] = mapped_column(String(900), nullable=True)
    canonical_url: Mapped[str | None] = mapped_column(
        String(900),
        nullable=True,
        doc="Where the story really lives — always linked back to",
    )

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: NULL whenever the source's policy is not FULL_TEXT. The absence is the
    #: enforcement, not a flag somewhere else.
    content_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(900), nullable=True)
    language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    content_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        doc="sha256 of title+summary; catches the same story re-syndicated",
    )

    status: Mapped[IngestStatus] = mapped_column(
        Enum(IngestStatus, native_enum=False, length=16, validate_strings=True),
        nullable=False,
        default=IngestStatus.NEW,
        server_default=IngestStatus.NEW.name,
    )
    review_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    article_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="SET NULL"), nullable=True
    )

    # --- where the story happened ------------------------------------------
    # A *guess*, deliberately stored next to its method and confidence so the
    # queue can show its working and an editor can overrule it in one select.
    # Nothing downstream may treat this as an assignment.
    matched_mandal_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("mandals.id", ondelete="SET NULL"), nullable=True
    )
    matched_district_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("districts.id", ondelete="SET NULL"), nullable=True
    )
    mandal_match_method: Mapped[MandalMatchMethod] = mapped_column(
        Enum(MandalMatchMethod, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=MandalMatchMethod.NONE,
        server_default=MandalMatchMethod.NONE.name,
    )
    mandal_match_confidence: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, server_default="0"
    )

    # --- AI rewrite --------------------------------------------------------
    #: Our own pre-filter decided this needs a person: a sensitive subject, or
    #: something the model should not be asked to summarise. No provider call
    #: is made for these, which is the point — the guard has to run *before*
    #: the money is spent, not after.
    requires_human: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    rewrite_status: Mapped[RewriteStatus] = mapped_column(
        Enum(RewriteStatus, native_enum=False, length=16, validate_strings=True),
        nullable=False,
        default=RewriteStatus.NONE,
        server_default=RewriteStatus.NONE.name,
    )

    source: Mapped["ContentSource"] = relationship(lazy="joined")
    rewrites: Mapped[list["IngestedRewrite"]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
        order_by="IngestedRewrite.created_at.desc()",
    )

    @property
    def latest_rewrite(self) -> "IngestedRewrite | None":
        """The most recent attempt, ready or not. Ordering is on the
        relationship, so this does not issue a second query."""
        return self.rewrites[0] if self.rewrites else None

    @property
    def ready_rewrite(self) -> "IngestedRewrite | None":
        for rewrite in self.rewrites:
            if rewrite.status == RewriteStatus.READY:
                return rewrite
        return None

    def __repr__(self) -> str:  # pragma: no cover
        return f"<IngestedItem {self.id} {self.status} {self.title[:40]!r}>"


class IngestedRewrite(PKMixin, TimestampMixin, Base):
    """One attempt at turning somebody else's report into our own Telugu copy.

    A separate table rather than columns on `IngestedItem` because attempts
    have history: a refusal, then a retry after an editor loosened the source,
    then a success, are three rows an editor may want to see. And a separate
    table rather than `AiArticleDraft` because that model's `suggestion_id`
    and its whole `/cms/ai/drafts` surface assume the suggestion → draft →
    convert path. Hundreds of NULL-suggestion rows a day would have to be
    filtered out of every query on that screen.

    Nothing here is an article. It becomes one only when an editor presses
    Import, and even then it lands in review.
    """

    __tablename__ = "ingested_rewrites"
    __table_args__ = (
        Index("ix_ingested_rewrites_item_created", "item_id", "created_at"),
        Index("ix_ingested_rewrites_status_created", "status", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ingested_items.id", ondelete="CASCADE"), nullable=False
    )
    title_te: Mapped[str] = mapped_column(String(400), nullable=False)
    summary_te: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    body: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    body_plain: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Appended by the service, never taken from the model. A model asked to
    #: attribute will sometimes forget, and an unattributed rewrite of another
    #: publisher's reporting is the one output we must never produce.
    attribution_te: Mapped[str] = mapped_column(String(400), nullable=False, default="")
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    engine: Mapped[str] = mapped_column(
        String(60), nullable=False, default="heuristic", server_default="heuristic"
    )
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    confidence: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, server_default="0"
    )
    #: The model flagged a claim it could not stand behind. Surfaced to the
    #: editor; never silently dropped.
    unverified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    #: Token-set overlap with the source text, 0-100. Only meaningful when the
    #: source was already Telugu — see `crawl_service.similarity_percent`.
    similarity_percent: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    status: Mapped[RewriteStatus] = mapped_column(
        Enum(RewriteStatus, native_enum=False, length=16, validate_strings=True),
        nullable=False,
        default=RewriteStatus.READY,
        server_default=RewriteStatus.READY.name,
    )
    refusal_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    #: NULL means the hourly task produced it rather than a person.
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    item: Mapped["IngestedItem"] = relationship(back_populates="rewrites")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<IngestedRewrite {self.id} item={self.item_id} {self.status}>"
