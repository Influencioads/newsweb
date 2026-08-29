from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ArticleWrite(BaseModel):
    title_te: str = Field(min_length=3, max_length=400)
    title_en: str | None = Field(default=None, max_length=400)
    sub_title_te: str | None = Field(default=None, max_length=500)
    summary_te: str | None = Field(default=None, max_length=1000)
    body: dict[str, Any] | None = None
    category_id: int | None = None
    district_id: int | None = None
    mandal_id: int | None = None
    byline_te: str | None = Field(default=None, max_length=200)
    source_type: str = "own"
    source_credit: str | None = Field(default=None, max_length=200)
    is_breaking: bool = False
    is_exclusive: bool = False


class ArticlePatch(BaseModel):
    title_te: str | None = Field(default=None, min_length=3, max_length=400)
    title_en: str | None = Field(default=None, max_length=400)
    sub_title_te: str | None = Field(default=None, max_length=500)
    summary_te: str | None = Field(default=None, max_length=1000)
    body: dict[str, Any] | None = None
    category_id: int | None = None
    district_id: int | None = None
    mandal_id: int | None = None
    byline_te: str | None = Field(default=None, max_length=200)
    source_type: str | None = None
    source_credit: str | None = Field(default=None, max_length=200)
    is_breaking: bool | None = None
    is_exclusive: bool | None = None


class TransitionIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class CmsArticleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    short_id: str
    slug: str
    title_te: str
    title_en: str | None
    summary_te: str | None
    body: dict[str, Any] | None
    category_id: int | None
    district_id: int | None
    mandal_id: int | None
    author_id: int | None
    byline_te: str | None
    source_type: str
    source_credit: str | None
    status: str
    workflow_state: str
    is_breaking: bool
    is_exclusive: bool
    ai_generated: bool
    approved_by: int | None
    approved_at: datetime | None
    published_at: datetime | None
    updated_at: datetime


class CmsArticleList(BaseModel):
    articles: list[CmsArticleOut]
    total: int


class DashboardStats(BaseModel):
    total_articles: int
    drafts: int
    pending_review: int
    approved: int
    published_today: int
    breaking_live: int
    returned_for_changes: int


class CmsOption(BaseModel):
    id: int
    slug: str
    name_te: str
    name_en: str


class CmsEditorOptions(BaseModel):
    categories: list[CmsOption]
    districts: list[CmsOption]
