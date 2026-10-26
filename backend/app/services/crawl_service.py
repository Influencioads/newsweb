"""The hourly crawl: fetch, rewrite in Telugu, hand to an editor.

This is the pipeline the brief asks for — every mandal in both Telugu states
plus national, breaking, sports, film and government jobs, hourly, with volume
and sources controlled from the admin panel. Four decisions shape it:

**Quota governs the rewrite, not the fetch.** A conditional GET against a feed
costs nothing; a model call costs money and, more importantly, costs an editor
the time to read the result. So the hourly cap counts rewrites.

**Round-robin within each beat.** One busy national aggregator posting forty
items an hour will consume an entire sixty-item budget before a single district
story is looked at, and the dashboard will look perfectly healthy while local
coverage silently goes to zero. Sources take turns.

**The guards run before the money.** The sensitive-topic filter, the minimum
word count and the licence check all happen before a provider is called, not
after. Discovering that we should not have asked once the bill has arrived is
not a guard.

**Nothing here can publish.** A rewrite is a row in `ingested_rewrites`. It
becomes an article when an editor presses Import — or, with `crawl.auto_import`
on, when `auto_import_ready` sends it with no author — and lands in review
either way, where one person has to approve it and a *different* one publish.
That is enforced in `workflow_service`, and there is no path around it. The
AI's filing (section, place, tags, a *suggested* breaking flag) rides the
rewrite call and is checked against our own tables in `_classify`.
"""

from __future__ import annotations

import dataclasses
import re
import time
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings as env_settings
from app.core.errors import AiBudgetExceededError, AiProviderError
from app.core.logging import get_logger
from app.db.base import desc_nulls_last, utcnow
from app.db.seed_content import retired_category_slugs
from app.integrations.ai import get_ai, newsroom_style
from app.integrations.ai.base import AiProvider, RewriteText
from app.integrations.ai.sensitive import _matcher
from app.integrations.feeds import FeedResult, extract_article, fetch_feed
from app.integrations.feeds import images as feed_images
from app.models.content import Article, Category, Tag, TermGlossary
from app.models.enums import (
    ArticleType,
    IngestStatus,
    MandalMatchMethod,
    RewriteStatus,
    SourceBeat,
    TagType,
)
from app.models.geo import District, Mandal
from app.models.ingestion import ContentSource, IngestedItem, IngestedRewrite
from app.models.setting import AppSetting
from app.services import (
    ai_usage_service,
    gazetteer_service,
    ingestion_service,
    settings_service,
    tiptap,
)
from app.services.panchayat_service import PANCHAYAT_CATEGORY_SLUG
from app.services.social_card_service import _foreign_glyph
from app.telugu.normalize import normalize_headline, normalize_text
from app.telugu.transliterate import slugify

logger = get_logger(__name__)

#: Concurrent outbound fetches. The per-host floor is 2 s, so more threads only
#: help when sources span many hosts — and four simultaneous requests is a
#: polite ceiling for an aggregator to present to the wider web.
DEFAULT_WORKERS = 4

#: Ceiling on the reviewer's copy of the original. Long enough to read a story
#: against, short enough that the column is never an archive of someone else's
#: site.
MAX_SOURCE_TEXT_CHARS = 8_000

#: Subjects where a wrong or careless summary does real harm, and where Indian
#: reporting norms and the law both expect judgement. A hit here means a person
#: reads the item and no provider is called at all.
#:
#: Deliberately over-broad. A false positive costs one editor thirty seconds; a
#: false negative puts a machine summary of a communal incident, a sexual
#: assault or a child's identity in front of readers.
#:
#: Matched by `ai.sensitive._matcher`: a Telugu term must start a word and may
#: carry any ending, an English one is a whole word. So the Telugu set holds
#: stems cut before the vowel sign an inflection drops — `అత్యాచార` for
#: అత్యాచారానికి, `బాలుడ` for బాలుడి, `చిన్నారుల` for చిన్నారులు (not `చిన్నార`,
#: which starts చిన్నారెడ్డి) — and names the compounds whose sensitive half is
#: not their front (`ఉపకుల`, `నిమ్నకుల`, `పరమత`, `వరకట్నవేధింపు`). The
#: dictionary forms stay beside their stems because the assistant's
#: `_screen_topic` reads these sets as whole words. English is enumerated, not
#: suffixed: `rape\w*` would take "grape" back.
SENSITIVE_TE: frozenset[str] = frozenset(
    {
        "కులం", "కుల", "ఉపకుల", "అగ్రకుల", "నిమ్నకుల", "దళిత", "దళితుల", "ఎస్సీ", "ఎస్టీ", "బీసీ",
        "మతం", "మత", "మతపరమైన", "అన్యమత", "పరమత", "ముస్లిం", "హిందూ", "క్రైస్తవ",
        "మతఘర్షణ", "ఘర్షణలు", "ఘర్షణల", "అల్లర్లు", "అల్లర్ల",
        "అత్యాచారం", "అత్యాచార", "అఘాయిత్య", "రేప్", "లైంగిక", "వేధింపులు", "వేధింపు",
        "కట్నవేధింపు", "వరకట్నవేధింపు",
        "ఆత్మహత్య", "బలవన్మరణం", "బలవన్మరణ",
        "మైనర్", "పోక్సో", "బాలిక", "బాలుడు", "బాలుడ", "చిన్నారి", "చిన్నారుల",
    }
)
SENSITIVE_EN: frozenset[str] = frozenset(
    {
        "caste", "castes", "casteist", "casteism", "dalit", "dalits",
        "communal", "communally", "communalism",
        "riot", "riots", "rioted", "rioting", "rioters", "lynching", "lynched",
        "rape", "raped", "rapes", "raping", "rapist", "rapists",
        "gangrape", "gangrapes", "gangraped",
        "sexual assault", "sexual assaults", "sexually assaulted", "sexual abuse",
        "sexually abused", "sexual harassment", "sexually harassed",
        "molest", "molests", "molested", "molesting", "molester", "molesters", "molestation",
        "suicide", "suicides", "suicidal", "self-immolation",
        "minor girl", "minor girls", "minor boy", "minor boys", "juvenile", "juveniles", "pocso",
    }
)
# ponytail: `మత` still fronts మత్స్యకారులు (fishermen) and `బీసీ` fronts బీసీసీఐ;
# `_matcher` has no lookahead. Enumerate మతం/మతా/మతప… if the desk complains.
_SENSITIVE = _matcher(tuple(SENSITIVE_TE | SENSITIVE_EN))
_JOINERS = str.maketrans("", "", "\u200c\u200d")  # ZWNJ, ZWJ

_WORD = re.compile(r"[^\wఀ-౿]+", re.UNICODE)

#: One rewrite pass's wall clock. Past PASS_DEADLINE_S no new rewrite starts,
#: past IMPORT_DEADLINE_S no new automatic import, so the imports always get
#: some minutes; the task's 20-minute soft limit is the backstop behind both.
# ponytail: fixed numbers; tie them to the task's soft_time_limit if the
# cadence or the per-pass cap ever grows past what 12 minutes can rewrite.
PASS_DEADLINE_S = 12 * 60
IMPORT_DEADLINE_S = 17 * 60

#: Headline overlap (`similarity_percent`) at which a rewrite is taken for a
#: story already imported in the last DUPLICATE_WINDOW: two outlets' versions
#: of one press note must not become two articles in the review queue.
DUPLICATE_PERCENT = 60
DUPLICATE_WINDOW = timedelta(hours=6)
_DUPLICATE_NOTE = "likely duplicate of article #"
#: An automatic import that failed once is left for a person: trying again
#: every pass would pay for the same photo checks and drawing each time.
_FAILED_NOTE = "auto-import failed: "

#: Sections the model is never offered: the contributor desk, the columns, the
#: shop, and the districts hub (place is filed as district and mandal).
_NOT_OFFERED = frozenset({PANCHAYAT_CATEGORY_SLUG, "opinion", "best-deals", "districts"})

#: A tag is a name: Telugu or Latin letters, digits, spaces and hyphens (ZWJ /
#: ZWNJ are part of Telugu spelling). Stricter than `_foreign_glyph`.
_TAG_TEXT = re.compile(r"[ఀ-౿A-Za-z0-9 \-‌‍]{2,40}")
#: The types a model may create a tag under. A person, or a type we never
#: offered ("Person", "politician", none at all), is only ever an existing tag.
_CREATABLE_TAG_TYPES = frozenset(t.value for t in TagType) - {TagType.PERSON.value}
#: The offered types that say "not a place" (`_named_otherwise`). A type we
#: never offered — "location", "mandal", the template echoed back — says nothing.
_NOT_A_PLACE = frozenset(t.value for t in TagType) - {TagType.PLACE.value}
MAX_TAGS = 5


# --------------------------------------------------------------------------- #
# Switches
# --------------------------------------------------------------------------- #
def crawl_enabled(db: Session) -> bool:
    return settings_service.crawl_enabled(db)


def rewrite_enabled(db: Session) -> bool:
    return settings_service.crawl_rewrite_enabled(db)


# --------------------------------------------------------------------------- #
# Fetching
# --------------------------------------------------------------------------- #
def due_crawl_sources(
    db: Session, *, beats: set[SourceBeat] | None = None
) -> list[ContentSource]:
    """Sources due for a poll, optionally narrowed to some beats.

    With `crawl.districts` set, a source pinned to a district outside it is not
    polled at all. A source with no default district (national, film, a
    state-wide paper) is always polled; its items are filtered at rewrite time.
    """
    sources = ingestion_service.due_sources(db)
    districts = settings_service.crawl_districts(db)
    return [
        s
        for s in sources
        if (beats is None or s.beat in beats)
        and not (districts and s.default_district_id and s.default_district_id not in districts)
    ]


def fetch_many(
    db: Session, sources: list[ContentSource], *, workers: int = DEFAULT_WORKERS
) -> list[dict[str, Any]]:
    """Fetch every source concurrently, then apply the results serially.

    The threads do network only. A SQLAlchemy `Session` is not thread-safe, so
    every read and write happens on the calling thread after the network work
    has finished — the split that `ingestion_service.apply_result` exists for.

    Worth knowing: the Celery worker runs `--pool=solo`, so fanning this out as
    separate tasks would buy nothing at all; they would simply queue behind one
    another. The concurrency has to be inside the task, and a thread pool is
    right because this is pure blocking I/O, which releases the GIL.
    """
    if not sources:
        return []

    jobs = [(s.id, s.feed_url, s.etag, s.last_modified) for s in sources]
    # Read here, on the calling thread: the threads must not touch the session.
    limit = settings_service.get_int(db, "crawl.max_entries_per_fetch")
    results: dict[int, FeedResult] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers), thread_name_prefix="crawl") as pool:
        futures = {
            pool.submit(
                fetch_feed, url, etag=etag, last_modified=modified, limit=limit
            ): source_id
            for source_id, url, etag, modified in jobs
        }
        for future in as_completed(futures):
            source_id = futures[future]
            try:
                results[source_id] = future.result()
            except Exception as exc:  # noqa: BLE001 — fetch_feed should never raise
                logger.error("crawl_fetch_crashed", source_id=source_id, error=str(exc)[:200])
                results[source_id] = FeedResult(status="fetch_failed", error=str(exc)[:200])

    out: list[dict[str, Any]] = []
    for source in sources:
        result = results.get(source.id)
        if result is None:
            continue
        out.append(ingestion_service.apply_result(db, source, result))
    return out


# --------------------------------------------------------------------------- #
# The hourly quota
# --------------------------------------------------------------------------- #
IST = timezone(timedelta(hours=5, minutes=30))


def hour_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    """[top of the current IST hour, now), in UTC."""
    moment = (now or utcnow()).astimezone(IST)
    start = moment.replace(minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc), moment.astimezone(timezone.utc)


def day_start(now: datetime | None = None) -> datetime:
    """Midnight IST today, in UTC — the start of the daily cap's window."""
    moment = (now or utcnow()).astimezone(IST)
    return moment.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def last_due_tick(every_minutes: int, *, offset: int, now: datetime | None = None) -> datetime:
    """The latest clock position, at or before `now`, of a pass every `every_minutes`.

    `offset` keeps today's positions — fetch at :05, rewrite at :20 when
    hourly. Every allowed cadence divides a day, so the grid is the same daily.
    """
    every = max(5, int(every_minutes or 60))
    moment = (now or utcnow()).astimezone(IST)
    minute = moment.hour * 60 + moment.minute
    midnight = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    tick = midnight + timedelta(minutes=minute - (minute - offset) % every)
    return tick.astimezone(timezone.utc)


def claim_tick(
    db: Session, every_key: str, *, offset: int, now: datetime | None = None
) -> bool:
    """Whether the pass paced by `every_key` is due, marking it run if so.

    Beat fires both passes every five minutes; this is what spaces them out.
    Due means "has not run since its latest clock position", not "the clock
    is on it": the ingest worker runs one task at a time, so a fetch queued
    behind a long rewrite starts late, and a clock-only check dropped it hour
    after hour. The mark is an app_settings row outside SPECS (like
    `taxonomy.retired_slugs`), committed with the pass.
    """
    moment = now or utcnow()
    tick = last_due_tick(settings_service.get_int(db, every_key), offset=offset, now=moment)
    key = f"{every_key}.last_run"
    # ponytail: no row lock — one ingest worker (--concurrency=1) is the deploy;
    # a second consumer would need with_for_update() here.
    row = db.scalar(select(AppSetting).where(AppSetting.key == key))
    last = (row.value or {}).get("v") if row else None
    if last and datetime.fromisoformat(last) >= tick:
        return False
    if row is None:
        row = AppSetting(key=key, value={})
        db.add(row)
    row.value = {"v": moment.isoformat()}
    db.flush()
    return True


def rewrites_this_hour(db: Session, *, now: datetime | None = None) -> dict[str, int]:
    """Rewrites produced so far this hour, per beat."""
    return rewrites_since(db, hour_window(now)[0])


def rewrites_since(db: Session, start: datetime) -> dict[str, int]:
    """Rewrites produced since `start`, per beat.

    Counted from the rows rather than kept in a counter, so it survives a
    restart, cannot drift, and is the same number the status screen shows. A
    counter here would eventually disagree with reality and nobody would know
    which was right.
    """
    rows = db.execute(
        select(ContentSource.beat, func.count(IngestedRewrite.id))
        .join(IngestedItem, IngestedRewrite.item_id == IngestedItem.id)
        .join(ContentSource, IngestedItem.source_id == ContentSource.id)
        .where(IngestedRewrite.created_at >= start)
        .group_by(ContentSource.beat)
    ).all()
    used = {beat.value: 0 for beat in SourceBeat}
    for beat, count in rows:
        key = beat.value if isinstance(beat, SourceBeat) else str(beat)
        used[key] = int(count or 0)
    return used


def rewrites_per_source_since(db: Session, start: datetime) -> dict[int, int]:
    """Rewrites produced since `start`, per source — what the per-source cap spends."""
    rows = db.execute(
        select(IngestedItem.source_id, func.count(IngestedRewrite.id))
        .select_from(IngestedRewrite)
        .join(IngestedItem, IngestedRewrite.item_id == IngestedItem.id)
        .where(IngestedRewrite.created_at >= start)
        .group_by(IngestedItem.source_id)
    ).all()
    return {int(source_id): int(count or 0) for source_id, count in rows}


def _beat_quota(db: Session) -> dict[str, int]:
    raw = settings_service.get(db, "crawl.beat_quota")
    default = dict(settings_service.SPECS["crawl.beat_quota"].default)
    if not isinstance(raw, dict):
        return default
    return {key: int(raw.get(key, default.get(key, 0))) for key in default}


def select_for_rewrite(
    db: Session,
    *,
    cap: int,
    beat_quota: dict[str, int],
    default_source_cap: int,
    beats: set[SourceBeat] | None = None,
    max_age_hours: int = 18,
    daily_cap: int = 0,
    global_cap: int | None = None,
    districts: Iterable[int] = (),
    now: datetime | None = None,
) -> list[IngestedItem]:
    """Choose which queued items get rewritten this hour.

    Round-robin across the sources within a beat is the part that matters. Take
    items in pure recency order instead and a single high-volume feed fills the
    budget every hour; district coverage drops to nothing and the symptom looks
    exactly like the feature working.

    `cap` is measured against the beats being selected only. The breaking pass
    has its own cap; counting the hourly pass's rewrites against it stopped
    breaking news for the rest of the hour once the :20 pass had run.
    `global_cap` (the hourly spend ceiling) and `daily_cap` (0 = none) count
    every beat. The per-source cap is per IST hour too, not per pass — with a
    rewrite every 15 minutes a busy feed would otherwise take a whole beat.
    """
    used = rewrites_this_hour(db, now=now)
    wanted = None if beats is None else {b.value for b in beats}
    total_used = sum(n for key, n in used.items() if wanted is None or key in wanted)
    room_total = cap - total_used
    if global_cap is not None:
        room_total = min(room_total, global_cap - sum(used.values()))
    if daily_cap > 0:
        used_today = sum(rewrites_since(db, day_start(now)).values())
        room_total = min(room_total, daily_cap - used_today)
    if room_total <= 0:
        return []

    cutoff = (now or utcnow()) - timedelta(hours=max(1, max_age_hours))
    districts = list(districts)

    query = (
        select(IngestedItem)
        .join(ContentSource, IngestedItem.source_id == ContentSource.id)
        .where(
            IngestedItem.status == IngestStatus.NEW,
            IngestedItem.rewrite_status == RewriteStatus.NONE,
            IngestedItem.requires_human.is_(False),
            IngestedItem.fetched_at >= cutoff,
            # A feed that republishes its archive gets a fresh fetched_at on
            # every entry; the publisher's own date is the one that says old.
            or_(IngestedItem.published_at.is_(None), IngestedItem.published_at >= cutoff),
            ContentSource.is_active.is_(True),
            ContentSource.rewrite_enabled.is_(True),
        )
        .order_by(*desc_nulls_last(IngestedItem.published_at), IngestedItem.id.desc())
    )
    if beats is not None:
        query = query.where(ContentSource.beat.in_(list(beats)))
    if districts:
        # No district is national, state-wide or unplaced news — keep it.
        query = query.where(
            or_(
                IngestedItem.matched_district_id.is_(None),
                IngestedItem.matched_district_id.in_(districts),
            )
        )

    candidates = list(db.scalars(query).all())
    if not candidates:
        return []

    # Bucket by beat, then by source, preserving recency inside each bucket.
    by_beat: dict[str, dict[int, list[IngestedItem]]] = {}
    for item in candidates:
        source = item.source
        if source is None:
            continue
        by_beat.setdefault(source.beat.value, {}).setdefault(source.id, []).append(item)

    chosen: list[IngestedItem] = []
    per_source_taken = rewrites_per_source_since(db, hour_window(now)[0])
    for beat_key, sources in by_beat.items():
        beat_room = max(0, int(beat_quota.get(beat_key, 0)) - used.get(beat_key, 0))
        if beat_room <= 0:
            continue

        queues = {sid: list(items) for sid, items in sources.items()}
        while beat_room > 0 and room_total > 0 and any(queues.values()):
            progressed = False
            for source_id in list(queues):
                if beat_room <= 0 or room_total <= 0:
                    break
                queue = queues[source_id]
                if not queue:
                    continue
                source = queue[0].source
                source_cap = source.max_items_per_hour or default_source_cap
                if per_source_taken.get(source_id, 0) >= max(1, source_cap):
                    queues[source_id] = []
                    continue
                item = queue.pop(0)
                chosen.append(item)
                per_source_taken[source_id] = per_source_taken.get(source_id, 0) + 1
                beat_room -= 1
                room_total -= 1
                progressed = True
            if not progressed:
                break
    return chosen


# --------------------------------------------------------------------------- #
# Guards
# --------------------------------------------------------------------------- #
def is_sensitive(text: str, extra: Iterable[str] = ()) -> bool:
    """Whether this item must be read by a person rather than a model.

    `extra` is `crawl.sensitive_extra_terms`: an admin can widen the net, never
    narrow it — the built-in lists are always checked first, and an extra term
    is still a bare substring, as broad as the admin typed it.

    The built-in lists used to be bare substrings too, and measured on the
    1,157 items ingested by 2026-09-30 that fired on `కుల` inside ప్రయాణికులు,
    ప్రేక్షకులు and every other -కులు plural, on `ఎస్సీ` inside డీఎస్సీ, on
    `మత` inside అనుమతి — while a whole dictionary form missed its own
    inflections (బాలుడు, not బాలుడి). Word-start stems fix both.

    Joiners go first: a live outlet spells ఆత్మ‌హ‌త్య with a ZWNJ after each
    syllable (#320, 2026-09-30), which no term matches.
    """
    lowered = normalize_text(text or "").casefold().translate(_JOINERS)
    if _SENSITIVE.search(lowered):
        return True
    return any(
        term and normalize_text(term).casefold().translate(_JOINERS) in lowered
        for term in extra
    )


def similarity_percent(rewritten: str, original: str) -> int:
    """Token-set overlap of the rewrite with its source, 0-100.

    Only meaningful when the source was already Telugu. A Telugu rewrite of an
    English report shares almost no tokens with it however closely it tracks
    the original, so scoring those would produce a number that looks like
    safety and measures nothing. Callers apply this only for Telugu sources.
    """
    left = {w for w in _WORD.split(normalize_text(rewritten or "").casefold()) if len(w) > 2}
    right = {w for w in _WORD.split(normalize_text(original or "").casefold()) if len(w) > 2}
    if not left or not right:
        return 0
    return round(len(left & right) * 100 / len(left | right))


# --------------------------------------------------------------------------- #
# Source text
# --------------------------------------------------------------------------- #
def _host_allowed(url: str) -> bool:
    """Honour `AI_ALLOWED_SOURCE_FEEDS` for page fetches too.

    `ai_service` already filters its sources by this list and ingestion never
    did — the same policy enforced in one place and ignored in another is worse
    than not having it, so the page fetch respects it.
    """
    allow = (env_settings.AI_ALLOWED_SOURCE_FEEDS or "").replace("\n", ",")
    hosts = [h.strip().lower() for h in allow.split(",") if h.strip()]
    if not hosts:
        return True
    from urllib.parse import urlparse

    netloc = (urlparse(url).netloc or "").lower()
    return any(netloc == h or netloc.endswith("." + h) for h in hosts)


def gather_source_text(db: Session, item: IngestedItem) -> tuple[str, str, str | None]:
    """The text to rewrite from, how it was obtained, and the reviewer's copy.

    The licence decides what survives this call:

      * a full-text licence means the extracted body is *stored* on the item,
        exactly as feed-supplied content already is;
      * anything else means the text is used to build the prompt and then
        dropped. Nothing beyond the existing excerpt is ever written to
        `IngestedItem`. A field that exists is a field that leaks, which is the
        rule this whole module inherits from `ingestion_service`.

    The third return value is the one exception, and it is a narrow one. A
    reviewer cannot honestly verify a Telugu rewrite against forty words of
    feed stub — the approval becomes theatre — so when a page was actually
    fetched the working copy is handed back for `IngestedRewrite.source_text`.
    That column is defensible where `content_html` would not be: it lives on a
    queue-only table no public serializer touches, whereas `_body_document`
    *can* publish `content_html` verbatim. It is held inside the newsroom for
    the duration of one review and NULLed on import or reject. Reaching here
    at all requires `allow_html_fallback`, which `_guard_licence` only grants
    against a written `licence_note` — so we only ever hold text for a
    publisher an admin has recorded a reason for. `crawl.keep_source_for_review`
    switches it off without a deploy.
    """
    source = item.source
    stored = ingestion_service.strip_html(item.content_html) if item.content_html else ""
    base = "\n\n".join(p for p in (item.title, item.summary or "", stored) if p).strip()

    # The same floor `rewrite_one` applies, so "enough text" means one thing.
    if len(base.split()) >= max(10, settings_service.get_int(db, "crawl.rewrite_min_words")):
        return base, "feed", None

    if not (source and source.allow_html_fallback):
        return base, "feed", None
    if not settings_service.get_bool(db, "crawl.html_fallback_enabled"):
        return base, "feed", None
    target = item.canonical_url or item.url
    if not target or not _host_allowed(target):
        return base, "feed", None

    page = extract_article(target)
    if page.status != "ok" or not page.text:
        return base, f"page_{page.status}", None

    if source.may_store_full_text:
        item.content_html = ingestion_service.sanitise_body(
            "".join(f"<p>{p}</p>" for p in page.text.split("\n\n") if p.strip())
        ) or None
        item.word_count = page.word_count
    # else: page.text stays in this function's locals and is never persisted.

    # og:image and the JSON-LD image are the single richest source of publisher
    # logos, and this path used to write them straight onto the item — past
    # every rule in `feeds.images`, which `_attach_media` then trusted. Filter
    # here or the host rule is decorative.
    #
    # This sits OUTSIDE the full-text branch on purpose. A picture is not an
    # excerpt of a text: `_attach_media` already gives an excerpt-only source
    # exactly one credited hero and breaks before the gallery, which is the
    # licence rule for images. Nesting the capture inside `may_store_full_text`
    # meant every RSS_PUBLIC source — which is all of them — silently got no
    # picture at all, however the admin set `images_enabled`.
    if not item.image_url:
        publisher = feed_images.publisher_url(
            source.homepage_url, source.feed_url, item.url
        )
        usable = feed_images.pick(
            page.image_urls or ([page.image_url] if page.image_url else []),
            article_url=publisher,
            logo_url=source.logo_url,
        )
        if usable:
            item.image_url = usable[0]
            item.image_urls = usable

    combined = "\n\n".join(p for p in (item.title, page.text) if p).strip()
    keep = (
        combined[:MAX_SOURCE_TEXT_CHARS]
        if settings_service.get_bool(db, "crawl.keep_source_for_review")
        else None
    )
    return combined, f"page_{page.method}", keep


# --------------------------------------------------------------------------- #
# The filing — where the model says a story belongs, checked against our tables
# --------------------------------------------------------------------------- #
def _taxonomy(db: Session) -> dict[str, Any]:
    """What the model may file a story under, read live from our own tables.

    Active top-level sections in the nav (less `_NOT_OFFERED` and the slugs an
    admin retired) with their active children, and the active AP/TS districts
    — the shape `AiProvider.rewrite_item(taxonomy=...)` documents, plus ids for
    `_classify`. A pass builds it once; a single rewrite builds its own.
    """
    skip = _NOT_OFFERED | set(retired_category_slugs(db))
    rows = db.scalars(
        select(Category)
        .where(Category.is_active.is_(True))
        .order_by(Category.sort, Category.id)
    ).all()

    def entry(cat: Category) -> dict[str, Any]:
        return {"id": cat.id, "slug": cat.slug, "name": cat.name_en}

    categories = [
        {
            **entry(top),
            "children": [entry(c) for c in rows if c.parent_id == top.id and c.slug not in skip],
        }
        for top in rows
        if top.parent_id is None and top.show_in_nav and top.slug not in skip
    ]
    districts = db.scalars(
        select(District.name_en)
        .where(District.is_active.is_(True), District.state.in_(("AP", "TS")))
        .order_by(District.state, District.sort)
    ).all()
    return {"categories": categories, "districts": list(districts)}


def _district_named(db: Session, name: str) -> int | None:
    """An offered district the model named exactly (English, Telugu or slug)."""
    key = normalize_text(name).casefold()
    if not key:
        return None
    for district in db.scalars(
        select(District).where(District.is_active.is_(True), District.state.in_(("AP", "TS")))
    ):
        if key in (
            normalize_text(district.name_en).casefold(),
            normalize_text(district.name_te).casefold(),
            district.slug.casefold(),
        ):
            return district.id
    return None


def _find_tag(db: Session, name: str) -> Tag | None:
    """An existing tag by name (either language) or by the slug `_apply_tags`
    would give this name — so the same person is not tagged twice."""
    key = name.casefold()
    return db.scalar(
        select(Tag)
        .where(
            or_(
                Tag.slug == (slugify(name)[:100] or "-"),
                func.lower(Tag.name_te) == key,
                func.lower(Tag.name_en) == key,
            )
        )
        .limit(1)
    )


def _named_otherwise(db: Session, item: IngestedItem, raw: dict) -> bool:
    """Whether the headline's keyword mandal is a name the model filed as
    something else — a homonym, so the model's place stands instead.

    Live 2026-09-30, article #128 "సింగరేణిలో భారీగా బొగ్గు మాయం: బాల్క
    సుమన్" is about Singareni Collieries, which the model tagged
    `{type: org, name_te: సింగరేణి}`; the keyword matcher filed it in Singareni
    mandal, Khammam, and the model's place — హైదరాబాద్‌ — was never asked.
    Only a keyword match is second-guessed: a source's pinned mandal is an
    admin's decision, not a guess.
    """
    if item.mandal_match_method != MandalMatchMethod.KEYWORD or item.matched_mandal_id is None:
        return False
    mandal = db.get(Mandal, item.matched_mandal_id)
    if mandal is None:
        return False
    name = normalize_text(mandal.name_te).casefold()
    tags = raw.get("tags") if isinstance(raw.get("tags"), list) else []
    return any(
        isinstance(tag, dict)
        and isinstance(tag.get("name_te"), str)
        and normalize_text(tag["name_te"]).casefold() == name
        and str(tag.get("type") or "").strip().casefold() in _NOT_A_PLACE
        for tag in tags
    )


def _classify(
    db: Session,
    raw: dict | None,
    tax: dict[str, Any],
    item: IngestedItem,
    rewrite_text: str,
) -> dict[str, Any]:
    """The model's filing, reduced to values we can stand behind.

    The trust boundary: `raw` is whatever the model wrote, and every value is
    checked against our own tables before it can reach an article.

      * section: a slug we offered; a sub-section only when it is a child of it;
      * place: what the fetch found (an admin's pinned mandal, one unambiguous
        name in the headline) is never overruled — unless the model tagged
        that headline name as something other than a place (`_named_otherwise`);
        the model's place is only looked up, through the gazetteer and within
        the district, when the fetch found none or several. The district
        follows the mandal; the model's district is used only when there is no
        mandal;
      * tags: at most five short names that our own rewrite actually contains,
        never a publisher's name, matched to an existing tag or glossary term
        first. A person nobody tagged before is dropped — a model does not get
        to create people — and so is any type we did not offer;
      * breaking: only a literal true, and only ever a suggestion.
    """
    raw = raw if isinstance(raw, dict) else {}

    def said(key: str) -> str:
        value = raw.get(key)
        return normalize_text(value) if isinstance(value, str) else ""

    category_id = subcategory_id = None
    section = next((c for c in tax.get("categories") or [] if c["slug"] == said("category")), None)
    if section is not None:
        category_id = section["id"]
        child = next((c for c in section["children"] if c["slug"] == said("subcategory")), None)
        subcategory_id = child["id"] if child else None

    district_id = _district_named(db, said("district"))
    mandal_id = None
    homonym = _named_otherwise(db, item, raw)
    fetched = (MandalMatchMethod.SOURCE_DEFAULT, MandalMatchMethod.KEYWORD)
    if item.mandal_match_method in fetched and not homonym:
        mandal_id = item.matched_mandal_id
    elif said("place"):
        found, method, _confidence = gazetteer_service.resolve(
            db,
            title=said("place"),
            # A homonym's district is where the wrong place is, not a hint.
            district_id=district_id or (None if homonym else item.matched_district_id),
            min_name_len=settings_service.get_int(db, "crawl.mandal_min_name_len"),
        )
        mandal_id = found if method == MandalMatchMethod.KEYWORD else None
    if mandal_id is not None:
        mandal = db.get(Mandal, mandal_id)
        district_id = mandal.district_id if mandal else None

    haystack = normalize_text(rewrite_text).casefold()
    outlets = {
        str(name).casefold()
        for row in db.execute(select(ContentSource.name, ContentSource.name_te, ContentSource.slug))
        for name in row
        if name
    }
    tags: list[dict[str, Any]] = []
    seen: set[object] = set()
    for offered in raw.get("tags") if isinstance(raw.get("tags"), list) else []:
        if len(tags) >= MAX_TAGS:
            break
        if not isinstance(offered, dict) or not isinstance(offered.get("name_te"), str):
            continue
        name = normalize_text(offered["name_te"])
        key = name.casefold()
        if (
            not _TAG_TEXT.fullmatch(name)
            or len(name.split()) > 4
            or key not in haystack
            # An outlet inside the tag ("సాక్షి పత్రిక"), or the tag as an
            # outlet's leading word ("టీవీ9" of "టీవీ9 తెలుగు"). Not any tag
            # inside an outlet's name: "తెలంగాణ" is in "నమస్తే తెలంగాణ".
            or any((len(o) >= 3 and o in key) or o.startswith(key) for o in outlets)
        ):
            continue
        kind = str(offered.get("type") or "").strip().casefold()
        tag = _find_tag(db, name)
        if tag is None:
            # The glossary's canonical spelling and type, as `suggest_tags` uses it.
            term = db.scalar(
                select(TermGlossary)
                .where(or_(TermGlossary.term_te == name, func.lower(TermGlossary.term_en) == key))
                .limit(1)
            )
            if term is not None:
                name, kind = normalize_text(term.term_te), TagType(term.type).value
                tag = _find_tag(db, name) or _find_tag(db, term.term_en)
        if tag is None and kind not in _CREATABLE_TAG_TYPES:
            continue
        ident: object = tag.id if tag is not None else name.casefold()
        if ident in seen:
            continue
        seen.add(ident)
        tags.append(
            {
                "name": (tag.name_te if tag is not None else name)[:140],
                "type": TagType(tag.type).value if tag is not None else kind,
                "tag_id": tag.id if tag is not None else None,
            }
        )

    return {
        "category_id": category_id,
        "subcategory_id": subcategory_id,
        "district_id": district_id,
        "mandal_id": mandal_id,
        "tags": tags,
        "breaking": raw.get("breaking") is True,
        "glyph_warning": False,
        "raw": raw,
    }


# --------------------------------------------------------------------------- #
# The rewrite
# --------------------------------------------------------------------------- #
def _bill(
    db: Session, provider: AiProvider, actor_id: int | None, error: str | None = None
) -> None:
    """One ledger row per provider call, a failed one included: a provider
    that errors after consuming tokens must not make retries look free."""
    if provider.key == "heuristic":
        return
    ai_usage_service.record(
        db,
        operation="rewrite",
        provider=provider.key,
        model=getattr(provider, "model_name", None),
        actor_id=actor_id,
        usage=getattr(provider, "last_usage", None),
        ok=error is None,
        error=error,
    )


def _words(result: RewriteText) -> str:
    return "\n".join([result.title_te or "", result.summary_te or "", *result.paragraphs_te])


def _usable(retry: RewriteText | None) -> bool:
    """A second answer worth keeping over the first: copy, and no stray letter."""
    return (
        retry is not None
        and not retry.refused
        and bool(retry.title_te)
        and bool(retry.paragraphs_te)
        and not _foreign_glyph(_words(retry))
    )


def _styled(
    result: RewriteText, story_type: str | None, source_text: str, outlets: list[str]
) -> tuple[RewriteText, list[dict[str, str]]]:
    """The rewrite with house spellings applied, and what the style lint says
    about it. Spellings are fixed in code, never asked of a model twice."""
    title, summary, paragraphs = newsroom_style.canonicalize_copy(
        result.title_te, result.summary_te, result.paragraphs_te
    )
    result = dataclasses.replace(
        result, title_te=title, summary_te=summary, paragraphs_te=paragraphs
    )
    issues = newsroom_style.lint_copy(
        title,
        summary,
        paragraphs,
        story_type=result.story_type or story_type,
        source=source_text,
        outlets=outlets,
    )
    return result, issues


def _outlets_to_avoid(db: Session, source: ContentSource) -> list[str]:
    """Publication names the copy must not print: every configured feed's, in
    both scripts. Readers never see an outlet's name (owner, 2026-10-03)."""
    names = {
        str(name)
        for row in db.execute(select(ContentSource.name, ContentSource.name_te))
        for name in row
        if name
    }
    return sorted(names)


def _retry_for_glyph(
    db: Session, provider: AiProvider, request: dict[str, Any], actor_id: int | None
) -> RewriteText | None:
    """The one second call a stray foreign letter earns; None if it failed.

    Also the style retry's: `request` then carries `feedback`, and the caller
    makes sure an item never gets more than one second call between the two.

    Measured on the bulk model, about one rewrite in five carries a letter
    from another script (`ఎစ်భై` for `ఎనభై`) that reads as Telugu at a
    glance. A second call usually comes back clean. Never raises — the first
    rewrite is still there to keep.
    """
    try:
        if provider.key != "heuristic":
            ai_usage_service.check_budget(db)
        retry = provider.rewrite_item(**request)
    except AiBudgetExceededError:
        return None
    except Exception as exc:  # noqa: BLE001 — the first answer still stands
        _bill(db, provider, actor_id, error=str(getattr(exc, "details", exc))[:300])
        return None
    _bill(db, provider, actor_id)
    return retry


def _record(
    db: Session,
    item: IngestedItem,
    *,
    status: RewriteStatus,
    reason: str | None = None,
    actor_id: int | None = None,
    engine: str = "none",
) -> IngestedRewrite:
    """Store an outcome — including the outcomes that produced no copy.

    A refusal is written down rather than discarded so the queue can explain
    why an item was passed over, and so the same item is not retried every
    hour for the rest of the week.
    """
    row = IngestedRewrite(
        item_id=item.id,
        title_te="",
        summary_te=None,
        attribution_te="",
        status=status,
        refusal_reason=(reason or None),
        engine=engine,
        created_by=actor_id,
    )
    db.add(row)
    item.rewrite_status = status
    db.flush()
    return row


def attribution_line(item: IngestedItem) -> str:
    """The credit, written by us.

    Never taken from the model. A model told to attribute will usually do it
    and occasionally will not, and an unattributed rewrite of another
    publisher's reporting is the single output this system must never produce.
    Phrasing matches `ingestion_service._body_document` so a reader sees one
    house style regardless of which path a story came through.
    """
    source = item.source
    name = source.name if source else "మూలం"
    credit = f"మూలం: {name}"
    if item.canonical_url:
        credit = f"{credit} — {item.canonical_url}"
    return credit[:400]


def rewrite_one(
    db: Session,
    item: IngestedItem,
    *,
    actor_id: int | None = None,
    force: bool = False,
    taxonomy: dict[str, Any] | None = None,
) -> IngestedRewrite:
    """Rewrite one queued item, and file it. Raises only AiBudgetExceededError.

    `taxonomy` is the pass's `_taxonomy`; a single rewrite reads its own.
    """
    source = item.source
    if source is None:
        return _record(db, item, status=RewriteStatus.FAILED, reason="item has no source")

    if item.rewrite_status != RewriteStatus.NONE and not force:
        existing = item.ready_rewrite or item.latest_rewrite
        if existing is not None:
            return existing

    headline = item.title or ""
    preview = f"{headline}\n{item.summary or ''}"

    # --- guards, all before any provider call ------------------------------
    if is_sensitive(preview, settings_service.get(db, "crawl.sensitive_extra_terms") or ()):
        item.requires_human = True
        logger.info("crawl_rewrite_sensitive", item_id=item.id, source=source.slug)
        return _record(
            db,
            item,
            status=RewriteStatus.HUMAN_ONLY,
            reason="sensitive subject — routed to a person, no model was called",
            actor_id=actor_id,
        )

    body_text, method, source_text = gather_source_text(db, item)
    min_words = settings_service.get_int(db, "crawl.rewrite_min_words")
    if len(body_text.split()) < max(10, min_words):
        return _record(
            db,
            item,
            status=RewriteStatus.SKIPPED,
            reason=f"only {len(body_text.split())} words of source text ({method})",
            actor_id=actor_id,
        )

    provider = get_ai(**settings_service.ai_credentials(db, bulk=True))
    tax = taxonomy if taxonomy is not None else _taxonomy(db)
    # Which house-style guide the writer follows. Free and deterministic: the
    # source's section and beat say most of it, the headline the rest.
    story_type = newsroom_style.detect_type(
        headline,
        body_text,
        hint=(source.category.slug if source.category else None, str(source.beat or "")),
    )
    request: dict[str, Any] = {
        "headline": headline,
        "body_text": body_text,
        "publisher": source.name,
        "source_url": item.canonical_url or item.url or "",
        "language_in": (item.language or source.language or "te"),
        # Never printed, whatever the source's flag: readers never see an
        # outlet's name (owner, 2026-10-03). `attribution_te` keeps the record.
        "credit_source": False,
        "taxonomy": tax,
        "story_type": story_type,
        "source_date": item.published_at,
        # The prompt's closing "about N words" is the last thing the model
        # reads. At the default 220 it overrides the brief's "a ceiling, not a
        # target" and pads a 50-word district item with background.
        "target_words": min(220, len(body_text.split())),
    }
    # The rewrite pass is the highest-volume spender: hourly, up to
    # crawl.hourly_item_cap items a run — which is the whole reason ai.bulk_model
    # exists, because the editorial model at this volume costs twice the monthly
    # budget on its own. It bills to the newsroom, not to the editor who
    # happened to trigger it, so only the budget is checked here.
    if provider.key != "heuristic":
        ai_usage_service.check_budget(db)
    try:
        result = provider.rewrite_item(**request)
    except AiProviderError as exc:
        logger.warning("crawl_rewrite_failed", item_id=item.id, error=str(exc.details)[:200])
        _bill(db, provider, actor_id, error=str(exc.details)[:300])
        return _record(
            db,
            item,
            status=RewriteStatus.FAILED,
            reason=str(exc.details)[:300],
            actor_id=actor_id,
            engine=provider.key,
        )
    except Exception as exc:  # noqa: BLE001 — one bad item must not end the pass
        logger.error("crawl_rewrite_crashed", item_id=item.id, error=str(exc)[:200])
        return _record(
            db,
            item,
            status=RewriteStatus.FAILED,
            reason=str(exc)[:300],
            actor_id=actor_id,
            engine=provider.key,
        )

    # A refusal still cost a call, so this is recorded before the branch.
    _bill(db, provider, actor_id)

    if result.refused:
        return _record(
            db,
            item,
            status=RewriteStatus.REFUSED,
            reason=result.refusal_reason or "model declined",
            actor_id=actor_id,
            engine=provider.key,
        )

    # A stray letter from another script: one more try, and if it comes back
    # the same the rewrite is kept for a person to fix — flagged, and never
    # sent to review automatically.
    glyph_warning = False
    retried = False
    if _foreign_glyph(_words(result)):
        retried = True
        retry = _retry_for_glyph(db, provider, request, actor_id)
        if _usable(retry):
            result = retry
        else:
            glyph_warning = True

    # House style. Spellings are fixed in code; the lint's block issues earn
    # the second call — the same one the stray-letter check spends, so an
    # item never costs more than two — with the reasons as feedback, and the
    # answer with fewer block issues is kept. Nothing here may raise: the
    # rewrite is paid for, and a lint bug must not lose it.
    issues: list[dict[str, str]] = []
    # Read here because the style retry needs it too: see below.
    telugu_source = (item.language or source.language or "te").startswith("te")
    threshold = settings_service.get_int(db, "crawl.similarity_block_percent")
    try:
        result, issues = _styled(result, story_type, body_text, _outlets_to_avoid(db, source))
        blocks = newsroom_style.blocking(issues)
        if blocks and not retried:
            feedback = " ".join(issue["message"] for issue in blocks)
            retry = _retry_for_glyph(db, provider, {**request, "feedback": feedback}, actor_id)
            if _usable(retry):
                styled, retry_issues = _styled(
                    retry, story_type, body_text, _outlets_to_avoid(db, source)
                )
                # A cleaner retry that the similarity gate below would refuse
                # is no better: keeping it loses both paid calls, where the
                # first copy needed an editor for ten seconds.
                too_close = bool(
                    threshold
                    and telugu_source
                    and similarity_percent(
                        "\n\n".join(normalize_text(p) for p in styled.paragraphs_te), body_text
                    ) >= threshold
                )
                # Fewer block issues is better — unless the retry is MORE
                # copied than the first answer: trading an outlet name for
                # twice the lifted wording is no improvement (post-build
                # review, 2026-10-03).
                copied_before = newsroom_style.copied_share("\n\n".join(result.paragraphs_te), body_text)
                copied_after = newsroom_style.copied_share("\n\n".join(styled.paragraphs_te), body_text)
                fewer = len(newsroom_style.blocking(retry_issues)) < len(blocks)
                if fewer and copied_after <= max(copied_before, newsroom_style.COPY_BLOCK_PERCENT - 1) and not too_close:
                    result, issues = styled, retry_issues
    except Exception:  # noqa: BLE001 — the first rewrite still stands
        logger.warning("crawl_style_failed", item_id=item.id, exc_info=True)
    # A subject the refusal screen names (suicide, a sexual offence, a minor,
    # communal conflict) found in the copy itself: kept, like a stray letter,
    # for a person to judge — never sent to review automatically.
    refuse_screen = any(issue["code"] == "refuse_screen" for issue in issues)
    if refuse_screen:
        item.requires_human = True

    # Never printed, still stored on the row below: `attribution_te` is how
    # the newsroom answers "where did this come from" after the fact.
    credit = attribution_line(item)
    paragraphs = [normalize_text(p) for p in result.paragraphs_te if p and p.strip()]
    model_plain = "\n\n".join(paragraphs)

    body = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": text}]}
            for text in paragraphs
        ],
    }
    _doc, plain, _html, words, _seconds = tiptap.derive(body)

    # Only meaningful for a Telugu source — see `similarity_percent`.
    similarity = 0
    if telugu_source:
        similarity = similarity_percent(model_plain, body_text)
        if threshold and similarity >= threshold:
            logger.warning(
                "crawl_rewrite_too_similar", item_id=item.id, similarity=similarity
            )
            row = _record(
                db,
                item,
                status=RewriteStatus.REFUSED,
                reason=f"too_similar_to_source ({similarity}%)",
                actor_id=actor_id,
                engine=provider.key,
            )
            row.similarity_percent = similarity
            db.flush()
            return row

    classification: dict[str, Any] = {}
    if result.classification is not None or glyph_warning:
        try:
            classification = _classify(
                db,
                result.classification,
                tax,
                item,
                f"{result.title_te}\n{result.summary_te or ''}\n{model_plain}",
            )
        except Exception:  # noqa: BLE001 — the rewrite is paid for; filing is a bonus
            # A gazetteer or DB hiccup must not throw away copy we already paid
            # for or abort the pass: the story imports with its source's defaults.
            logger.warning("crawl_classify_failed", item_id=item.id, exc_info=True)
            classification = {}
    classification["glyph_warning"] = glyph_warning
    # The house style's verdict rides the same JSON — no migration.
    classification["story_type"] = result.story_type or story_type
    classification["editor_note"] = result.editor_note or ""
    classification["style_warnings"] = list(dict.fromkeys(issue["code"] for issue in issues))
    classification["refuse_screen"] = refuse_screen

    row = IngestedRewrite(
        item_id=item.id,
        title_te=normalize_headline(result.title_te)[:400],
        summary_te=(normalize_text(result.summary_te) or None),
        body=body,
        body_plain=plain,
        source_text=source_text,
        attribution_te=credit,
        word_count=words,
        engine=provider.key,
        model=getattr(provider, "model_name", None),
        confidence=float(result.confidence or 0.0),
        unverified=bool(result.unverified),
        similarity_percent=similarity,
        status=RewriteStatus.READY,
        created_by=actor_id,
        classification=classification,
    )
    db.add(row)
    item.rewrite_status = RewriteStatus.READY
    db.flush()
    logger.info(
        "crawl_rewrite_ready",
        item_id=item.id,
        engine=provider.key,
        words=words,
        similarity=similarity,
        glyph_warning=glyph_warning,
        story_type=classification["story_type"],
        style_warnings=classification["style_warnings"],
    )
    return row


# --------------------------------------------------------------------------- #
# Passes
# --------------------------------------------------------------------------- #
def run_fetch_pass(
    db: Session,
    *,
    beats: set[SourceBeat] | None = None,
    workers: int = DEFAULT_WORKERS,
) -> dict[str, Any]:
    sources = due_crawl_sources(db, beats=beats)
    results = fetch_many(db, sources, workers=workers)
    new = sum(int(r.get("new", 0) or 0) for r in results)
    logger.info("crawl_fetch_pass", sources=len(sources), new=new)
    return {"sources": len(sources), "fetched": len(results), "new": new}


def run_rewrite_pass(
    db: Session,
    *,
    beats: set[SourceBeat] | None = None,
    cap_override: int | None = None,
    actor_id: int | None = None,
) -> dict[str, Any]:
    """Rewrite this tick's share of the queue, then send finished ones to review.

    Committed item by item: the month's budget running out, or anything else
    going wrong half-way, must not roll back rewrites already paid for — the
    next tick would only pay for them again. Imports never carry `actor_id`
    (an admin's "Run now" included): a machine story has no author, and an
    editor must still approve it before it can be published.
    """
    if not rewrite_enabled(db):
        return {"rewritten": 0, "skipped": "rewrite_disabled"}
    try:
        ai_usage_service.check_budget(db)
    except AiBudgetExceededError:
        return {"rewritten": 0, "skipped": "budget_exhausted"}
    started = time.monotonic()
    # What the caller already did — this tick's mark, a fetch pass — is kept
    # whatever the rollbacks below undo.
    db.commit()

    # `is not None`: an admin who sets the breaking cap to 0 means none.
    hourly_cap = settings_service.get_int(db, "crawl.hourly_item_cap")
    items = select_for_rewrite(
        db,
        cap=cap_override if cap_override is not None else hourly_cap,
        beat_quota=_beat_quota(db),
        default_source_cap=settings_service.get_int(db, "crawl.per_source_default_cap"),
        beats=beats,
        max_age_hours=settings_service.get_int(db, "crawl.max_age_hours"),
        daily_cap=settings_service.get_int(db, "crawl.daily_item_cap"),
        global_cap=hourly_cap,
        districts=settings_service.crawl_districts(db),
    )

    taxonomy = _taxonomy(db) if items else None
    counts = {status.value: 0 for status in RewriteStatus}
    stopped = None
    for item in items:
        if time.monotonic() - started > PASS_DEADLINE_S:
            stopped = "deadline"
            break
        try:
            row = rewrite_one(db, item, actor_id=actor_id, taxonomy=taxonomy)
        except AiBudgetExceededError:
            # Spent mid-pass. This item is untouched; the rest wait for money.
            db.rollback()
            stopped = "budget_exhausted"
            break
        counts[row.status.value] = counts.get(row.status.value, 0) + 1
        db.commit()

    # The same beats: a breaking tick must not spend its minutes importing the
    # hourly pass's leftovers ahead of the story it just rewrote.
    imported = auto_import_ready(
        db, limit=hourly_cap, deadline=started + IMPORT_DEADLINE_S, beats=beats
    )
    logger.info(
        "crawl_rewrite_pass",
        selected=len(items),
        ready=counts.get("ready", 0),
        imported=imported,
        stopped=stopped,
    )
    return {"selected": len(items), **counts, "imported": imported, "stopped": stopped}


def auto_import_ready(
    db: Session,
    *,
    limit: int,
    deadline: float | None = None,
    beats: set[SourceBeat] | None = None,
) -> int:
    """Send finished rewrites into the review queue, when `crawl.auto_import` is on.

    Only a model's rewrite (never the keyless excerpt engine), never one still
    carrying a stray foreign letter, and never a story that already reached
    review in the last few hours from another outlet — that one stays in the
    queue with a note. Each item is claimed atomically first, so an editor's
    "Send to review" on the same item cannot make it two articles, then
    imported with no actor and without the unreviewed-feed notice: it lands
    SUBMITTED like any rewrite and waits for a person. One item per commit; a
    failure rolls back that item, its claim included, notes it, and the rest
    go on. Newest first, so the backlog never holds up the latest story.
    `limit` counts imports; `deadline` is a `time.monotonic()` value.
    """
    if not settings_service.get_bool(db, "crawl.auto_import"):
        return 0
    cutoff = utcnow() - timedelta(hours=max(1, settings_service.get_int(db, "crawl.max_age_hours")))
    query = (
        select(IngestedItem)
        .where(
            IngestedItem.status == IngestStatus.NEW,
            IngestedItem.article_id.is_(None),
            IngestedItem.rewrite_status == RewriteStatus.READY,
            IngestedItem.fetched_at >= cutoff,
        )
        .order_by(IngestedItem.id.desc())
    )
    if beats is not None:
        query = query.where(IngestedItem.source.has(ContentSource.beat.in_(list(beats))))
    items = db.scalars(query).all()
    recent = [
        (article_id, title or "")
        for article_id, title in db.execute(
            select(Article.id, Article.title_te).where(
                Article.article_type == ArticleType.AI_REWRITE,
                Article.created_at >= utcnow() - DUPLICATE_WINDOW,
            )
        )
    ]

    imported = 0
    for item in items:
        if imported >= limit or (deadline is not None and time.monotonic() > deadline):
            break
        # Read per item, so switching it off stops a pass already running.
        if not settings_service.get_bool(db, "crawl.auto_import"):
            break
        rewrite = item.ready_rewrite
        if (
            rewrite is None
            or rewrite.engine == "heuristic"
            or (rewrite.classification or {}).get("glyph_warning")
            or (rewrite.classification or {}).get("refuse_screen")
            # Checked again on the stored words: a rewrite made before the
            # stray-letter gate existed has no classification to carry it.
            or _foreign_glyph(
                f"{rewrite.title_te}\n{rewrite.summary_te or ''}\n{rewrite.body_plain or ''}"
            )
            or (item.review_note or "").startswith((_DUPLICATE_NOTE, _FAILED_NOTE))
        ):
            continue
        try:
            twin = next(
                (aid for aid, title in recent if similarity_percent(rewrite.title_te, title) >= DUPLICATE_PERCENT),
                None,
            )
            if twin is not None:
                item.review_note = f"{_DUPLICATE_NOTE}{twin}"
                db.commit()
                continue
            # Inside the try: a claim stuck behind an editor's import (a lock
            # error other than the wait timeout `claim_item` answers) costs
            # this item, not the rest of the pass.
            if not ingestion_service.claim_item(db, item.id):
                continue
            with db.begin_nested():
                article = ingestion_service.import_item(
                    db,
                    item,
                    actor_id=None,
                    auto=False,
                    rewrite=rewrite,
                    illustrate=True,
                    claimed=True,
                )
            db.commit()
        except Exception as exc:  # noqa: BLE001 — one bad item must not end the pass
            db.rollback()
            logger.warning("crawl_auto_import_failed", item_id=item.id, exc_info=True)
            # Its paid calls are on the ledger already (committed apart);
            # noted so the next pass does not pay for them again.
            item.review_note = f"{_FAILED_NOTE}{type(exc).__name__}"
            db.commit()
            continue
        recent.append((article.id, article.title_te))
        imported += 1
    return imported


def status_snapshot(db: Session) -> dict[str, Any]:
    """What the Coverage tab shows, including whether the worker is alive.

    `last_fetch_at` is the detection mechanism for a missing `worker-ingest`
    container: crawl tasks route to their own queue, so without that consumer
    they sit in Redis forever and nothing anywhere reports an error.
    """
    used = rewrites_this_hour(db)
    quota = _beat_quota(db)
    last_fetch = db.scalar(select(func.max(ContentSource.last_fetched_at)))
    failure_limit = settings_service.get_int(db, "crawl.max_consecutive_failures")
    active_now = settings_service.crawl_active_now(db)
    return {
        "enabled": crawl_enabled(db),
        "rewrite_enabled": rewrite_enabled(db),
        "active_now": active_now,
        "hourly_cap": settings_service.get_int(db, "crawl.hourly_item_cap"),
        "used_this_hour": sum(used.values()),
        "daily_cap": settings_service.get_int(db, "crawl.daily_item_cap"),
        "used_today": sum(rewrites_since(db, day_start()).values()),
        # Active sources the crawl has stopped polling; a manual fetch resets them.
        "failing_sources": int(
            db.scalar(
                select(func.count(ContentSource.id)).where(
                    ContentSource.is_active.is_(True),
                    ContentSource.consecutive_failures >= failure_limit,
                )
            )
            or 0
        ),
        "failure_limit": failure_limit,
        "beats": [
            {
                "beat": beat.value,
                "quota": int(quota.get(beat.value, 0)),
                "used": int(used.get(beat.value, 0)),
                "sources": int(
                    db.scalar(
                        select(func.count(ContentSource.id)).where(
                            ContentSource.beat == beat,
                            ContentSource.is_active.is_(True),
                        )
                    )
                    or 0
                ),
            }
            for beat in SourceBeat
        ],
        "last_fetch_at": last_fetch.isoformat() if last_fetch else None,
        # Outside the crawl hours nothing is fetched on purpose; not an outage.
        "stale": active_now and (
            last_fetch is None or (utcnow() - last_fetch) > timedelta(hours=2)
        ),
        "queue": ingestion_service.queue_counts(db),
    }
