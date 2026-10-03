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

import re
import time
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings as env_settings
from app.core.errors import ValidationError
from app.core.security import decrypt_secret, encrypt_secret
from app.integrations.ai import catalogue
from app.models.setting import AppSetting

_CACHE_TTL = 30.0
_cache: dict[str, Any] = {}
_cache_at: float = 0.0

#: What a `secret` setting looks like to anyone reading it back — the settings
#: screen, the audit log, the API response. The plaintext leaves this module
#: only through `get_secret`, which the provider adapters call.
_SECRET_MASK = "••••••••"


class _Unchanged(Exception):
    """Raised by `_coerce` for a secret the admin did not actually retype."""


class Spec:
    """One setting: its default, its type, and what it is for."""

    __slots__ = ("default", "kind", "description")

    def __init__(self, default: Any, kind: str, description: str) -> None:
        self.default, self.kind, self.description = default, kind, description


#: The sentinel `voice.voice_name` carries when no specific voice is chosen.
#: A `str` setting rejects the empty string, so the absence of a choice has to
#: be spelled. It lives here, beside the setting it belongs to, because this is
#: where it must be turned back into "no choice" before an adapter sees it.
DEFAULT_VOICE_SENTINEL = "default"

#: The complete, closed set of editable settings. A key not listed here cannot
#: be written — an unknown key is a typo or an injection attempt, never a
#: feature, and silently storing it would make the settings screen lie.
SPECS: dict[str, Spec] = {
    # --- §18 AI control -----------------------------------------------------
    "ai.enabled": Spec(
        False,
        "bool",
        "Master switch for every AI feature. Off means no provider is ever called.",
    ),
    "ai.auto_suggest": Spec(
        False,
        "bool",
        "Run the daily topic-discovery pass. Suggestions still need an editor.",
    ),
    "ai.provider": Spec(
        env_settings.AI_DEFAULT_PROVIDER,
        "str",
        "Which provider adapter to use: heuristic | gemini | openai | anthropic | aimlapi.",
    ),
    "ai.api_key": Spec(
        "",
        "secret",
        "API key for the selected provider, held encrypted. Set it here instead "
        "of in the deploy environment; a value here wins over the env var. "
        "Write-only: the screen shows whether a key is set, never the key.",
    ),
    "ai.base_url": Spec(
        "",
        "str_optional",
        "Override the provider's chat-completions endpoint. Only for the "
        "OpenAI-compatible adapters (aimlapi, openai). Blank uses the default.",
    ),
    "ai.model": Spec(
        catalogue.DEFAULT_TEXT_MODEL,
        "str_optional",
        "The EDITORIAL model: the one used where a human reads every word "
        "before a reader does — AI drafts and bulletin scripts. The default is "
        "deliberately not blank, so the best Telugu we measured is in use "
        "before an admin opens this screen, and so it beats a stale "
        "AIMLAPI_MODEL still exported by the deploy environment. Anything that "
        "runs by the hundred belongs on ai.bulk_model instead.",
    ),
    "ai.bulk_model": Spec(
        catalogue.DEFAULT_BULK_MODEL,
        "str_optional",
        "The high-volume model: the hourly crawl rewrite and the daily topic "
        "pass. It is a separate setting because volume changes the answer — at "
        "60 rewrites an hour the editorial model runs to about ₹34,000 a month "
        "against a ₹15,000 budget, and this one to about ₹6,100 for Telugu "
        "that measured just as correct on the same prompt.",
    ),
    "ai.daily_suggestion_limit": Spec(
        20, "int", "Maximum suggestions generated per day — the §18 cost ceiling."
    ),
    "ai.min_score": Spec(
        0.35, "float", "Suggestions scoring below this are not shown."
    ),
    "ai.image_enabled": Spec(
        False,
        "bool",
        "Allow generating an AI picture for a story: a realistic, "
        "representative scene labelled as AI — never the event or a real "
        "person, and never for a sensitive story. Off like every other "
        "spending switch: one image costs about twelve rewrites.",
    ),
    "ai.image_model": Spec(
        catalogue.DEFAULT_IMAGE_MODEL,
        "str_optional",
        "Which model makes that picture, and the picture on a news card. "
        "The default, GPT Image 2.5 Flare, measured a third of the price of "
        "1.5, with realistic, text-free photographs.",
    ),
    # --- §20 / §21 voice ----------------------------------------------------
    "voice.enabled": Spec(
        False,
        "bool",
        "Generate spoken audio with a TTS provider. Off hides the Listen button "
        "on stories that would have been synthesised; audio an editor uploaded "
        "by hand still plays, because it costs nothing to serve.",
    ),
    "voice.provider": Spec(
        "local", "str", "TTS adapter: local | google | bhashini | aimlapi | sarvam."
    ),
    "voice.api_key": Spec(
        "",
        "secret",
        "API key for the TTS provider, held encrypted. Blank falls back to the "
        "deploy environment. Write-only, like the AI key.",
    ),
    "voice.model": Spec(
        catalogue.DEFAULT_TTS_MODEL,
        "str_optional",
        "Speech model to use where the provider exposes a choice (aimlapi, "
        "sarvam). The default is the cheapest aimlapi model measured that "
        "returns a real MP3 — sixteen times cheaper than the next that "
        "worked. Sarvam's own ids carry a `sarvam/` prefix and are only "
        "meaningful when that provider is selected. Blank uses the adapter "
        "default.",
    ),
    "voice.language": Spec("te-IN", "str", "Synthesis language tag."),
    "voice.auto_generate_on_publish": Spec(
        True,
        "bool",
        "Attach audio to every story within five minutes of it publishing (and "
        "after an edit to a live story), instead of on the first listener's "
        "request. Each story is still generated once and then reused.",
    ),
    "voice.article_tts_enabled": Spec(
        True,
        "bool",
        "Allow generated article TTS. Per-article voice must also be enabled.",
    ),
    "voice.voice_name": Spec(
        "default",
        "str",
        "Provider voice id, or 'default' to let the adapter choose. Changing "
        "this does not re-render existing audio — use the Voice screen's "
        "regenerate, which is the only action that spends again.",
    ),
    "voice.speed": Spec(
        1.0,
        "float",
        "Speaking pace, 0.25 to 4.0 (1.0 is the voice's own). This is the only "
        "tone control aimlapi actually forwards — it silently accepts and "
        "drops every other field, so a slider for 'style' or 'instructions' "
        "would be a lie on this screen. A slightly slower pace, around 0.95, "
        "reads as a news bulletin rather than an advertisement; everything "
        "else about tone comes from the voice you pick. Ignored by models "
        "whose schema does not declare it, and clamped into range rather than "
        "rejected at the provider.",
    ),
    "voice.backfill_enabled": Spec(
        False,
        "bool",
        "Let the nightly job generate audio for recently published stories "
        "that have none. Stops at 90% of the monthly character budget.",
    ),
    # --- E-Paper / polls ----------------------------------------------------
    "epaper.enabled": Spec(True, "bool", "Show published E-Paper editions to readers."),
    "epaper.auto_generate": Spec(
        False, "bool", "Generate today's draft edition on schedule."
    ),
    "epaper.auto_generate_time": Spec(
        "05:00", "str", "Daily E-Paper draft generation time in Asia/Kolkata."
    ),
    "epaper.audio_enabled": Spec(
        False, "bool", "Expose the cached E-Paper audio playlist."
    ),
    "epaper.personalized_enabled": Spec(
        True, "bool", "Allow readers to save personalized editions."
    ),
    "epaper.page_count": Spec(
        8, "int", "Pages in a generated daily edition (1-24)."
    ),
    "polls.enabled": Spec(True, "bool", "Show active polls and accept votes."),
    "ai.research_enabled": Spec(
        False, "bool", "Allow licensed multi-source AI research."
    ),
    "voice.monthly_char_budget": Spec(
        2_000_000,
        "int",
        "Hard character ceiling per calendar month (§21). Generation stops at the limit.",
    ),
    # --- §35 feed balance ---------------------------------------------------
    "feed.ratios": Spec(
        {"personal": 40, "local": 25, "trending": 25, "breaking": 10},
        "ratios",
        "How the personalised feed is composed, in percent. Must total 100.",
    ),
    # --- §9 breaking --------------------------------------------------------
    "breaking.default_duration_minutes": Spec(
        1440,
        "int",
        "How long a breaking story stays in the ticker without an explicit end.",
    ),
    # --- §6 submissions -----------------------------------------------------
    "submissions.enabled": Spec(True, "bool", "Accept reader-submitted articles."),
    "submissions.require_phone_verification": Spec(
        True,
        "bool",
        "Require a verified phone number before a reader may submit. Defaults "
        "on because verification_service already documents this as the rule; "
        "the toggle exists so a launch-day problem is a setting, not a deploy.",
    ),
    "submissions.require_kyc": Spec(
        False,
        "bool",
        "Accept submissions only from verified contributors. Off by default — "
        "closing the door to unverified readers entirely is a policy decision, "
        "not a security default.",
    ),
    # --- citizen journalism -------------------------------------------------
    "kyc.enabled": Spec(True, "bool", "Accept contributor applications."),
    "kyc.provider": Spec(
        "manual",
        "str",
        "Who decides an application: 'manual' means a person in the admin "
        "queue. An unknown name falls back to manual rather than locking "
        "applicants out.",
    ),
    # --- branding -----------------------------------------------------------
    # Defaults are the designed palette (assets/index.css). While a colour sits
    # at its default the site renders the hand-tuned light and dark values; a
    # changed one has its shades and dark-mode variant derived in the browser.
    "brand.primary": Spec(
        "#0d47a1", "color", "Main brand colour: masthead, buttons, links, active tabs."
    ),
    "brand.breaking": Spec(
        "#be0a14", "color", "Breaking and urgent news: the ticker, Live and Breaking badges."
    ),
    "brand.accent": Spec(
        "#d0101a", "color", "Accent colour: Exclusive badges and highlights."
    ),
    # --- sharing ------------------------------------------------------------
    "share_card.enabled": Spec(
        True,
        "bool",
        "Render a WhatsApp share card for each story. Automatically inactive "
        "on a host whose Pillow cannot shape Telugu — see the deployment "
        "notes; readers then share text and a link, as before.",
    ),
    # --- push notifications -------------------------------------------------
    "push.enabled": Spec(
        True,
        "bool",
        "Send push notifications to phones through Expo. Off keeps the in-app "
        "inbox working and holds scheduled campaigns; anything published while "
        "it is off stays inbox-only, so switching back on never floods phones.",
    ),
    "push.expo_access_token": Spec(
        "",
        "secret",
        "Expo access token, held encrypted. Only needed when 'Enhanced push "
        "security' is on in the Expo project; blank sends without one. "
        "Write-only.",
    ),
    # --- audio bulletins, six a day ------------------------------------------
    "bulletin.enabled": Spec(
        False,
        "bool",
        "Produce and serve the six daily audio bulletins: each is recorded 15 "
        "minutes before its hour and airs on it, with no approval step — it "
        "is read only from stories an editor already published. Off stops the "
        "schedule and hides every bulletin, including ones already live — this "
        "is the emergency stop.",
    ),
    "bulletin.target_seconds": Spec(
        180, "int", "Target bulletin length in seconds."
    ),
    "bulletin.story_limit": Spec(
        8, "int", "Maximum stories read in one bulletin."
    ),
    # --- hourly crawl -------------------------------------------------------
    # Every default here is chosen so that applying the migration changes
    # nothing: the master switch is off, and every pre-existing source lands in
    # the GENERAL beat, whose quota is zero.
    "crawl.enabled": Spec(
        False,
        "bool",
        "Master switch for the hourly crawl. Off means no source is polled on "
        "a schedule and no provider is called.",
    ),
    "crawl.hourly_item_cap": Spec(
        60,
        "int",
        "How many stories may be sent to the AI rewrite in one hour, across "
        "every beat. This is the spend ceiling.",
    ),
    "crawl.beat_quota": Spec(
        {
            "general": 0,
            "national": 10,
            "state": 0,
            "district_local": 20,
            "breaking": 10,
            "sports": 6,
            "film": 8,
            "govt_jobs": 6,
        },
        "counts",
        "How the hourly cap is shared out between beats, as absolute counts. "
        "Unlike feed ratios these need not total anything — 'how many stories "
        "an hour' is a number, not a share.",
    ),
    "crawl.per_source_default_cap": Spec(
        8,
        "int",
        "Per-hour ceiling for a source that does not set its own. Stops one "
        "busy aggregator consuming a whole beat's quota.",
    ),
    "crawl.rewrite_enabled": Spec(
        False,
        "bool",
        "Run the Telugu AI rewrite. Off means the crawl only fills the review "
        "queue with headlines and links.",
    ),
    "crawl.rewrite_min_words": Spec(
        45,
        "int",
        "Items with less source text than this are never rewritten — there is "
        "nothing to rewrite, and a model asked anyway will invent.",
    ),
    "crawl.html_fallback_enabled": Spec(
        False,
        "bool",
        "Allow fetching the article page when a feed carries only a stub. The "
        "source must also permit it, and must carry a written licence note.",
    ),
    "crawl.keep_source_for_review": Spec(
        True,
        "bool",
        "Keep the fetched page text beside a rewrite so the reviewer can read "
        "the original next to it. Dropped the moment the item is imported or "
        "rejected. Off means the reviewer compares against the excerpt only.",
    ),
    "crawl.mandal_autotag": Spec(
        True,
        "bool",
        "Guess a mandal from the story text when the source has no default. "
        "Always a guess: the editor sees it with its confidence and can change it.",
    ),
    "crawl.mandal_min_name_len": Spec(
        4,
        "int",
        "Ignore gazetteer names shorter than this. Short Telugu place names "
        "are ordinary words as often as they are places.",
    ),
    "crawl.breaking_hourly_cap": Spec(
        20,
        "int",
        "Rewrites per hour for the breaking beat, which runs on its own faster "
        "schedule. Hourly breaking news is not breaking.",
    ),
    "crawl.open_licence_images": Spec(
        False,
        "bool",
        "When an imported story has no usable picture of its own, look for one "
        "on Wikimedia Commons. Only CC0/PDM images are used — the two licences "
        "that waive credit worldwide — and only a photo whose title names the "
        "story's person or place, captioned as a file photo. Nothing is generated "
        "and nothing is bought: if no such photo exists, and for most district "
        "stories none does, the story runs without one. Off means it never looks.",
    ),
    "crawl.auto_import": Spec(
        False,
        "bool",
        "Send every finished AI rewrite straight into the review queue, already "
        "filed by the AI — section, place, tags and a checked photo. An editor "
        "still approves and a second person still publishes. Keyless excerpt "
        "'rewrites' and copy with stray foreign letters are never sent. Off "
        "means an editor sends each one from the crawl queue by hand.",
    ),
    "crawl.image_scan": Spec(
        False,
        "bool",
        "Before a crawled photo is used, the AI looks at it and rejects any the "
        "publisher branded — a watermark, a channel logo, a headline burned in — "
        "and anything unfit to print. Rejected photos are never used and never "
        "cleaned. Costs a small AI call per photo checked. Off means the first "
        "photo that downloads is used, as before.",
    ),
    "crawl.image_scan_max": Spec(
        3,
        "int",
        "The most photos the AI checks for one story before giving up on the "
        "crawled ones.",
    ),
    "crawl.ai_illustrations": Spec(
        False,
        "bool",
        "When a crawled story has no usable photo and no free-licence one, the "
        "AI makes a realistic representative picture, labelled as AI on the "
        "site — never the event, a victim or a real person. Crime, death and "
        "accident stories get only a generic scene (an ambulance, a police "
        "cordon, a hospital gate); sensitive stories get none. Needs AI images "
        "switched on. Off means the story waits for the desk to add a photo.",
    ),
    "crawl.ai_illustration_daily_cap": Spec(
        20,
        "int",
        "The most AI pictures the crawl may make in one day. Each is a paid "
        "image; the cap keeps a quiet Commons day from spending the month.",
    ),
    "crawl.max_age_hours": Spec(
        18,
        "int",
        "Ignore feed entries older than this. A source that republishes its "
        "archive should not fill the queue with last month's news.",
    ),
    # Everything below defaults to what the crawl did before it was a setting:
    # round the clock, hourly, no daily ceiling, every district.
    "crawl.active_from_hour": Spec(
        0,
        "int",
        "First IST hour the crawl runs (0-23). With active_to_hour it may wrap "
        "past midnight: 22 to 6 means overnight only.",
    ),
    "crawl.active_to_hour": Spec(
        24,
        "int",
        "IST hour the crawl stops, exclusive (0-24; 0 and 24 both mean "
        "midnight). Equal to the start hour means round the clock.",
    ),
    "crawl.breaking_all_day": Spec(
        True,
        "bool",
        "Let the breaking beat run outside the crawl hours. News does not keep "
        "office hours.",
    ),
    "crawl.fetch_every_minutes": Spec(
        60,
        "int",
        "How often the fetch pass runs. A source is still only polled once its "
        "own interval has passed.",
    ),
    "crawl.rewrite_every_minutes": Spec(
        60,
        "int",
        "How often the rewrite pass runs. The hourly and daily caps still apply.",
    ),
    "crawl.daily_item_cap": Spec(
        0,
        "int",
        "Rewrites per IST day across every beat. 0 means no daily ceiling, only "
        "the hourly one.",
    ),
    "crawl.max_entries_per_fetch": Spec(
        50, "int", "The most entries read from one feed in one fetch."
    ),
    "crawl.max_consecutive_failures": Spec(
        8,
        "int",
        "A source failing this many times in a row is left alone until an "
        "admin fetches it by hand; hammering a broken endpoint is how you get "
        "blocked.",
    ),
    "crawl.districts": Spec(
        [],
        "ids",
        "District ids the crawl works for. Empty means every district. A story "
        "with no district is always kept — national news has none.",
    ),
    "crawl.similarity_block_percent": Spec(
        int(env_settings.AI_SIMILARITY_BLOCK_PERCENT or 0),
        "int",
        "Refuse a Telugu rewrite that shares this much wording with its source "
        "(0-100). 0 turns the check off.",
    ),
    "crawl.sensitive_extra_terms": Spec(
        [],
        "str_list",
        "Words or phrases that send a story to a person instead of the AI. "
        "They add to the built-in list and can never remove from it.",
    ),
}

#: The fetch/rewrite cadences on offer. Each divides a day evenly, so a pass
#: lands on the same clock minutes every day (see `crawl_service.cadence_due`).
CRAWL_CADENCE_MINUTES = [5, 10, 15, 20, 30, 60, 120]

#: Ranges for the int settings that have one. Only keys added with a range are
#: listed: bounding an older key would make a save fail on any install whose
#: stored value already sits outside it.
_INT_BOUNDS: dict[str, tuple[int, int]] = {
    "crawl.active_from_hour": (0, 23),
    "crawl.active_to_hour": (0, 24),
    "crawl.fetch_every_minutes": (5, 120),
    "crawl.rewrite_every_minutes": (5, 120),
    "crawl.daily_item_cap": (0, 5000),
    "crawl.max_entries_per_fetch": (1, 200),
    "crawl.max_consecutive_failures": (1, 100),
    "crawl.similarity_block_percent": (0, 100),
    "crawl.image_scan_max": (1, 4),
    "crawl.ai_illustration_daily_cap": (0, 500),
}


def _speech_choices(kind: str) -> list[dict[str, Any]]:
    """The speech models for `kind`, each carrying the voices it accepts and
    any bulletin presets it has.

    Attached per model rather than offered as one flat list because a voice
    belongs to a model: `alloy` on an ElevenLabs model is a 400 nobody can
    read, and a Sarvam v2 speaker on v3 is a 422. The screen can only show the
    right ones if the payload says which are right.
    """
    return [
        {
            **choice,
            "voices": list(catalogue.tts_voices(str(choice["id"]))),
            "presets": [asdict(p) for p in catalogue.voice_presets(str(choice["id"]))],
        }
        for choice in catalogue.choices_for(kind)
    ]


#: What the settings screen should offer for the keys where free text is a
#: trap: a model id nobody proof-reads becomes a 25-second timeout with no
#: message an editor can act on. `_coerce` still accepts any string for these —
#: the catalogue is a measured shortlist, not a whitelist, and an install that
#: needs a model we never tried must not be blocked by a dropdown.
_CHOICES: dict[str, list[Any]] = {
    "ai.model": catalogue.choices_for("text"),
    "ai.bulk_model": catalogue.choices_for("text"),
    "ai.image_model": catalogue.choices_for("image"),
    # One row, two vendors: the screen shows whichever list matches the
    # selected provider and the `sarvam/` prefix is what tells them apart.
    "voice.model": [
        *_speech_choices("tts"),
        *_speech_choices("tts_sarvam"),
    ],
    # Voices belong to a model and this list cannot see which model is
    # selected, so it offers the default model's. A leftover choice from
    # another vendor is repaired at call time by `catalogue.valid_voice`, not
    # here. The sentinel leads because it is the stored default and a screen
    # whose dropdown omits its own current value looks broken.
    "voice.voice_name": [
        DEFAULT_VOICE_SENTINEL,
        *catalogue.tts_voices(catalogue.DEFAULT_TTS_MODEL),
    ],
    # Unlike the model lists these are enforced by `_coerce`: any other
    # cadence would drift across the day instead of landing on the clock.
    "crawl.fetch_every_minutes": CRAWL_CADENCE_MINUTES,
    "crawl.rewrite_every_minutes": CRAWL_CADENCE_MINUTES,
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
    """Every setting, with secrets masked.

    This is what the settings screen renders and what the audit log records, so
    masking here rather than at each call site is deliberate: a new caller
    cannot forget to do it and leak a provider key.
    """
    values = dict(_load(db))
    for key, spec in SPECS.items():
        if spec.kind == "secret":
            values[key] = _SECRET_MASK if values.get(key) else ""
    return values


def is_secret(key: str) -> bool:
    """Whether `key` holds a secret — used by callers that log or echo values."""
    spec = SPECS.get(key)
    return bool(spec and spec.kind == "secret")


def masked_value(key: str, raw: Any) -> str:
    """What a secret's new value may be recorded as. Never the value itself."""
    if not is_secret(key):
        return raw
    return _SECRET_MASK if str(raw or "").strip() else ""


def secret_is_set(db: Session, key: str) -> bool:
    """Whether a secret has a value, without revealing it."""
    return bool(_load(db).get(key))


def get_secret(db: Session, key: str) -> str:
    """Decrypt a `secret` setting. Returns "" when unset.

    A stored value that will not decrypt (ENCRYPTION_KEY rotated under it) is
    treated as unset rather than raised: the caller then falls back to the env
    var, which is a working system with a stale key rather than a 500.
    """
    if SPECS[key].kind != "secret":
        raise KeyError(key)
    stored = _load(db).get(key)
    if not stored:
        return ""
    try:
        return decrypt_secret(str(stored))
    except RuntimeError:
        return ""


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
        low, high = _INT_BOUNDS.get(key, (0, value))
        if not low <= value <= high:
            raise ValidationError(details={key: f"must be {low}-{high}"})
        allowed = _CHOICES.get(key)
        if allowed is not None and value not in allowed:
            raise ValidationError(details={key: f"must be one of {allowed}"})
        return value
    if spec.kind == "ids":
        if not isinstance(value, list) or any(
            isinstance(v, bool) or not isinstance(v, int) or v <= 0 for v in value
        ):
            raise ValidationError(details={key: "must be a list of ids"})
        return sorted(set(value))[:500]
    if spec.kind == "str_list":
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise ValidationError(details={key: "must be a list of strings"})
        # Blank lines from a textarea are dropped rather than refused.
        terms = dict.fromkeys(v.strip()[:80] for v in value if v.strip())
        return list(terms)[:200]
    if spec.kind == "float":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValidationError(details={key: "must be a number"})
        return float(value)
    if spec.kind == "str":
        if not isinstance(value, str) or not value.strip():
            raise ValidationError(details={key: "must be a non-empty string"})
        return value.strip()[:120]
    if spec.kind == "color":
        # Only #rrggbb: it goes straight into a stylesheet on every page, so
        # anything looser is a CSS-injection hole, not a convenience.
        if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value.strip()):
            raise ValidationError(details={key: "must be a colour like #0d47a1"})
        return value.strip().lower()
    if spec.kind == "str_optional":
        # Same as `str` but blank is meaningful: it means "use the adapter
        # default" rather than "the admin forgot to fill this in".
        if not isinstance(value, str):
            raise ValidationError(details={key: "must be a string"})
        return value.strip()[:300]
    if spec.kind == "secret":
        # Stored encrypted at rest with the same Fernet key that protects KYC
        # documents. Blank clears it, which is how an admin revokes a key
        # without needing a deploy.
        if not isinstance(value, str):
            raise ValidationError(details={key: "must be a string"})
        raw = value.strip()
        if not raw:
            return ""
        if raw == _SECRET_MASK:
            # The screen round-trips the mask when the admin edits some other
            # field. Treat that as "leave it alone", never as "set the key to
            # eight bullet characters".
            raise _Unchanged()
        return encrypt_secret(raw[:400])
    if spec.kind == "counts":
        # Shaped like `ratios` but without the sum-to-100 rule: these are
        # absolute hourly counts, and forcing them to total anything would
        # mean changing one beat silently changes another.
        if not isinstance(value, dict):
            raise ValidationError(details={key: "must be an object of counts"})
        expected = set(SPECS[key].default)
        if set(value) != expected:
            raise ValidationError(
                details={key: f"must contain exactly {sorted(expected)}"}
            )
        counts: dict[str, int] = {}
        for name, number in value.items():
            if (
                isinstance(number, bool)
                or not isinstance(number, int)
                or not 0 <= number <= 500
            ):
                raise ValidationError(details={key: f"{name} must be 0-500"})
            counts[name] = number
        return counts
    if spec.kind == "ratios":
        if not isinstance(value, dict):
            raise ValidationError(details={key: "must be an object of percentages"})
        expected = set(SPECS[key].default)
        if set(value) != expected:
            raise ValidationError(
                details={key: f"must contain exactly {sorted(expected)}"}
            )
        clean: dict[str, int] = {}
        for name, pct in value.items():
            if isinstance(pct, bool) or not isinstance(pct, int) or not 0 <= pct <= 100:
                raise ValidationError(details={key: f"{name} must be 0-100"})
            clean[name] = pct
        if sum(clean.values()) != 100:
            raise ValidationError(details={key: "percentages must total 100"})
        return clean
    raise ValidationError(details={key: "unsupported setting type"})


def set_many(
    db: Session, changes: dict[str, Any], actor_id: int | None
) -> dict[str, Any]:
    """Write validated settings. Returns the full resolved set afterwards."""
    unknown = sorted(set(changes) - set(SPECS))
    if unknown:
        raise ValidationError(details={"keys": f"unknown settings: {unknown}"})

    rows = {
        r.key: r
        for r in db.scalars(
            select(AppSetting).where(AppSetting.key.in_(list(changes)))
        ).all()
    }
    for key, raw in changes.items():
        try:
            value = _coerce(key, raw)
        except _Unchanged:
            continue
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
    """Metadata for the admin screen so the UI need not hard-code the list.

    `choices` is the shortlist to render as a dropdown: measured model objects
    for the model settings, plain voice ids for `voice.voice_name`, and None
    wherever the value is genuinely free-form and the screen should show a box.
    `min`/`max` are present only for the keys `_coerce` bounds.
    """
    return [
        {
            "key": key,
            "kind": spec.kind,
            "default": spec.default,
            "description": spec.description,
            "choices": _CHOICES.get(key),
            "min": _INT_BOUNDS[key][0] if key in _INT_BOUNDS else None,
            "max": _INT_BOUNDS[key][1] if key in _INT_BOUNDS else None,
        }
        for key, spec in SPECS.items()
    ]


# --------------------------------------------------------------------------- #
# Convenience readers used across services
# --------------------------------------------------------------------------- #
def ai_credentials(db: Session, *, bulk: bool = False) -> dict[str, str]:
    """Everything `get_ai` needs, resolved from the editable settings.

    One place so the four call sites (topics, drafts, bulletin scripts, crawl
    rewrites) cannot drift apart — a key set in the CMS must reach all of them
    or an admin sees AI work on one screen and silently fall back on another.

    `bulk` is which of the two models that call site gets, and it is the
    difference between a ₹6,100 month and a ₹34,000 one. Bulk is for the work
    that runs unattended and by the hundred — the crawl rewrite, up to 60 an
    hour, and the daily topic pass, most of whose output an editor discards.
    The other two stay editorial: a draft and a bulletin script are eight or
    ten a day, and every word of them reaches a reader.
    """
    return {
        "provider": str(get(db, "ai.provider") or "heuristic").lower(),
        "api_key": get_secret(db, "ai.api_key"),
        "base_url": str(get(db, "ai.base_url") or ""),
        "model": str(get(db, "ai.bulk_model" if bulk else "ai.model") or ""),
    }


def image_credentials(db: Session) -> dict[str, str]:
    """The same four fields for `ai.image_model`.

    A separate reader rather than a third flag on `ai_credentials`: an image
    model is not substitutable for a text one, so a site handed the wrong one
    fails at the provider, late and billed, instead of at the call.
    """
    return {
        "provider": str(get(db, "ai.provider") or "heuristic").lower(),
        "api_key": get_secret(db, "ai.api_key"),
        "base_url": str(get(db, "ai.base_url") or ""),
        "model": str(get(db, "ai.image_model") or ""),
    }


def tts_credentials(db: Session) -> dict[str, str | float]:
    """Everything `get_tts` needs, resolved from the editable settings.

    `voice.api_key` falls back to `ai.api_key` because aimlapi issues one key
    for both text and speech: an admin who pasted it once on this screen should
    not have to paste it again three fields further down.

    `voice.voice_name` is resolved here rather than handed over raw. It carries
    `DEFAULT_VOICE_SENTINEL` when no voice was chosen, and an adapter falls
    back to its own default only on an empty string — so passing the sentinel
    through sent a provider the literal voice id "default" and every synthesis
    came back 400.
    """
    voice = str(get(db, "voice.voice_name") or "").strip()
    provider = str(get(db, "voice.provider") or "local").lower()
    key = get_secret(db, "voice.api_key")
    return {
        "provider": provider,
        # The fall back to the AI key is aimlapi's alone, because the reason
        # for it is aimlapi's alone: one account issues one key for text and
        # speech. Handing that key to Sarvam would be a 403 an admin reads as
        # "my Sarvam key is wrong" while the box they filled in is empty.
        "api_key": key or (get_secret(db, "ai.api_key") if provider == "aimlapi" else ""),
        # Same reasoning: `ai.base_url` points at the aimlapi account, so it is
        # only sent to the adapter that account belongs to.
        "base_url": str(get(db, "ai.base_url") or "") if provider == "aimlapi" else "",
        "model": str(get(db, "voice.model") or ""),
        "voice": "" if voice == DEFAULT_VOICE_SENTINEL else voice,
        # `voice.speed` has been on the settings screen, and in every adapter
        # signature, without ever being read — so the pace an editor set was
        # silently always 1.0. It is resolved here because this is the only
        # place that talks to `get_tts`.
        "speed": float(get(db, "voice.speed") or 1.0),
    }


def brand_colors(db: Session) -> dict[str, str]:
    """The brand colours an admin has changed, for `/public/config`.

    Defaults are left out so the browser keeps the hand-tuned palette (and its
    dark-mode values) for them, and so the defaults live only here.
    """
    changed = {}
    for name in ("primary", "breaking", "accent"):
        value = get(db, f"brand.{name}")
        if value != SPECS[f"brand.{name}"].default:
            changed[name] = str(value)
    return changed


def ai_enabled(db: Session) -> bool:
    """§18 — the environment must permit AI *and* an admin must have switched
    it on. Either being false means no provider call happens."""
    return bool(env_settings.AI_ENABLED) and get_bool(db, "ai.enabled")


def voice_enabled(db: Session) -> bool:
    """§20 global half of the switch."""
    return get_bool(db, "voice.enabled")


def bulletin_enabled(db: Session) -> bool:
    """The reader-facing half of the bulletin switch."""
    return get_bool(db, "bulletin.enabled")


def crawl_enabled(db: Session) -> bool:
    """Whether the hourly crawl may run at all."""
    return get_bool(db, "crawl.enabled")


def crawl_rewrite_enabled(db: Session) -> bool:
    """The rewrite needs the crawl on, AI permitted by the environment, and an
    admin to have switched AI on — three separate decisions, all required."""
    return crawl_enabled(db) and ai_enabled(db) and get_bool(db, "crawl.rewrite_enabled")


_IST = timezone(timedelta(hours=5, minutes=30))


def crawl_active_now(db: Session, now: datetime | None = None) -> bool:
    """Whether `now` is inside the admin's crawl hours, in IST.

    The window may wrap past midnight (22 to 6 is overnight). A start equal to
    the end — including the default 0 to 24 — is round the clock.
    """
    start = get_int(db, "crawl.active_from_hour") % 24
    end = get_int(db, "crawl.active_to_hour") % 24
    if start == end:
        return True
    hour = (now or datetime.now(timezone.utc)).astimezone(_IST).hour
    return start <= hour < end if start < end else (hour >= start or hour < end)


def crawl_districts(db: Session) -> set[int]:
    """The districts the crawl is limited to. Empty means all of them."""
    value = get(db, "crawl.districts")
    return {int(v) for v in value} if isinstance(value, list) else set()


def feed_ratios(db: Session) -> dict[str, int]:
    value = get(db, "feed.ratios")
    if not isinstance(value, dict):
        return dict(SPECS["feed.ratios"].default)
    return {k: int(v) for k, v in value.items()}
