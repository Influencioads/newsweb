from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ArticleType

# §1 asks for the full desk form. These are shared by the create and patch
# bodies; ArticlePatch differs only in that everything is optional, so the
# PATCH semantics stay "change exactly what was sent" (`exclude_unset`).


class ArticleWrite(BaseModel):
    title_te: str = Field(min_length=3, max_length=400)
    title_en: str | None = Field(default=None, max_length=400)
    sub_title_te: str | None = Field(default=None, max_length=500)
    summary_te: str | None = Field(default=None, max_length=1000)
    body: dict[str, Any] | None = None

    # placement
    category_id: int | None = None
    subcategory_id: int | None = None
    district_id: int | None = None
    mandal_id: int | None = None
    locality_id: int | None = None

    # media (§1: image, gallery, video)
    hero_media_id: int | None = None
    gallery_media_ids: list[int] | None = Field(default=None, max_length=40)
    video_id: int | None = None
    video_youtube_url: str | None = Field(
        default=None, max_length=300,
        description="Pasting a YouTube URL creates/reuses a Video row and links it.")

    # taxonomy
    tags: list[str] | None = Field(
        default=None, max_length=25,
        description="Tag names or slugs. Unknown names are created as topic tags.")

    # byline and provenance
    byline_te: str | None = Field(default=None, max_length=200)
    author_id: int | None = None
    source_type: str = Field(default="own", pattern=r"^(own|agency|contributed|syndicated)$")
    source_credit: str | None = Field(default=None, max_length=200)
    article_type: ArticleType | None = None

    # flags
    is_breaking: bool = False
    is_exclusive: bool = False
    is_featured: bool = False
    voice_enabled: bool = True

    # SEO (§1)
    slug: str | None = Field(default=None, max_length=180, pattern=r"^[a-z0-9][a-z0-9-]*$")
    seo_title: str | None = Field(default=None, max_length=200)
    seo_description: str | None = Field(default=None, max_length=400)
    canonical_url: str | None = Field(default=None, max_length=500)

    # timing (§1 publish date and time)
    scheduled_at: datetime | None = None
    expires_at: datetime | None = None
    breaking_until: datetime | None = None

    # §8 / §9 placement, chosen while writing. Applied when the story goes live.
    pin_home_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 7)
    pin_trending_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 7)


class ArticlePatch(BaseModel):
    title_te: str | None = Field(default=None, min_length=3, max_length=400)
    title_en: str | None = Field(default=None, max_length=400)
    sub_title_te: str | None = Field(default=None, max_length=500)
    summary_te: str | None = Field(default=None, max_length=1000)
    body: dict[str, Any] | None = None

    category_id: int | None = None
    subcategory_id: int | None = None
    district_id: int | None = None
    mandal_id: int | None = None
    locality_id: int | None = None

    hero_media_id: int | None = None
    gallery_media_ids: list[int] | None = Field(default=None, max_length=40)
    video_id: int | None = None
    video_youtube_url: str | None = Field(default=None, max_length=300)

    tags: list[str] | None = Field(default=None, max_length=25)

    byline_te: str | None = Field(default=None, max_length=200)
    author_id: int | None = None
    source_type: str | None = Field(default=None, pattern=r"^(own|agency|contributed|syndicated)$")
    source_credit: str | None = Field(default=None, max_length=200)
    article_type: ArticleType | None = None

    is_breaking: bool | None = None
    is_exclusive: bool | None = None
    is_featured: bool | None = None
    voice_enabled: bool | None = None

    slug: str | None = Field(default=None, max_length=180, pattern=r"^[a-z0-9][a-z0-9-]*$")
    seo_title: str | None = Field(default=None, max_length=200)
    seo_description: str | None = Field(default=None, max_length=400)
    canonical_url: str | None = Field(default=None, max_length=500)

    scheduled_at: datetime | None = None
    expires_at: datetime | None = None
    breaking_until: datetime | None = None

    # §8 / §9 placement, chosen while writing. Applied when the story goes live.
    pin_home_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 7)
    pin_trending_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 7)


class TransitionIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)
    #: `publish` accepts a future time, which schedules instead of publishing.
    scheduled_at: datetime | None = None


class CmsMediaRef(BaseModel):
    id: int
    url: str
    alt_te: str | None = None
    credit: str | None = None
    width: int | None = None
    height: int | None = None


class CmsVideoRef(BaseModel):
    id: int
    youtube_id: str
    title_te: str
    thumbnail_url: str


class CmsAudioRef(BaseModel):
    """§19 — whichever rendition the article currently uses, generated or
    uploaded. `provider == 'upload'` is a file an editor attached by hand."""

    id: int
    url: str | None
    mime: str
    duration_sec: int
    provider: str
    status: str


class CmsTagRef(BaseModel):
    id: int
    slug: str
    name_te: str
    name_en: str


class CmsArticleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    short_id: str
    slug: str
    title_te: str
    title_en: str | None
    sub_title_te: str | None = None
    summary_te: str | None
    body: dict[str, Any] | None
    category_id: int | None
    subcategory_id: int | None = None
    district_id: int | None
    mandal_id: int | None
    locality_id: int | None = None
    author_id: int | None
    byline_te: str | None
    source_type: str
    source_credit: str | None
    article_type: str = ArticleType.NORMAL.value
    status: str
    workflow_state: str
    is_breaking: bool
    is_exclusive: bool
    is_featured: bool = False
    voice_enabled: bool = True
    ai_generated: bool
    hero_media_id: int | None = None
    video_id: int | None = None
    audio_asset_id: int | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    canonical_url: str | None = None
    approved_by: int | None
    approved_at: datetime | None
    published_at: datetime | None
    scheduled_at: datetime | None = None
    expires_at: datetime | None = None
    breaking_until: datetime | None = None
    pin_home_minutes: int | None = None
    pin_trending_minutes: int | None = None
    updated_at: datetime

    # Resolved for the editor form; not columns.
    hero_media: CmsMediaRef | None = None
    gallery: list[CmsMediaRef] = []
    video: CmsVideoRef | None = None
    tags: list[CmsTagRef] = []
    audio: CmsAudioRef | None = None
    #: Live pins for this article, so the form shows what is actually running
    #: rather than only what was requested.
    active_pins: list[dict[str, Any]] = []


class PlacementIn(BaseModel):
    """§8 / §9 — set (or clear) the home and Top-trending pins for one article.

    Separate from ArticlePatch because a published article cannot be edited,
    but its placement very much can: the story leading the front page is a
    decision made *after* publication as often as before it.
    """

    pin_home_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 7)
    pin_trending_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 7)


class CmsArticleList(BaseModel):
    articles: list[CmsArticleOut]
    total: int


class DashboardStats(BaseModel):
    """§24 asks for 14 cards. The first seven are the editorial queue; the rest
    are audience and AI, which the dashboard previously did not show at all."""

    total_articles: int
    drafts: int
    pending_review: int
    approved: int
    published_today: int
    breaking_live: int
    returned_for_changes: int
    # §24 additions
    total_users: int = 0
    active_users_7d: int = 0
    views_today: int = 0
    submissions_pending: int = 0
    ai_suggestions_new: int = 0
    ai_drafts_pending: int = 0
    scheduled: int = 0
    top_categories: list[dict[str, Any]] = []
    top_districts: list[dict[str, Any]] = []
    top_mandals: list[dict[str, Any]] = []


class CmsOption(BaseModel):
    id: int
    slug: str
    name_te: str
    name_en: str


class CmsCategoryOption(CmsOption):
    parent_id: int | None = None


class CmsDistrictOption(CmsOption):
    state: str


class CmsEditorOptions(BaseModel):
    categories: list[CmsCategoryOption]
    districts: list[CmsDistrictOption]
    states: list[CmsOption] = []
    authors: list[dict[str, Any]] = []
    tags: list[CmsTagRef] = []
