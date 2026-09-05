"""Engagement request/response schemas (Phase C)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import FollowTargetType
from app.schemas.public import ArticleCardOut


# ------------------------------------------------------------------ beacon --
class BeaconEventIn(BaseModel):
    short_id: str = Field(min_length=4, max_length=12)
    type: str = Field(description="view | read | scroll | share | not_interested")
    value: int | None = Field(
        default=None, ge=0, le=100_000, description="read: seconds · scroll: percent"
    )


class BeaconIn(BaseModel):
    anon_id: str | None = Field(
        default=None,
        max_length=64,
        description="Stable client-generated id for anonymous readers",
    )
    events: list[BeaconEventIn] = Field(min_length=1, max_length=20)


class BeaconOut(BaseModel):
    accepted: int


# ------------------------------------------------------------- interactions --
class EngagementCountsOut(BaseModel):
    like_count: int
    comment_count: int
    share_count: int


class MyArticleFlagsOut(BaseModel):
    liked: bool
    bookmarked: bool


class ReportIn(BaseModel):
    reason: str = Field(description="spam | abuse | misinformation | copyright | other")
    note: str | None = Field(default=None, max_length=500)


# ---------------------------------------------------------------- comments --
class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    parent_id: int | None = None


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    parent_id: int | None
    body: str
    author_name_te: str
    author_name_en: str
    is_mine: bool = False
    created_at: datetime


class CommentListOut(BaseModel):
    total_visible: int
    comments: list[CommentOut]


# ----------------------------------------------------------------- follows --
class FollowIn(BaseModel):
    target_type: FollowTargetType
    slug: str = Field(min_length=1, max_length=120)


class FollowOut(BaseModel):
    target_type: FollowTargetType
    slug: str
    name_te: str
    name_en: str


class FollowListOut(BaseModel):
    follows: list[FollowOut]


class FollowStateOut(BaseModel):
    following: bool


# ------------------------------------------------------------------ library --
class HistoryItemOut(BaseModel):
    article: ArticleCardOut
    seconds: int
    max_scroll_pct: int
    last_read_at: datetime


class HistoryOut(BaseModel):
    items: list[HistoryItemOut]
    next_offset: int | None = None


class BookmarksOut(BaseModel):
    articles: list[ArticleCardOut]
    next_offset: int | None = None


class FollowingFeedOut(BaseModel):
    articles: list[ArticleCardOut]
    next_offset: int | None = None
