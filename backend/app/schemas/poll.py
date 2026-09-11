from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class PollOptionIn(BaseModel):
    option_text_te: str = Field(min_length=1, max_length=300)
    option_text_en: str | None = Field(default=None, max_length=300)


class PollIn(BaseModel):
    question_te: str = Field(min_length=3, max_length=500)
    question_en: str | None = Field(default=None, max_length=500)
    options: list[PollOptionIn] = Field(min_length=2, max_length=10)
    category_id: int | None = None
    district_id: int | None = None
    article_id: int | None = None
    start_time: datetime
    end_time: datetime
    is_big_question: bool = False

    @model_validator(mode="after")
    def dates_are_ordered(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class PollPatch(BaseModel):
    question_te: str | None = Field(default=None, min_length=3, max_length=500)
    question_en: str | None = Field(default=None, max_length=500)
    end_time: datetime | None = None
    status: str | None = Field(
        default=None, pattern=r"^(DRAFT|ACTIVE|STOPPED|DISABLED)$"
    )
    is_big_question: bool | None = None


class VoteIn(BaseModel):
    option_id: int
    anonymous_id: str | None = Field(default=None, min_length=16, max_length=64)


class PollOptionOut(BaseModel):
    id: int
    option_text_te: str
    option_text_en: str | None
    votes: int
    percentage: float


class PollOut(BaseModel):
    id: int
    question_te: str
    question_en: str | None
    status: str
    is_big_question: bool
    start_time: datetime
    end_time: datetime
    category_id: int | None
    district_id: int | None
    article_id: int | None
    total_votes: int
    has_voted: bool
    selected_option_id: int | None
    options: list[PollOptionOut]
