"""Editable runtime settings (updated doc §18, §20, §35).

Every key has a default here. That is what makes the table additive: the
application behaves identically before a row exists, and an admin toggling a
switch is a row appearing, never a deploy.

Reads are hot — the home feed asks for the §35 ratios on every uncached
request — so values are memoised for `_CACHE_TTL` seconds. A write bumps the
row and clears the local cache; other workers pick the change up within the
TTL, which is the right trade for settings that change a few times a day.

Defaults are deliberately conservative: AI and voice both start **off**, so
deploying this code cannot start spending money at a provider. §18 and §20 both
require an explicit admin action, and this is where that is enforced.
"""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings as env_settings
from app.core.errors import ValidationError
from app.models.setting import AppSetting

_CACHE_TTL = 30.0
_cache: dict[str, Any] = {}
_cache_at: float = 0.0


class Spec:
    """One setting: its default, its type, and what it is for."""

    __slots__ = ("default", "kind", "description")

    def __init__(self, default: Any, kind: str, description: str) -> None:
        self.default, self.kind, self.description = default, kind, description


#: The complete, closed set of editable settings. A key not listed here cannot
#: be written — an unknown key is a typo or an injection attempt, never a
#: feature, and silently storing it would make the settings screen lie.
SPECS: dict[str, Spec] = {
    # --- §18 AI control -----------------------------------------------------
    "ai.enabled": Spec(
        False, "bool",
        "Master switch for every AI feature. Off means no provider is ever called."),
    "ai.auto_suggest": Spec(
        False, "bool",
        "Run the daily topic-discovery pass. Suggestions still need an editor."),
    "ai.provider": Spec(
        env_settings.AI_DEFAULT_PROVIDER, "str",
        "Which provider adapter to use: heuristic | gemini | openai | anthropic."),
    "ai.daily_suggestion_limit": Spec(
        20, "int", "Maximum suggestions generated per day — the §18 cost ceiling."),
    "ai.min_score": Spec(
        0.35, "float", "Suggestions scoring below this are not shown."),
    # --- §20 / §21 voice ----------------------------------------------------
    "voice.enabled": Spec(
        False, "bool",
        "Generate spoken audio with a TTS provider. Off hides the Listen button "
        "on stories that would have been synthesised; audio an editor uploaded "
        "by hand still plays, because it costs nothing to serve."),
    "voice.provider": Spec(
        "local", "str", "TTS adapter: local | google | bhashini."),
    "voice.language": Spec("te-IN", "str", "Synthesis language tag."),
    "voice.auto_generate_on_publish": Spec(
        False, "bool",
        "Generate audio the moment a story publishes, instead of on first request."),
    "voice.monthly_char_budget": Spec(
        2_000_000, "int",
        "Hard character ceiling per calendar month (§21). Generation stops at the limit."),
    # --- §35 feed balance ---------------------------------------------------
    "feed.ratios": Spec(
        {"personal": 40, "local": 25, "trending": 25, "breaking": 10}, "ratios",
        "How the personalised feed is composed, in percent. Must total 100."),
    # --- §9 breaking --------------------------------------------------------
    "breaking.default_duration_minutes": Spec(
        1440, "int", "How long a breaking story stays in the ticker without an explicit end."),
    # --- §6 submissions -----------------------------------------------------
    "submissions.enabled": Spec(
        True, "bool", "Accept reader-submitted articles."),
}


def _load(db: Session) -> dict[str, Any]:
    global _cache, _cache_at
    now = time.monotonic()
    if _cache and (now - _cache_at) < _CACHE_TTL:
        return _cache
    rows = db.scalars(select(AppSetting)).all()
    stored = {r.key: (r.value or {}).get("v") for r in rows if r.key in SPECS}
    _cache = {key: stored.get(key, spec.default) for key, spec in SPECS.items()}
    _cache_at = now
    return _cache


def invalidate() -> None:
    """Drop the local cache — called after a write, and by tests."""
    global _cache, _cache_at
    _cache, _cache_at = {}, 0.0


def all_settings(db: Session) -> dict[str, Any]:
    return dict(_load(db))


def get(db: Session, key: str) -> Any:
    if key not in SPECS:
        raise KeyError(key)
    return _load(db).get(key, SPECS[key].default)


def get_bool(db: Session, key: str) -> bool:
    return bool(get(db, key))


def get_int(db: Session, key: str) -> int:
    try:
        return int(get(db, key))
    except (TypeError, ValueError):
        return int(SPECS[key].default)


def _coerce(key: str, value: Any) -> Any:
    """Validate against the spec. A settings screen is an admin API, but it is
    still an API — a bad ratio block must fail here, not in the feed builder."""
    spec = SPECS[key]
    if spec.kind == "bool":
        if not isinstance(value, bool):
            raise ValidationError(details={key: "must be true or false"})
        return value
    if spec.kind == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValidationError(details={key: "must be a whole number"})
        if value < 0:
            raise ValidationError(details={key: "must not be negative"})
        return value
    if spec.kind == "float":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValidationError(details={key: "must be a number"})
        return float(value)
    if spec.kind == "str":
        if not isinstance(value, str) or not value.strip():
            raise ValidationError(details={key: "must be a non-empty string"})
        return value.strip()[:120]
    if spec.kind == "ratios":
        if not isinstance(value, dict):
            raise ValidationError(details={key: "must be an object of percentages"})
        expected = set(SPECS[key].default)
        if set(value) != expected:
            raise ValidationError(details={key: f"must contain exactly {sorted(expected)}"})
        clean: dict[str, int] = {}
        for name, pct in value.items():
            if isinstance(pct, bool) or not isinstance(pct, int) or not 0 <= pct <= 100:
                raise ValidationError(details={key: f"{name} must be 0-100"})
            clean[name] = pct
        if sum(clean.values()) != 100:
            raise ValidationError(details={key: "percentages must total 100"})
        return clean
    raise ValidationError(details={key: "unsupported setting type"})


def set_many(db: Session, changes: dict[str, Any], actor_id: int | None) -> dict[str, Any]:
    """Write validated settings. Returns the full resolved set afterwards."""
    unknown = sorted(set(changes) - set(SPECS))
    if unknown:
        raise ValidationError(details={"keys": f"unknown settings: {unknown}"})

    rows = {r.key: r for r in db.scalars(
        select(AppSetting).where(AppSetting.key.in_(list(changes)))).all()}
    for key, raw in changes.items():
        value = _coerce(key, raw)
        row = rows.get(key)
        if row is None:
            row = AppSetting(key=key, description=SPECS[key].description)
            db.add(row)
        row.value = {"v": value}
        row.updated_by = actor_id
    db.flush()
    invalidate()
    return all_settings(db)


def describe() -> list[dict[str, Any]]:
    """Metadata for the admin screen so the UI need not hard-code the list."""
    return [
        {"key": key, "kind": spec.kind, "default": spec.default,
         "description": spec.description}
        for key, spec in SPECS.items()
    ]


# --------------------------------------------------------------------------- #
# Convenience readers used across services
# --------------------------------------------------------------------------- #
def ai_enabled(db: Session) -> bool:
    """§18 — the environment must permit AI *and* an admin must have switched
    it on. Either being false means no provider call happens."""
    return bool(env_settings.AI_ENABLED) and get_bool(db, "ai.enabled")


def voice_enabled(db: Session) -> bool:
    """§20 global half of the switch."""
    return get_bool(db, "voice.enabled")


def feed_ratios(db: Session) -> dict[str, int]:
    value = get(db, "feed.ratios")
    if not isinstance(value, dict):
        return dict(SPECS["feed.ratios"].default)
    return {k: int(v) for k, v in value.items()}
