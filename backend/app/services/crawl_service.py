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
becomes an article only when an editor presses Import, and lands in review even
then — where a *second* person has to approve it. That is enforced in
`workflow_service`, and there is no path around it.
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings as env_settings
from app.core.errors import AiProviderError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.integrations.ai import get_ai
from app.integrations.feeds import FeedResult, extract_article, fetch_feed
from app.models.enums import IngestStatus, RewriteStatus, SourceBeat
from app.models.ingestion import ContentSource, IngestedItem, IngestedRewrite
from app.services import ingestion_service, settings_service, tiptap
from app.telugu.normalize import normalize_headline, normalize_text

logger = get_logger(__name__)

#: Concurrent outbound fetches. The per-host floor is 2 s, so more threads only
#: help when sources span many hosts — and four simultaneous requests is a
#: polite ceiling for an aggregator to present to the wider web.
DEFAULT_WORKERS = 4

#: Subjects where a wrong or careless summary does real harm, and where Indian
#: reporting norms and the law both expect judgement. A hit here means a person
#: reads the item and no provider is called at all.
#:
#: Deliberately over-broad. A false positive costs one editor thirty seconds; a
#: false negative puts a machine summary of a communal incident, a sexual
#: assault or a child's identity in front of readers.
SENSITIVE_TE: frozenset[str] = frozenset(
    {
        "కులం", "కుల", "దళిత", "దళితుల", "ఎస్సీ", "ఎస్టీ", "బీసీ",
        "మతం", "మత", "మతపరమైన", "ముస్లిం", "హిందూ", "క్రైస్తవ",
        "మతఘర్షణ", "ఘర్షణలు", "అల్లర్లు",
        "అత్యాచారం", "లైంగిక", "వేధింపులు",
        "ఆత్మహత్య", "బలవన్మరణం",
        "మైనర్", "బాలిక", "బాలుడు", "చిన్నారి",
    }
)
SENSITIVE_EN: frozenset[str] = frozenset(
    {
        "caste", "dalit", "communal", "riot", "riots", "lynching",
        "rape", "sexual assault", "molest", "molestation",
        "suicide", "self-immolation",
        "minor girl", "minor boy", "juvenile", "pocso",
    }
)

_WORD = re.compile(r"[^\wఀ-౿]+", re.UNICODE)


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
    """Sources due for a poll, optionally narrowed to some beats."""
    sources = ingestion_service.due_sources(db)
    if beats is None:
        return sources
    return [s for s in sources if s.beat in beats]


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
    results: dict[int, FeedResult] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers), thread_name_prefix="crawl") as pool:
        futures = {
            pool.submit(fetch_feed, url, etag=etag, last_modified=modified): source_id
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


def rewrites_this_hour(db: Session, *, now: datetime | None = None) -> dict[str, int]:
    """Rewrites produced so far this hour, per beat.

    Counted from the rows rather than kept in a counter, so it survives a
    restart, cannot drift, and is the same number the status screen shows. A
    counter here would eventually disagree with reality and nobody would know
    which was right.
    """
    start, _ = hour_window(now)
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
    now: datetime | None = None,
) -> list[IngestedItem]:
    """Choose which queued items get rewritten this hour.

    Round-robin across the sources within a beat is the part that matters. Take
    items in pure recency order instead and a single high-volume feed fills the
    budget every hour; district coverage drops to nothing and the symptom looks
    exactly like the feature working.
    """
    used = rewrites_this_hour(db, now=now)
    total_used = sum(used.values())
    room_total = cap - total_used
    if room_total <= 0:
        return []

    cutoff = (now or utcnow()) - timedelta(hours=max(1, max_age_hours))

    query = (
        select(IngestedItem)
        .join(ContentSource, IngestedItem.source_id == ContentSource.id)
        .where(
            IngestedItem.status == IngestStatus.NEW,
            IngestedItem.rewrite_status == RewriteStatus.NONE,
            IngestedItem.requires_human.is_(False),
            IngestedItem.fetched_at >= cutoff,
            ContentSource.is_active.is_(True),
            ContentSource.rewrite_enabled.is_(True),
        )
        .order_by(IngestedItem.published_at.desc().nullslast(), IngestedItem.id.desc())
    )
    if beats is not None:
        query = query.where(ContentSource.beat.in_(list(beats)))

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
    for beat_key, sources in by_beat.items():
        beat_room = max(0, int(beat_quota.get(beat_key, 0)) - used.get(beat_key, 0))
        if beat_room <= 0:
            continue

        per_source_taken: dict[int, int] = {}
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
def is_sensitive(text: str) -> bool:
    """Whether this item must be read by a person rather than a model."""
    lowered = normalize_text(text or "").casefold()
    if any(phrase in lowered for phrase in SENSITIVE_EN):
        return True
    words = {w for w in _WORD.split(lowered) if w}
    if words & SENSITIVE_TE:
        return True
    # Telugu compounds attach case endings, so a substring check is needed for
    # the Telugu set too — "ఆత్మహత్యకు" must trip "ఆత్మహత్య".
    return any(term in lowered for term in SENSITIVE_TE)


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


def gather_source_text(db: Session, item: IngestedItem) -> tuple[str, str]:
    """The text to rewrite from, and how it was obtained.

    The licence decides what survives this call:

      * a full-text licence means the extracted body is *stored* on the item,
        exactly as feed-supplied content already is;
      * anything else means the text is used to build the prompt and then
        dropped. Nothing beyond the existing excerpt is ever written. A field
        that exists is a field that leaks, which is the rule this whole module
        inherits from `ingestion_service`.
    """
    source = item.source
    stored = ingestion_service.strip_html(item.content_html) if item.content_html else ""
    base = "\n\n".join(p for p in (item.title, item.summary or "", stored) if p).strip()

    if len(base.split()) >= 45:
        return base, "feed"

    if not (source and source.allow_html_fallback):
        return base, "feed"
    if not settings_service.get_bool(db, "crawl.html_fallback_enabled"):
        return base, "feed"
    target = item.canonical_url or item.url
    if not target or not _host_allowed(target):
        return base, "feed"

    page = extract_article(target)
    if page.status != "ok" or not page.text:
        return base, f"page_{page.status}"

    if source.may_store_full_text:
        item.content_html = ingestion_service.sanitise_body(
            "".join(f"<p>{p}</p>" for p in page.text.split("\n\n") if p.strip())
        ) or None
        item.word_count = page.word_count
        if page.image_url and not item.image_url:
            item.image_url = page.image_url
    # else: page.text stays in this function's locals and is never persisted.

    combined = "\n\n".join(p for p in (item.title, page.text) if p).strip()
    return combined, f"page_{page.method}"


# --------------------------------------------------------------------------- #
# The rewrite
# --------------------------------------------------------------------------- #
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
) -> IngestedRewrite:
    """Rewrite one queued item. Never raises."""
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
    if is_sensitive(preview):
        item.requires_human = True
        logger.info("crawl_rewrite_sensitive", item_id=item.id, source=source.slug)
        return _record(
            db,
            item,
            status=RewriteStatus.HUMAN_ONLY,
            reason="sensitive subject — routed to a person, no model was called",
            actor_id=actor_id,
        )

    body_text, method = gather_source_text(db, item)
    min_words = settings_service.get_int(db, "crawl.rewrite_min_words")
    if len(body_text.split()) < max(10, min_words):
        return _record(
            db,
            item,
            status=RewriteStatus.SKIPPED,
            reason=f"only {len(body_text.split())} words of source text ({method})",
            actor_id=actor_id,
        )

    provider_name = str(settings_service.get(db, "ai.provider") or "heuristic")
    provider = get_ai(provider_name)
    try:
        result = provider.rewrite_item(
            headline=headline,
            body_text=body_text,
            publisher=source.name,
            source_url=item.canonical_url or item.url or "",
            language_in=(item.language or source.language or "te"),
        )
    except AiProviderError as exc:
        logger.warning("crawl_rewrite_failed", item_id=item.id, error=str(exc.details)[:200])
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

    if result.refused:
        return _record(
            db,
            item,
            status=RewriteStatus.REFUSED,
            reason=result.refusal_reason or "model declined",
            actor_id=actor_id,
            engine=provider.key,
        )

    credit = attribution_line(item)
    paragraphs = [normalize_text(p) for p in result.paragraphs_te if p and p.strip()]
    # Measured before the credit is appended. Our own attribution line adds
    # tokens the source never had, which would dilute the score and let a
    # near-verbatim rewrite slip under the threshold — the guard would then be
    # measuring how long our credit line is.
    model_plain = "\n\n".join(paragraphs)
    if credit not in paragraphs:
        paragraphs.append(credit)

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
    if (item.language or source.language or "te").startswith("te"):
        similarity = similarity_percent(model_plain, body_text)
        threshold = int(env_settings.AI_SIMILARITY_BLOCK_PERCENT or 0)
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

    row = IngestedRewrite(
        item_id=item.id,
        title_te=normalize_headline(result.title_te)[:400],
        summary_te=(normalize_text(result.summary_te) or None),
        body=body,
        body_plain=plain,
        attribution_te=credit,
        word_count=words,
        engine=provider.key,
        model=getattr(provider, "model_name", None),
        confidence=float(result.confidence or 0.0),
        unverified=bool(result.unverified),
        similarity_percent=similarity,
        status=RewriteStatus.READY,
        created_by=actor_id,
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
    if not rewrite_enabled(db):
        return {"rewritten": 0, "skipped": "rewrite_disabled"}

    cap = cap_override or settings_service.get_int(db, "crawl.hourly_item_cap")
    items = select_for_rewrite(
        db,
        cap=cap,
        beat_quota=_beat_quota(db),
        default_source_cap=settings_service.get_int(db, "crawl.per_source_default_cap"),
        beats=beats,
        max_age_hours=settings_service.get_int(db, "crawl.max_age_hours"),
    )

    counts = {status.value: 0 for status in RewriteStatus}
    for item in items:
        row = rewrite_one(db, item, actor_id=actor_id)
        counts[row.status.value] = counts.get(row.status.value, 0) + 1

    logger.info("crawl_rewrite_pass", selected=len(items), ready=counts.get("ready", 0))
    return {"selected": len(items), **counts}


def status_snapshot(db: Session) -> dict[str, Any]:
    """What the Coverage tab shows, including whether the worker is alive.

    `last_fetch_at` is the detection mechanism for a missing `worker-ingest`
    container: crawl tasks route to their own queue, so without that consumer
    they sit in Redis forever and nothing anywhere reports an error.
    """
    used = rewrites_this_hour(db)
    quota = _beat_quota(db)
    last_fetch = db.scalar(select(func.max(ContentSource.last_fetched_at)))
    return {
        "enabled": crawl_enabled(db),
        "rewrite_enabled": rewrite_enabled(db),
        "hourly_cap": settings_service.get_int(db, "crawl.hourly_item_cap"),
        "used_this_hour": sum(used.values()),
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
        "stale": (
            last_fetch is None or (utcnow() - last_fetch) > timedelta(hours=2)
        ),
        "queue": ingestion_service.queue_counts(db),
    }
