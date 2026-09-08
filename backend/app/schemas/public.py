"""Public (reader-facing) response schemas.

These are the only shapes an unauthenticated reader ever sees. Note what is
absent: no workflow state, no author email, no internal ids beyond what the URL
needs, no AI job id. A draft can never leak through these because the repository
filters on `status = PUBLISHED AND deleted_at IS NULL` before serialisation.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str | None = Field(description="Widest rendition — the <img src> fallback")
    srcset: str | None = Field(
        default=None,
        description=(
            "Responsive candidates at the §7.4 widths (400/800/1200/1600w) so the "
            "browser downloads only what the slot needs."
        ),
    )
    alt_te: str | None
    caption_te: str | None
    credit: str | None = Field(
        default=None,
        description="Attribution line, e.g. 'Creator / Wikimedia (CC BY 4.0)' (§12.5)",
    )
    license_label: str | None = Field(
        default=None, description="Licence under which the image is reused"
    )
    source_url: str | None = Field(
        default=None,
        description=(
            "Original landing page. CC-BY family licences require a link back "
            "to the source where practical."
        ),
    )
    width: int | None
    height: int | None
    blurhash: str | None = Field(
        default=None, description="Placeholder shown while the image loads (protects CLS)"
    )
    ai_generated: bool = Field(
        default=False,
        description="When true the UI must render the 'AI రూపొందించిన చిత్రం' label (§7.4)",
    )


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    name_te: str
    name_en: str


class DistrictOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    name_te: str
    name_en: str
    state: str


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    name_te: str
    type: str


class StateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    slug: str
    name_te: str
    name_en: str


class MandalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name_te: str
    name_en: str


class LocalityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name_te: str
    name_en: str
    kind: str


class LocationStateOut(StateOut):
    """One state with its districts — the location-selector tree (doc §4)."""

    districts: list[DistrictOut] = Field(default_factory=list)


class LocationsOut(BaseModel):
    states: list[LocationStateOut]


class AuthorOut(BaseModel):
    """§10.3 requires author as a Person with a real author page."""

    model_config = ConfigDict(from_attributes=True)

    name_te: str
    name_en: str
    author_slug: str | None
    designation_te: str | None


class ArticleCardOut(BaseModel):
    """Feed/card projection — deliberately small.

    §12.2 budgets the feed payload at "< 60 KB per 20 items", so the card shape
    carries no body and no tag list.
    """

    short_id: str
    slug: str
    url: str = Field(description="Canonical path: /{category}/{slug}-{short_id}")
    title_te: str
    title_en: str | None = Field(
        default=None,
        description=(
            "English headline. Null while a story is Telugu-only; the reader UI "
            "falls back to `title_te` rather than showing a blank."
        ),
    )
    summary_te: str | None
    category: CategoryOut | None
    district: DistrictOut | None
    hero: MediaOut | None
    byline_te: str | None
    is_breaking: bool
    is_exclusive: bool
    ai_generated: bool
    published_at: datetime | None
    reading_time_sec: int


class ArticleDetailOut(ArticleCardOut):
    """Full article for the reader page (mockup 1c)."""

    like_count: int = 0
    comment_count: int = 0
    share_count: int = 0
    sub_title_te: str | None
    body: dict[str, Any] | None = Field(
        description="Tiptap/ProseMirror JSON — the source of truth, rendered natively"
    )
    author: AuthorOut | None
    tags: list[TagOut]
    source_credit: str | None
    word_count: int
    updated_at: datetime | None
    corrected_at: datetime | None = Field(
        default=None, description="Drives the 'సవరించబడింది: {date}' line (§12.5)"
    )
    correction_note_te: str | None = None
    seo_title: str | None
    seo_description: str | None
    canonical_url: str | None
    gallery: list[MediaOut] = Field(
        default_factory=list,
        description="Additional photographs for this story, in editorial order",
    )
    related: list[ArticleCardOut] = Field(default_factory=list)


class BreakingItemOut(BaseModel):
    short_id: str
    title_te: str
    title_en: str | None = None
    url: str
    published_at: datetime | None


class HomeSectionOut(BaseModel):
    key: str
    title_te: str
    title_en: str | None = None
    articles: list[ArticleCardOut]


class EpaperTeaserOut(BaseModel):
    edition_slug: str
    pub_date: str
    thumb_url: str | None
    page_count: int


class HomeOut(BaseModel):
    """Everything the home page renders, in one request.

    A single round trip matters: §10.1 warns that a push to 200k devices means
    ~20k concurrent hits in 60 seconds, and each extra request multiplies that.

    The block set follows standard broadsheet structure — a lead, a mid column of
    section-kickered stories, a timestamped latest rail, and section blocks —
    because that is what a reader scanning a news front page expects to find.
    """

    edition: DistrictOut | None
    #: §3 — present only when the reader has chosen a mandal.
    mandal_block: HomeSectionOut | None = None
    lead: ArticleCardOut | None
    secondary: list[ArticleCardOut] = Field(
        default_factory=list, description="Thumb + headline rows under the lead"
    )
    mid_column: list[ArticleCardOut] = Field(
        default_factory=list,
        description="Dense centre column: section kicker + headline + byline",
    )
    briefs: list[ArticleCardOut] = Field(default_factory=list)
    latest: list[ArticleCardOut] = Field(
        default_factory=list, description="Right rail, newest first, with relative timestamps"
    )
    breaking: list[BreakingItemOut] = Field(default_factory=list)
    sections: list[HomeSectionOut] = Field(default_factory=list)
    epaper: EpaperTeaserOut | None = None
    generated_at: datetime


class CategoryFeedOut(BaseModel):
    category: CategoryOut | None
    district: DistrictOut | None
    articles: list[ArticleCardOut]
    next_cursor: str | None = Field(
        default=None, description="Opaque cursor for the next page (§13 cursor pagination)"
    )


class NavCategoryOut(CategoryOut):
    show_in_nav: bool


class SiteConfigOut(BaseModel):
    """Masthead, nav and footer data the shell needs on first paint."""

    site_name_te: str
    site_name_en: str
    categories: list[NavCategoryOut]
    states: list[StateOut] = Field(default_factory=list)
    districts: list[DistrictOut]


class SearchResultsOut(BaseModel):
    """Reader search response (updated doc §10)."""

    query: str
    total: int
    articles: list[ArticleCardOut]
    next_offset: int | None = Field(
        default=None, description="Pass back as `offset` for the next page; null when exhausted"
    )


class SearchMetaOut(BaseModel):
    popular: list[str] = Field(default_factory=list)
    recent: list[str] = Field(
        default_factory=list, description="Only populated for a signed-in reader"
    )


class LocalFeedOut(BaseModel):
    """Exact-location-first feed (updated doc §4)."""

    state: StateOut | None = None
    district: DistrictOut | None = None
    mandal: MandalOut | None = None
    locality: LocalityOut | None = None
    articles: list[ArticleCardOut]
    next_offset: int | None = None
