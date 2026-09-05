"""Reader account schemas (updated doc §11) — profile and preferences."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.auth import LoginResponse
from app.schemas.public import DistrictOut, LocalityOut, MandalOut, StateOut


class ReaderLoginResponse(LoginResponse):
    is_new_account: bool = Field(
        description="True when this OTP verification just created the account"
    )


class PreferencesOut(BaseModel):
    language: str
    state: StateOut | None = None
    district: DistrictOut | None = None
    mandal: MandalOut | None = None
    locality: LocalityOut | None = None
    category_slugs: list[str] = Field(default_factory=list)
    notify_breaking: bool
    notify_local: bool
    notify_topics: bool


class PreferencesPatch(BaseModel):
    """Every field optional; an explicitly null location level clears it (and
    the levels beneath it — a mandal without its district is meaningless)."""

    language: str | None = Field(default=None, pattern=r"^(te|en)$")
    state_code: str | None = Field(default=None, max_length=2)
    district_slug: str | None = Field(default=None, max_length=80)
    mandal_slug: str | None = Field(default=None, max_length=80)
    locality_slug: str | None = Field(default=None, max_length=80)
    category_slugs: list[str] | None = Field(default=None, max_length=30)
    notify_breaking: bool | None = None
    notify_local: bool | None = None
    notify_topics: bool | None = None


class ReaderProfilePatch(BaseModel):
    name_te: str | None = Field(default=None, min_length=1, max_length=120)
    name_en: str | None = Field(default=None, min_length=1, max_length=120)
