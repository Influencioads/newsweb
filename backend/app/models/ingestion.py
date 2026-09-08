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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin
from app.db.types import UTCDateTime
from app.models.enums import ContentPolicy, IngestStatus, SourceLicence


class ContentSource(PKMixin, TimestampMixin, Base):
    """A publisher or agency we ingest from (§17)."""

    __tablename__ = "content_sources"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_content_sources_slug"),
        Index("ix_content_sources_active_next", "is_active", "last_fetched_at"),
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
        Text, nullable=True,
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
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="te")

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
        MYSQL_TABLE_ARGS,
    )

    source_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("content_sources.id", ondelete="CASCADE"), nullable=False
    )
    guid: Mapped[str] = mapped_column(
        String(500), nullable=False, doc="The feed entry's own id, or its URL when absent"
    )
    url: Mapped[str | None] = mapped_column(String(900), nullable=True)
    canonical_url: Mapped[str | None] = mapped_column(
        String(900), nullable=True, doc="Where the story really lives — always linked back to"
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
        String(64), nullable=False, doc="sha256 of title+summary; catches the same story re-syndicated"
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

    source: Mapped["ContentSource"] = relationship(lazy="joined")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<IngestedItem {self.id} {self.status} {self.title[:40]!r}>"
