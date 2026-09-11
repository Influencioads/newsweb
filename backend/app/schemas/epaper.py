from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, Field


class EpaperArticleOut(BaseModel):
    id: int
    short_id: str
    url: str
    title_te: str
    title_en: str | None = None
    summary_te: str | None = None
    hero_url: str | None = None
    category_slug: str | None = None
    is_breaking: bool = False
    audio_url: str | None = None
    position: int
    display_type: str


class EpaperPageOut(BaseModel):
    id: int
    page_number: int
    title: str
    layout_type: str
    share_url: str
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
    audio_enabled: bool = False
    published_at: datetime | None = None


class PageTemplateIn(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=100)
    title_te: str = Field(min_length=2, max_length=180)
    title_en: str = Field(min_length=2, max_length=180)
    sort: int = Field(default=0, ge=0, le=200)
    category_ids: list[int] = Field(default_factory=list, max_length=30)
    story_count: int = Field(default=6, ge=1, le=20)
    layout_type: Literal[
        "lead_grid", "two_column", "three_column", "image_lead", "briefs", "breaking"
    ] = "lead_grid"
    is_visible: bool = True


class GenerateEditionIn(BaseModel):
    edition_date: date | None = None


class PageUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=180)
    layout_type: str | None = Field(default=None, max_length=30)
    article_ids: list[int] | None = Field(default=None, max_length=20)
    poll_id: int | None = None


class PageCreateIn(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    layout_type: Literal[
        "lead_grid", "two_column", "three_column", "image_lead", "briefs", "breaking"
    ] = "lead_grid"
    article_ids: list[int] = Field(default_factory=list, max_length=20)
    poll_id: int | None = None


class PageOrderIn(BaseModel):
    page_ids: list[int] = Field(min_length=1, max_length=50)


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


class UserEditionOut(BaseModel):
    id: int
    name: str
    auto_generate: bool
    generation_time: time
    is_active: bool
    preferences: list[UserEditionPreferenceIn]
    latest_edition: EpaperEditionOut | None = None
