"""Site configuration models — the admin-controlled homepage (updated doc §24)
and the search-query log (§10 "recent searches / popular searches").

`homepage_sections` exists so an admin can enable/disable a section, reorder it,
or change its article count without a frontend deployment: `GET /public/home`
reads this table (cached) when assembling its `sections` list. The fixed
broadsheet top (lead / secondary / mid column / briefs / latest rail) is layout,
not a section, and is not configurable here.
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
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin
from app.db.types import UTCDateTime
from app.models.enums import HomeSectionKind


class HomepageSection(PKMixin, TimestampMixin, Base):
    __tablename__ = "homepage_sections"
    __table_args__ = (
        UniqueConstraint("key", name="uq_homepage_sections_key"),
        Index("ix_homepage_sections_sort", "sort"),
        MYSQL_TABLE_ARGS,
    )

    key: Mapped[str] = mapped_column(
        String(80), nullable=False, doc="Stable identifier, e.g. 'cinema' or 'trending'"
    )
    kind: Mapped[HomeSectionKind] = mapped_column(
        Enum(HomeSectionKind, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=HomeSectionKind.CATEGORY,
    )
    category_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("categories.id", ondelete="CASCADE"),
        nullable=True,
        doc="Required when kind == CATEGORY",
    )
    #: Optional display overrides; NULL falls back to the category names.
    title_te: Mapped[str | None] = mapped_column(String(120), nullable=True)
    title_en: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    item_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=7,
        doc="Articles requested for this block (§24)",
    )
    #: A block with fewer live stories than this renders nothing rather than a
    #: broken-looking stub (same rule the hardcoded home used).
    min_items: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    category = relationship("Category", lazy="joined")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<HomepageSection {self.key} sort={self.sort}>"


class SearchQuery(PKMixin, Base):
    """Append-only search log (§10, §25 "search terms").

    Written fire-and-forget after a search responds; never on the query path.
    `normalized` is the lowercase/trimmed form popular-search grouping uses.
    """

    __tablename__ = "search_queries"
    __table_args__ = (
        Index("ix_search_queries_normalized_created_at", "normalized", "created_at"),
        Index("ix_search_queries_user_id_created_at", "user_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    query: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized: Mapped[str] = mapped_column(String(200), nullable=False)
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    results_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
