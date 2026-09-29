from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, Field

LayoutType = Literal[
    "lead_grid", "two_column", "three_column", "image_lead", "briefs", "breaking"
]


class SlotOut(BaseModel):
    index: int
    x: int
    y: int
    w: int
    h: int
    size: str


class EpaperArticleOut(BaseModel):
    id: int
    short_id: str
    url: str
    title_te: str
    title_en: str | None = None
    summary_te: str | None = None
    byline_te: str | None = None
    #: The story's district name, for the print dateline.
    dateline_te: str | None = None
    #: Body paragraphs for typesetting, capped (see `epaper_service.BODY_CHARS`).
    body: list[str] = []
    hero_url: str | None = None
    hero_caption_te: str | None = None
    hero_credit: str | None = None
    category_slug: str | None = None
    category_name_te: str | None = None
    is_breaking: bool = False
    audio_url: str | None = None
    position: int
    #: The slot this story sits in — `position - 1`.
    slot: int
    display_type: str
    #: Same value as `display_type`; the size vocabulary of `epaper_layouts`.
    size: str
    word_count: int = 0


class EpaperPageOut(BaseModel):
    id: int
    page_number: int
    title: str
    layout_type: str
    template_id: int | None = None
    share_url: str
    grid: dict[str, int] = Field(default_factory=lambda: {"cols": 6, "rows": 6})
    slots: list[SlotOut] = []
    articles: list[EpaperArticleOut]
    poll_id: int | None = None


class EpaperEditionOut(BaseModel):
    id: int
    title: str
    edition_date: date
    edition_type: str
    status: str
    revision: int
    page_count: int
    pages: list[EpaperPageOut] = []
    pdf_url: str | None = None
    pdf_status: str | None = None
    pdf_error: str | None = None
    audio_enabled: bool = False
    published_at: datetime | None = None


class PageTemplateIn(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=100)
    title_te: str = Field(min_length=2, max_length=180)
    title_en: str = Field(min_length=2, max_length=180)
    sort: int = Field(default=0, ge=0, le=200)
    category_ids: list[int] = Field(default_factory=list, max_length=30)
    layout_type: LayoutType = "lead_grid"
    is_visible: bool = True


class RegenerateIn(BaseModel):
    page_count: int | None = Field(default=None, ge=1, le=24)


class GenerateEditionIn(RegenerateIn):
    edition_date: date | None = None


class PageUpdateIn(BaseModel):
    """Every field is optional; a field left out is left alone.

    `article_ids` is aligned to the page's slots: index 0 is slot 0, `None` is
    an empty slot. The service checks the list against the layout's slot count.
    """

    title: str | None = Field(default=None, min_length=2, max_length=180)
    layout_type: LayoutType | None = None
    article_ids: list[int | None] | None = Field(default=None, max_length=15)
    poll_id: int | None = None


class PageCreateIn(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=180)
    layout_type: LayoutType | None = None
    template_id: int | None = None
    article_ids: list[int | None] = Field(default_factory=list, max_length=15)
    poll_id: int | None = None


class FillIn(BaseModel):
    reset: bool = False


class PageOrderIn(BaseModel):
    page_ids: list[int] = Field(min_length=1, max_length=50)


class CandidateOut(BaseModel):
    id: int
    short_id: str
    title_te: str
    title_en: str | None = None
    category_slug: str | None = None
    category_name_te: str | None = None
    word_count: int = 0
    has_hero: bool = False
    hero_url: str | None = None
    size: str
    is_breaking: bool = False
    is_featured: bool = False
    published_at: datetime | None = None
    #: The story belongs to the categories of the page being filled.
    in_section: bool = False


class TemplatePlanOut(BaseModel):
    slug: str
    title_te: str
    layout_type: str
    slot_count: int
    available: int


class PlanOut(BaseModel):
    edition_date: date
    candidates: int
    default_page_count: int
    suggested_page_count: int
    per_template: list[TemplatePlanOut]


PreferenceType = Literal["category", "district", "mandal", "tag"]


class UserEditionPreferenceIn(BaseModel):
    preference_type: PreferenceType
    target_id: int = Field(gt=0)
    priority: int = Field(default=0, ge=0, le=100)


class UserEditionIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    auto_generate: bool = True
    generation_time: time = time(6, 0)
    preferences: list[UserEditionPreferenceIn] = Field(min_length=1, max_length=30)
