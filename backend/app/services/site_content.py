"""Site content the desk edits from the CMS instead of the website code.

Two kinds, both kept in `app_settings` beside the other admin-edited rows
(outside settings_service.SPECS, so the Settings screen does not list them):

* **Blocks** — `content.<block>`: the logo and masthead line, the home banner
  tag, WOW Radio (its picture and segments), the Story Shots pictures, the
  nomination form's hero categories, and the grievance contact. Every block has a default here equal
  to what the website shipped with, so the site reads the same before anyone
  saves, and "Reset" simply deletes the row.
* **Footer pages** — `page.<slug>`: About, Contact, the policies. The website
  carries the original copy and shows it until a page is saved here; deleting
  the row goes back to it.

The WOW category cards (tagline, icon, listed) are columns on `categories`,
edited on the Taxonomy page; `ICONS` is the closed set their icon comes from.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError as PydanticError, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationError
from app.models.setting import AppSetting

#: Icon names the website and the CMS both know. Free text would let a typo
#: render an empty box, so the CMS offers this list and the API refuses others.
ICONS: tuple[str, ...] = (
    "medal", "flag", "sunrise", "rocket", "cpu", "briefcase", "map-pin",
    "gallery", "trending-up", "lightbulb", "telescope", "scroll", "ghost",
    "newspaper", "sparkles", "star", "heart", "trophy", "users", "globe",
    "book", "graduation-cap", "leaf", "music", "camera", "film", "mic",
    "landmark", "hand-heart", "sprout",
)

#: WOW Radio tile colours, named for the CMS; the website maps each to theme tokens.
RADIO_TONES: tuple[str, ...] = ("orange", "green", "blue", "purple")

#: The footer pages the website has a route for.
PAGE_SLUGS: tuple[str, ...] = (
    "about", "contact", "editorial-policy", "corrections", "grievance",
    "privacy", "terms", "ugc-terms", "ai-disclosure",
)

_SLUG = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
# Our own path (an upload is served from /media/...) or an https address.
# Quotes, spaces and angle brackets are refused: it lands in an <img src>.
_IMAGE_URL = re.compile(r"^(?:/[^\s\"'<>]*|https://[^\s\"'<>]+)$")
_EMAIL = re.compile(r"^[^@\s<>\"']+@[^@\s<>\"']+\.[^@\s<>\"']+$")


class _Block(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _image(value: str) -> str:
    if value and not _IMAGE_URL.fullmatch(value):
        raise ValueError("must be an uploaded picture (/media/...) or an https:// address")
    return value


class Brand(_Block):
    """The logo (blank: the built-in one) and the line under the masthead."""

    logo_url: str = Field(default="", max_length=500)
    tagline_te: str = Field(default="Ordinary People. Extraordinary Stories.", min_length=1, max_length=160)
    tagline_en: str = Field(default="Ordinary People. Extraordinary Stories.", min_length=1, max_length=160)

    @field_validator("logo_url")
    @classmethod
    def _logo(cls, v: str) -> str:
        return _image(v)


class Home(_Block):
    """The orange tag on the home banner."""

    banner_tag_te: str = Field(default="Every Story Has a WOW!", min_length=1, max_length=80)
    banner_tag_en: str = Field(default="Every Story Has a WOW!", min_length=1, max_length=80)


class RadioSegment(_Block):
    id: str = Field(min_length=2, max_length=40, pattern=_SLUG)
    te: str = Field(min_length=1, max_length=60)
    en: str = Field(min_length=1, max_length=60)
    tagline_te: str = Field(default="", max_length=120)
    tagline_en: str = Field(default="", max_length=120)
    icon: str = "sparkles"
    tone: str = "orange"
    #: Category slugs, tried in order; the first with stories is played.
    categories: list[str] = Field(min_length=1, max_length=10)

    @field_validator("icon")
    @classmethod
    def _known_icon(cls, v: str) -> str:
        if v not in ICONS:
            raise ValueError(f"must be one of {', '.join(ICONS)}")
        return v

    @field_validator("tone")
    @classmethod
    def _known_tone(cls, v: str) -> str:
        if v not in RADIO_TONES:
            raise ValueError(f"must be one of {', '.join(RADIO_TONES)}")
        return v

    @field_validator("categories")
    @classmethod
    def _slugs(cls, v: list[str]) -> list[str]:
        clean = list(dict.fromkeys(s.strip() for s in v if s.strip()))
        if not clean or any(not re.fullmatch(_SLUG, s) or len(s) > 80 for s in clean):
            raise ValueError("must be category slugs like morning-mantra")
        return clean


def _default_segments() -> list[RadioSegment]:
    return [
        RadioSegment(
            id="morning-mantra", te="మార్నింగ్ మంత్ర", en="Morning Mantra",
            tagline_te="రోజుకు సానుకూల ఆరంభం", tagline_en="A positive start to the day",
            icon="sunrise", tone="orange", categories=["morning-mantra", "devotional"],
        ),
        RadioSegment(
            id="spoorthi", te="స్ఫూర్తి", en="Spoorthi",
            tagline_te="హీరోల కథలు, విజయ గాథలు", tagline_en="Hero stories that inspire",
            icon="lightbulb", tone="green", categories=["real-heroes", "zero-to-hero", "inspiring"],
        ),
        RadioSegment(
            id="wow-news", te="వావ్ న్యూస్", en="WOW News",
            tagline_te="వావ్ అనిపించే వార్తలు", tagline_en="News that makes you say WOW",
            icon="newspaper", tone="blue",
            categories=["jai-telugoda", "business-guru", "wow-tech", "startup-stories", "wow-idea"],
        ),
        RadioSegment(
            id="mystery", te="మిస్టరీ", en="Mystery",
            tagline_te="వివరించలేని సంఘటనలు, రహస్యాలు", tagline_en="Unexplained events and secrets",
            icon="ghost", tone="purple", categories=["mystery", "wow-puranam"],
        ),
    ]


class Radio(_Block):
    """WOW Radio: the card picture (blank: the built-in one) and its segments."""

    image_url: str = Field(default="", max_length=500)
    segments: list[RadioSegment] = Field(default_factory=_default_segments, min_length=1, max_length=8)

    @field_validator("image_url")
    @classmethod
    def _img(cls, v: str) -> str:
        return _image(v)

    @field_validator("segments")
    @classmethod
    def _unique(cls, v: list[RadioSegment]) -> list[RadioSegment]:
        ids = [s.id for s in v]
        if len(set(ids)) != len(ids):
            raise ValueError("each segment needs its own id")
        return v


#: Story Shots kept at once; the deck shows them all, the home shelf the first four.
MAX_STORY_SHOTS = 40


class StoryShot(_Block):
    """One picture the desk uploads for Story Shots, with an optional headline
    (its accessible name and share text) and an optional "Read more" link."""

    id: str = Field(min_length=1, max_length=40, pattern=_SLUG)
    image_url: str = Field(min_length=1, max_length=500)
    title_te: str = Field(default="", max_length=160)
    title_en: str = Field(default="", max_length=160)
    link: str = Field(default="", max_length=500)

    @field_validator("image_url")
    @classmethod
    def _img(cls, v: str) -> str:
        return _image(v)

    @field_validator("link")
    @classmethod
    def _link(cls, v: str) -> str:
        # A page on this site (/...) or an https address, same rule as pictures.
        if v and not _IMAGE_URL.fullmatch(v):
            raise ValueError("must be a page on this site (/...) or an https:// address")
        return v


class StoryShots(_Block):
    """Story Shots pictures, in the order shown. Empty: the site falls back to
    the newest stories' photos so the shelf is never blank."""

    shots: list[StoryShot] = Field(default_factory=list, max_length=MAX_STORY_SHOTS)

    @field_validator("shots")
    @classmethod
    def _unique(cls, v: list[StoryShot]) -> list[StoryShot]:
        ids = [s.id for s in v]
        if len(set(ids)) != len(ids):
            raise ValueError("each shot needs its own id")
        return v


class HeroCategory(_Block):
    value: str = Field(min_length=2, max_length=40, pattern=_SLUG)
    te: str = Field(min_length=1, max_length=60)
    en: str = Field(min_length=1, max_length=60)


def _default_hero_categories() -> list[HeroCategory]:
    rows = (
        ("social-service", "సామాజిక సేవ", "Social Service"),
        ("education", "విద్య", "Education"),
        ("innovation", "ఆవిష్కరణ", "Innovation"),
        ("agriculture", "వ్యవసాయం", "Agriculture"),
        ("environment", "పర్యావరణం", "Environment"),
        ("youth", "యువ విజయం", "Youth Achievement"),
        ("other", "ఇతరాలు", "Other"),
    )
    return [HeroCategory(value=v, te=te, en=en) for v, te, en in rows]


class Nominate(_Block):
    """The hero categories offered on the Nominate form."""

    categories: list[HeroCategory] = Field(
        default_factory=_default_hero_categories, min_length=1, max_length=20
    )

    @field_validator("categories")
    @classmethod
    def _unique(cls, v: list[HeroCategory]) -> list[HeroCategory]:
        values = [c.value for c in v]
        if len(set(values)) != len(values):
            raise ValueError("each category needs its own value")
        return v


class Contact(_Block):
    """Where the "Email the Grievance Officer" button on every policy page goes."""

    grievance_email: str = Field(default="grievance@example.com", max_length=200)

    @field_validator("grievance_email")
    @classmethod
    def _email(cls, v: str) -> str:
        if not _EMAIL.fullmatch(v):
            raise ValueError("must be an email address")
        return v


BLOCKS: dict[str, type[_Block]] = {
    "brand": Brand,
    "home": Home,
    "radio": Radio,
    "story_shots": StoryShots,
    "nominate": Nominate,
    "contact": Contact,
}


# --------------------------------------------------------------------------- #
# footer pages
# --------------------------------------------------------------------------- #
class PageSection(_Block):
    id: str = Field(min_length=1, max_length=60, pattern=_SLUG)
    heading: str = Field(min_length=1, max_length=200)
    #: Paragraphs, shown in order.
    body: list[str] = Field(default_factory=list, max_length=40)

    @field_validator("body")
    @classmethod
    def _paragraphs(cls, v: list[str]) -> list[str]:
        clean = [p.strip() for p in v if p.strip()]
        if any(len(p) > 5000 for p in clean):
            raise ValueError("a paragraph may be at most 5000 characters")
        return clean


class PageLanguage(_Block):
    title: str = Field(min_length=1, max_length=120)
    sections: list[PageSection] = Field(default_factory=list, max_length=40)

    @field_validator("sections")
    @classmethod
    def _unique(cls, v: list[PageSection]) -> list[PageSection]:
        ids = [s.id for s in v]
        if len(set(ids)) != len(ids):
            raise ValueError("each section needs its own id")
        return v


class Page(_Block):
    te: PageLanguage
    en: PageLanguage


# --------------------------------------------------------------------------- #
# storage
# --------------------------------------------------------------------------- #
def _invalid(prefix: str, err: PydanticError) -> ValidationError:
    details = {
        ".".join([prefix, *(str(p) for p in e["loc"])]): e["msg"].removeprefix("Value error, ")
        for e in err.errors()
    }
    return ValidationError(
        message_en="Some of the content is not valid.",
        message_te="కొంత సమాచారం సరిగా లేదు.",
        details=details,
    )


def _rows(db: Session, prefix: str) -> dict[str, AppSetting]:
    rows = db.scalars(select(AppSetting).where(AppSetting.key.like(f"{prefix}%"))).all()
    return {r.key.removeprefix(prefix): r for r in rows}


def _stored(row: AppSetting | None) -> Any:
    return (row.value or {}).get("v") if row is not None else None


def blocks(db: Session) -> dict[str, dict[str, Any]]:
    """Every block, saved values over defaults. A stored block that no longer
    validates (a field renamed since) falls back to the default, never a 500."""
    rows = _rows(db, "content.")
    out: dict[str, dict[str, Any]] = {}
    for name, model in BLOCKS.items():
        stored = _stored(rows.get(name))
        try:
            out[name] = model.model_validate(stored or {}).model_dump()
        except PydanticError:
            out[name] = model().model_dump()
    return out


def admin_blocks(db: Session) -> dict[str, Any]:
    """What the Site content screen needs: values, defaults, which are saved."""
    rows = _rows(db, "content.")
    return {
        "values": blocks(db),
        "defaults": {name: model().model_dump() for name, model in BLOCKS.items()},
        "saved": sorted(name for name in BLOCKS if name in rows),
        "icons": list(ICONS),
        "radio_tones": list(RADIO_TONES),
    }


def save_block(db: Session, name: str, payload: Any, actor_id: int | None) -> dict[str, Any]:
    model = BLOCKS.get(name)
    if model is None:
        raise NotFoundError()
    try:
        value = model.model_validate(payload).model_dump()
    except PydanticError as err:
        raise _invalid(name, err) from err
    _write(db, f"content.{name}", value, actor_id)
    return value


def reset_block(db: Session, name: str) -> dict[str, Any]:
    model = BLOCKS.get(name)
    if model is None:
        raise NotFoundError()
    _delete(db, f"content.{name}")
    return model().model_dump()


def pages(db: Session) -> dict[str, dict[str, Any]]:
    """Saved footer pages by slug, each with when it was last saved."""
    out: dict[str, dict[str, Any]] = {}
    for slug, row in _rows(db, "page.").items():
        if slug not in PAGE_SLUGS:
            continue
        try:
            page = Page.model_validate(_stored(row)).model_dump()
        except PydanticError:
            continue
        out[slug] = {**page, "updated_at": _updated(row)}
    return out


def page(db: Session, slug: str) -> dict[str, Any] | None:
    return pages(db).get(slug) if slug in PAGE_SLUGS else None


def save_page(db: Session, slug: str, payload: Any, actor_id: int | None) -> dict[str, Any]:
    if slug not in PAGE_SLUGS:
        raise NotFoundError()
    try:
        value = Page.model_validate(payload).model_dump()
    except PydanticError as err:
        raise _invalid(slug, err) from err
    row = _write(db, f"page.{slug}", value, actor_id)
    return {**value, "updated_at": _updated(row)}


def reset_page(db: Session, slug: str) -> None:
    if slug not in PAGE_SLUGS:
        raise NotFoundError()
    _delete(db, f"page.{slug}")


def _updated(row: AppSetting) -> datetime | None:
    return row.updated_at or row.created_at


def _write(db: Session, key: str, value: Any, actor_id: int | None) -> AppSetting:
    row = db.scalar(select(AppSetting).where(AppSetting.key == key))
    if row is None:
        row = AppSetting(key=key, description="Edited from the CMS (site content)")
        db.add(row)
    row.value = {"v": value}
    row.updated_by = actor_id
    db.flush()
    return row


def _delete(db: Session, key: str) -> None:
    row = db.scalar(select(AppSetting).where(AppSetting.key == key))
    if row is not None:
        db.delete(row)
        db.flush()
