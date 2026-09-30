"""Ingesting external content (updated doc §17).

The pipeline is three human-gated steps, the same shape the AI pipeline uses:

    fetch   ->  ingested_items          (a queue, invisible to readers)
    review  ->  an editor accepts or rejects
    import  ->  articles @ DRAFT        (the ordinary editorial workflow)

Two rules are enforced here rather than trusted to a UI:

  * **How much text we keep is decided by the source's licence.** A source
    without an agreement stores a headline, a ~40-word excerpt and a link. The
    full text is not truncated for display — it is never written to the
    database at all, because a field that exists is a field that leaks.
  * **Nothing an ingest produces is published by itself.** An imported item
    becomes a DRAFT article and travels the normal route: a human approves, a
    *different* human publishes. The one exception, `source.auto_publish`, is
    off by default and requires both a full-text licence and an explicit
    admin decision — and even then the article carries the same
    "auto-published from a feed, not reviewed by an editor" line the big
    aggregators use.

The crawl's own automatic import (`crawl_service.auto_import_ready`, behind
`crawl.auto_import`) is not that exception. It comes through `import_item`
with no actor, lands SUBMITTED like any rewrite, and still needs one person to
approve and a different one to publish. What it adds is the filing the AI
suggested (section, place, typed tags, a *suggested* breaking flag) and a
photo the vision model looked at first. A branded photo is rejected, never
cleaned: no crawled picture is ever sent to an image edit or generation model.
"""

from __future__ import annotations

import hashlib
import io
import socket
import ipaddress
import re
import time
from datetime import timedelta
from typing import Any

import bleach
import httpx
from urllib.parse import urlsplit
from PIL import Image
from sqlalchemy import func, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import SITE_NAME_TE
from app.core.config import settings as env_settings
from app.core.errors import (
    AiBudgetExceededError,
    AppError,
    ConflictError,
    NotFoundError,
    ValidationError,
)
from app.core.logging import get_logger
from app.db.base import utcnow
from app.db.session import session_scope
from app.integrations.ai import catalogue, get_ai
from app.integrations.ai.base import AiProvider, ImageVerdict
from app.integrations.feeds import FeedEntry, FeedResult, fetch_feed
from app.integrations.feeds import images as feed_images
from app.integrations.feeds.fetcher import user_agent
from app.models.ai import AiUsage
from app.models.content import Article, ArticleTag, Category, Tag
from app.models.enums import (
    ArticleStatus,
    ArticleType,
    IngestStatus,
    MandalMatchMethod,
    TagType,
    WorkflowState,
)
from app.models.geo import Mandal
from app.models.ingestion import ContentSource, IngestedItem, IngestedRewrite
from app.models.media import ArticleMedia, Media
from app.services import (
    ai_usage_service,
    gazetteer_service,
    media_service,
    settings_service,
    tiptap,
)

logger = get_logger(__name__)

#: Tags a syndicated body may keep. No script, no iframe, no style — the text
#: arrives from outside and is treated accordingly.
ALLOWED_TAGS = frozenset(
    {
        "p",
        "br",
        "strong",
        "em",
        "b",
        "i",
        "u",
        "blockquote",
        "ul",
        "ol",
        "li",
        "h2",
        "h3",
        "h4",
        "a",
        "figure",
        "figcaption",
    }
)
ALLOWED_ATTRIBUTES = {"a": ["href", "title"]}

#: Length of the excerpt an unlicensed source may keep — a standfirst, the
#: same ~40 words §1 asks of our own summaries.
EXCERPT_WORDS = 40
EXCERPT_MAX_CHARS = 400

#: How long before its interval a source may be polled again. The passes run
#: on a five-minute grid and `last_fetched_at` is stamped after the network
#: round trip, so without this an hourly source due at 11:05:00, last stamped
#: at 10:05:03, would wait for 12:05.
POLL_GRACE = timedelta(minutes=2)

#: A news photograph is never this big. The cap is a memory guard, not a
#: quality one — forty imports an hour each holding 50 MB is the failure.
MAX_IMAGE_BYTES = 8 * 1024 * 1024
#: Outside this window it is a banner strip or a portrait crop, not a hero.
MIN_ASPECT, MAX_ASPECT = 0.5, 3.0
#: One whole download, however slowly it arrives. The 10 s timeout bounds each
#: read, not their sum, so a server trickling a byte every nine seconds would
#: otherwise hold an import for as long as it liked.
DOWNLOAD_DEADLINE_S = 20.0

#: Vision errors in a row (an outage, a revoked key, a model that stopped
#: taking images) before the photo scan pauses. Paused, photos are used
#: unchecked — exactly as before the scan existed — rather than every story
#: waiting out three timeouts first.
# ponytail: per-process breaker, each worker trips on its own; move the two
# counters to Redis if the fleet should share one.
_VISION_TRIP = 3
_VISION_PAUSE_S = 600.0
_vision_failures = 0
_vision_paused_until = 0.0


#: Elements whose *contents* must go, not just their tags. `bleach` with
#: `strip=True` removes <script> but keeps the JavaScript inside it as visible
#: text — harmless to execute, but it lands in the article body as gibberish.
#: These are dropped whole before bleach runs.
_DROP_WHOLE = re.compile(
    r"<\s*(script|style|noscript|template|iframe|object|embed)\b[^>]*>.*?<\s*/\s*\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
#: An unclosed <script> would survive the pair-matching pass above.
_DROP_DANGLING = re.compile(
    r"<\s*(script|style|noscript|template|iframe|object|embed)\b[^>]*>.*",
    re.IGNORECASE | re.DOTALL,
)


def _drop_dangerous_blocks(html: str) -> str:
    return _DROP_DANGLING.sub("", _DROP_WHOLE.sub(" ", html))


def strip_html(value: str | None) -> str:
    if not value:
        return ""
    text = bleach.clean(
        _drop_dangerous_blocks(value), tags=set(), attributes={}, strip=True
    )
    return re.sub(r"\s+", " ", text).strip()


def make_excerpt(*candidates: str | None) -> str:
    """First usable candidate, cut to a standfirst at a word boundary."""
    for candidate in candidates:
        text = strip_html(candidate)
        if not text:
            continue
        words = text.split()
        if len(words) > EXCERPT_WORDS:
            text = " ".join(words[:EXCERPT_WORDS]) + "…"
        return text[:EXCERPT_MAX_CHARS]
    return ""


def sanitise_body(html: str | None) -> str:
    """Make an outside publisher's HTML safe to store and render.

    Two passes on purpose: dangerous elements lose their contents first, then
    bleach reduces what remains to the allow-list. Doing only the second leaves
    script source sitting in the body as text.
    """
    if not html:
        return ""
    return bleach.clean(
        _drop_dangerous_blocks(html),
        tags=set(ALLOWED_TAGS),
        attributes=ALLOWED_ATTRIBUTES,
        strip=True,
    ).strip()


def content_hash(title: str, summary: str) -> str:
    """Identity across syndication.

    The same wire story reaches three partners with three feed ids, so the hash
    covers the words rather than the id — that is what stops the front page
    showing one story three times.
    """
    normalised = re.sub(r"[^\w\s]", "", f"{title} {summary}".lower())
    normalised = re.sub(r"\s+", " ", normalised).strip()
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# fetching
# --------------------------------------------------------------------------- #
def due_sources(db: Session) -> list[ContentSource]:
    """Sources whose polling interval has elapsed.

    A source that has failed `crawl.max_consecutive_failures` times in a row
    is left alone until an admin fetches it by hand, which resets the count.
    """
    now = utcnow()
    limit = settings_service.get_int(db, "crawl.max_consecutive_failures")
    rows = db.scalars(
        select(ContentSource).where(
            ContentSource.is_active.is_(True),
            ContentSource.consecutive_failures < limit,
        )
    ).all()
    return [
        s
        for s in rows
        if s.last_fetched_at is None
        or (now - s.last_fetched_at)
        >= timedelta(minutes=max(5, s.fetch_interval_minutes)) - POLL_GRACE
    ]


def _store_entry(
    db: Session, source: ContentSource, entry: FeedEntry
) -> IngestedItem | None:
    """Persist one feed entry, keeping only what the licence permits."""
    summary = make_excerpt(entry.summary, entry.content_html)
    digest = content_hash(entry.title, summary)

    if db.scalar(
        select(IngestedItem).where(
            IngestedItem.source_id == source.id, IngestedItem.guid == entry.guid
        )
    ):
        return None
    # The same wire copy from a second partner is a duplicate, not news.
    if db.scalar(select(IngestedItem).where(IngestedItem.content_hash == digest)):
        return None

    body: str | None = None
    words = 0
    if source.may_store_full_text:
        body = sanitise_body(entry.content_html) or None
        words = len(strip_html(body).split()) if body else 0
    # Otherwise `content_html` stays NULL. Not truncated — absent.

    mandal_id, method, confidence = _resolve_mandal(db, source, entry.title, summary)

    # The host to measure candidates against is the one an admin configured,
    # not the one this feed claims for itself — see `images.publisher_url`.
    publisher = feed_images.publisher_url(
        source.homepage_url, source.feed_url, entry.url
    )
    picked = feed_images.pick(
        entry.image_urls or ([entry.image_url] if entry.image_url else []),
        article_url=publisher,
        logo_url=source.logo_url,
    )

    item = IngestedItem(
        source_id=source.id,
        guid=entry.guid,
        url=entry.url,
        canonical_url=entry.url,
        title=entry.title,
        summary=summary or None,
        content_html=body,
        author=(entry.author or None),
        image_url=(picked[0] if picked else None),
        image_urls=(picked or None),
        language=(entry.language or source.language),
        word_count=words,
        published_at=entry.published_at,
        fetched_at=utcnow(),
        content_hash=digest,
        status=IngestStatus.NEW,
        matched_mandal_id=mandal_id,
        matched_district_id=(
            gazetteer_service.district_of(db, mandal_id) or source.default_district_id
        ),
        mandal_match_method=method,
        mandal_match_confidence=confidence,
    )
    db.add(item)
    return item


def _resolve_mandal(
    db: Session, source: ContentSource, title: str, summary: str
) -> tuple[int | None, MandalMatchMethod, float]:
    """Where this item happened, in three tiers of decreasing certainty.

    A pinned source mandal is a fact an admin asserted. A keyword hit is a
    guess. Nothing is a perfectly acceptable answer — the district still
    applies, and an editor fills the rest in at import.
    """
    if source.default_mandal_id:
        return source.default_mandal_id, MandalMatchMethod.SOURCE_DEFAULT, 1.0
    if not source.mandal_autotag:
        return None, MandalMatchMethod.NONE, 0.0
    try:
        if not settings_service.get_bool(db, "crawl.mandal_autotag"):
            return None, MandalMatchMethod.NONE, 0.0
        min_len = settings_service.get_int(db, "crawl.mandal_min_name_len")
        return gazetteer_service.resolve(
            db,
            title=title or "",
            summary=summary or "",
            district_id=source.default_district_id,
            min_name_len=min_len,
        )
    except Exception as exc:  # noqa: BLE001
        # A gazetteer problem must not stop a story being ingested. The item
        # keeps its district and an editor assigns the mandal by hand.
        logger.warning("mandal_match_failed", source=source.slug, error=str(exc)[:200])
        return None, MandalMatchMethod.NONE, 0.0


def fetch_source(db: Session, source: ContentSource) -> dict[str, Any]:
    """Poll one source. Never raises — a bad feed is a recorded status."""
    result = fetch_feed(
        source.feed_url,
        etag=source.etag,
        last_modified=source.last_modified,
        limit=settings_service.get_int(db, "crawl.max_entries_per_fetch"),
    )
    return apply_result(db, source, result)


def apply_result(
    db: Session, source: ContentSource, result: FeedResult
) -> dict[str, Any]:
    """Record a fetch that has already happened.

    Split out from `fetch_source` so the hourly crawl can do the *network* part
    on a thread pool and every database write on the calling thread — a
    `Session` is not thread-safe, and a crawl that shared one across threads
    would corrupt state in ways that surface much later as impossible data.
    """
    source.last_fetched_at = utcnow()
    source.last_status = result.status

    if result.error:
        source.consecutive_failures += 1
        source.last_error_at = utcnow()
        logger.warning("ingest_source_failed", source=source.slug, status=result.status)
        return {
            "source": source.slug,
            "status": result.status,
            "new": 0,
            "error": result.error,
        }

    source.consecutive_failures = 0
    if result.not_modified:
        return {"source": source.slug, "status": "not_modified", "new": 0}

    if result.etag:
        source.etag = result.etag
    if result.last_modified:
        source.last_modified = result.last_modified

    created = 0
    for entry in result.entries:
        if _store_entry(db, source, entry) is not None:
            created += 1
    source.items_ingested = (source.items_ingested or 0) + created
    db.flush()

    logger.info(
        "ingest_source_done", source=source.slug, seen=len(result.entries), new=created
    )
    return {
        "source": source.slug,
        "status": "ok",
        "seen": len(result.entries),
        "new": created,
    }


def run_all(db: Session, *, only_slug: str | None = None) -> list[dict[str, Any]]:
    """One polling pass. Safe to call from cron every few minutes."""
    if only_slug:
        source = db.scalar(select(ContentSource).where(ContentSource.slug == only_slug))
        if source is None:
            raise NotFoundError()
        sources = [source]
    else:
        sources = due_sources(db)

    results = [fetch_source(db, source) for source in sources]
    # Auto-publish is opt-in per source and still writes the disclaimer.
    for source in sources:
        if source.auto_publish and source.may_store_full_text:
            _auto_import(db, source)
    return results


def _auto_import(db: Session, source: ContentSource) -> int:
    """Import this source's new items without a human, when told to.

    Only reachable for a source an admin marked `auto_publish` *and* whose
    licence permits full text. The article still lands in DRAFT — automatic
    import is not automatic publication, and §6.3's two-person rule is not
    negotiable for feeds either.
    """
    items = db.scalars(
        select(IngestedItem)
        .where(
            IngestedItem.source_id == source.id, IngestedItem.status == IngestStatus.NEW
        )
        .limit(25)
    ).all()
    count = 0
    for item in items:
        try:
            # A savepoint, so a failure takes its claim and half-built article
            # with it instead of leaving the item IMPORTED with nothing behind.
            with db.begin_nested():
                import_item(db, item, actor_id=None, auto=True)
            count += 1
        except Exception:  # noqa: BLE001 — one bad item must not stop the batch
            logger.warning("ingest_auto_import_failed", item_id=item.id, exc_info=True)
    return count


# --------------------------------------------------------------------------- #
# review and import
# --------------------------------------------------------------------------- #
AUTO_NOTICE_TE = "ఈ కథనం {source} ఫీడ్ నుంచి యథాతథంగా తీసుకోబడింది; సంపాదక సమీక్ష జరగలేదు."


def get_item(db: Session, item_id: int) -> IngestedItem:
    item = db.get(IngestedItem, item_id)
    if item is None:
        raise NotFoundError()
    return item


def claim_item(
    db: Session, item_id: int, *, to: IngestStatus = IngestStatus.IMPORTED
) -> bool:
    """Take a NEW item out of the queue, or learn that somebody else did.

    One conditional UPDATE rather than read-then-write: the crawl's automatic
    import and an editor's "Send to review" can reach the same item in the
    same second, and only the one whose UPDATE changed the row may go on.
    The row lock the UPDATE takes holds the loser until the winner commits,
    and the loser's WHERE then no longer matches — on MySQL and SQLite alike,
    with no `SELECT … FOR UPDATE` involved.

    The winner holds that lock until it commits, and an import (downloads,
    photo checks, a drawing) can outlast InnoDB's 50 s lock wait. The loser's
    timeout (1205, which undoes only its own statement) is the same answer as
    a row that no longer matched: somebody else has the item.
    """
    try:
        result = db.execute(
            update(IngestedItem)
            .where(IngestedItem.id == item_id, IngestedItem.status == IngestStatus.NEW)
            .values(status=to)
        )
    except OperationalError as exc:
        if getattr(exc.orig, "args", (None,))[:1] == (1205,):
            return False
        raise
    return result.rowcount == 1


def already_in_review(item_id: int) -> ConflictError:
    return ConflictError(
        message_en="That story is already in review, or was taken off the queue.",
        message_te="ఈ వార్త ఇప్పటికే సమీక్షలో ఉంది లేదా క్యూ నుంచి తీసివేయబడింది.",
        details={"item_id": item_id},
    )


def drop_source_text(item: IngestedItem) -> None:
    """Forget the publisher's own words now the decision has been made.

    `IngestedRewrite.source_text` exists so a reviewer can read the original
    beside our rewrite. The instant that review resolves — either way — the
    reason to hold it is gone, so it goes. Held for the duration of one
    review is a working copy; held afterwards is an archive of someone
    else's site.

    Two callers, and both are the end of a review: rejecting the item in the
    queue, and the article reaching PUBLISHED or REJECTED in
    `workflow_service.transition`. Importing is deliberately NOT one of them —
    for an AI rewrite the import is where the review *starts*.
    """
    for rewrite in item.rewrites:
        rewrite.source_text = None


def reject_item(
    db: Session, item_id: int, *, actor_id: int, note: str | None
) -> IngestedItem:
    item = get_item(db, item_id)
    # The same claim an import takes: a story already in review must not be
    # marked rejected underneath the article it became.
    if not claim_item(db, item_id, to=IngestStatus.REJECTED):
        raise already_in_review(item_id)
    item.status = IngestStatus.REJECTED
    item.reviewed_by, item.reviewed_at = actor_id, utcnow()
    item.review_note = note
    drop_source_text(item)
    return item


def _body_document(item: IngestedItem, source: ContentSource) -> dict[str, Any]:
    """Build the Tiptap body an imported item becomes.

    For a licensed full-text source that is the publisher's paragraphs plus the
    disclaimer. For everything else it is the excerpt and a link — which is the
    whole article, honestly, and exactly what a feed entitles us to.
    """
    paragraphs: list[str] = []
    if source.may_store_full_text and item.content_html:
        plain = re.split(r"</p>|<br\s*/?>", item.content_html)
        paragraphs = [strip_html(chunk) for chunk in plain]
        paragraphs = [p for p in paragraphs if p]
    if not paragraphs:
        paragraphs = [item.summary or item.title]

    if source.attribution_required:
        credit = f"మూలం: {source.name}"
        if item.canonical_url:
            credit += f" — {item.canonical_url}"
        paragraphs.append(credit)

    return {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": text}]}
            for text in paragraphs
        ],
    }


def _is_internal(url: str) -> bool:
    """Does this URL point somewhere inside our own network?

    The crawl worker sits in a private network with a cloud metadata endpoint
    on it, and a publisher CMS with an open redirect (`/out?url=`, a click
    tracker — ordinary furniture) turns "fetch this image" into "fetch whatever
    the query string says". Resolving first is the point: a hostname under the
    attacker's control can answer with 169.254.169.254 whatever it looks like.

    Fails closed. A name that will not resolve is not one we were going to
    download a photograph from anyway.
    """
    host = urlsplit(url).hostname
    if not host:
        return True
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return True
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return True
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return True
    return False


def _download_image(url: str) -> tuple[bytes, str, str] | None:
    """`(bytes, mime, final_url)` for a URL that really is a usable photograph.

    `Image.open` parses the header and stops, so the dimension check costs
    nothing — the full decode happens later, once, inside `media_service`.

    **Streamed, and stopped the moment it crosses the cap.** Reading
    `response.content` first would pull the whole body into memory before the
    size check could reject it, and this runs on a box with ~800 MB free and no
    swap: one oversized file would take the worker down rather than be skipped.
    The declared Content-Length is honoured when present and never trusted when
    it is not.

    Redirects are followed. That is deliberate and worth naming: the *starting*
    URL always comes from the publisher's own feed or page (`images.is_usable`
    enforces that), and where a publisher chooses to serve its own image from —
    its CDN, usually on another domain — is the publisher's business. We never
    go looking for an image anywhere; the final host is recorded on the media
    row so an auditor can see where each one actually came from.
    """
    if _is_internal(url):
        logger.warning("ingest_image_internal_address", url=url[:200])
        return None
    with httpx.stream(
        "GET",
        url,
        headers={"User-Agent": user_agent()},
        timeout=10.0,
        follow_redirects=True,
    ) as response:
        if response.status_code != 200:
            return None
        # Where a redirect LANDED is not where we checked. A publisher serving
        # its own pictures off a CDN on another domain is normal and stays
        # allowed; an address inside the network, or a URL the cheap rules
        # reject, is not.
        final = str(response.url)
        if final != url and (
            _is_internal(final) or not feed_images.survives_redirect(final)
        ):
            logger.warning("ingest_image_redirect_refused", url=url[:120], final=final[:120])
            return None
        if not response.headers.get("content-type", "").lower().startswith("image/"):
            return None
        declared = response.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_IMAGE_BYTES:
            return None
        chunks: list[bytes] = []
        total = 0
        deadline = time.monotonic() + DOWNLOAD_DEADLINE_S
        for chunk in response.iter_bytes():
            total += len(chunk)
            if total > MAX_IMAGE_BYTES or time.monotonic() > deadline:
                return None
            chunks.append(chunk)
        final_url = str(response.url)
    raw = b"".join(chunks)

    probe = Image.open(io.BytesIO(raw))
    width, height = probe.size
    if width < feed_images.MIN_WIDTH or height < feed_images.MIN_HEIGHT:
        return None
    if not MIN_ASPECT <= (width / height) <= MAX_ASPECT:
        return None
    fmt = (probe.format or "").upper()
    # Servers say "image/jpg" often enough to matter; Pillow's answer is the
    # one `media_service` will agree with.
    mime = "image/jpeg" if fmt in ("JPEG", "MPO") else f"image/{fmt.lower()}"
    return raw, mime, final_url


#: A photo the scan would not send — over the pixel cap, or undecodable. It is
#: skipped like a branded one, but no call was made, so nothing is billed and
#: the breaker does not count it: the photo is bad, not the provider.
_UNSCANNABLE = ImageVerdict("unchecked", "too large or unreadable to scan")


def _bill_vision(
    db: Session, provider: AiProvider, actor_id: int | None, error: str | None = None
) -> None:
    """One `image_check` row per call sent.

    With no actor this is a machine pass (the crawl's import), whose item can
    still roll back after the vendor has billed — and would then be scanned,
    and billed, again. So that row is committed on a session of its own, as
    `ai_image_service` does for a failed drawing. A person's import stays in
    their request.
    """
    row: dict[str, Any] = {
        "operation": "image_check",
        "provider": provider.key,
        "model": getattr(catalogue, "VISION_MODEL", None),
        "actor_id": actor_id,
        "usage": getattr(provider, "last_usage", None),
        "ok": error is None,
        "error": error,
    }
    if actor_id is not None:
        ai_usage_service.record(db, **row)
        return
    with session_scope() as ledger:
        ai_usage_service.record(ledger, **row)


def _inspect(
    db: Session, provider: AiProvider, raw: bytes, actor_id: int | None
) -> tuple[ImageVerdict | None, bool]:
    """What the vision model saw in one photo, and whether a call was sent.

    A verdict and nothing more: the bytes are looked at, never edited, and
    never go to an image model. None — no key, a provider without image input,
    the month's budget spent, two errors in a row, the breaker open — means
    "unchecked", and the caller then uses the photo exactly as it did before
    the scan. `_UNSCANNABLE` means skip this photo. An error is asked once
    more, since one timeout would otherwise wave a branded photo through;
    the breaker counts the photo only when both calls fail. Billed like every
    sibling call: budget first, a ledger row after each, a failed one included.
    """
    global _vision_failures, _vision_paused_until
    if time.monotonic() < _vision_paused_until:
        return None, False
    called = False
    for _attempt in range(2):
        try:
            ai_usage_service.check_budget(db)
            seen = provider.inspect_image(raw)
        except AiBudgetExceededError:
            return None, called
        except Exception as exc:  # noqa: BLE001 — a photo check never fails an import
            if (getattr(exc, "details", None) or {}).get("refused_photo"):
                return _UNSCANNABLE, called
            logger.warning("ingest_image_check_failed", error=str(exc)[:200])
            _bill_vision(db, provider, actor_id, error=str(exc)[:300])
            called = True
            continue
        if seen is None:
            return None, called
        _vision_failures = 0
        _bill_vision(db, provider, actor_id)
        return seen, True
    _vision_failures += 1
    if _vision_failures >= _VISION_TRIP:
        _vision_failures, _vision_paused_until = 0, time.monotonic() + _VISION_PAUSE_S
    return None, True


def _attach_media(
    db: Session, item: IngestedItem, article: Article, actor_id: int | None
) -> dict[str, Any]:
    """Download the source article's own images and hang them off the article.

    Only the publisher's own images reach here — `feeds.images` rejected
    everything else at fetch time, and no open-web image search happens in
    this function or any other.

    **With `crawl.image_scan` on, a vision model looks at each photo first**,
    at most `crawl.image_scan_max` per story. Anything but "clean" — a
    watermark, a channel logo, a headline burned in, unfit content — is
    skipped before it becomes Media, and the search goes on to the next
    candidate (an excerpt source used to stop at its first photo, branded or
    not). The first clean one is the hero; past the limit the crawled photos
    are given up on. Rejected, never cleaned: nothing here crops, retouches or
    redraws a publisher's mark, and no crawled photo is ever sent to an image
    edit or generation model. When the scan cannot run (see `_inspect`) the
    photo is used as before and recorded as "unchecked".

    Returns what was seen, for `IngestedItem.photo_check`. What happens when
    nothing usable is found is the caller's: an open-licence photograph
    (`story_image_service`), then — on the automatic path only — an AI
    drawing, then nothing. Hero-less remains a perfectly good outcome.
    """
    scan: dict[str, Any] = {"model": None, "candidates": []}
    source = item.source
    if source is None or not source.images_enabled:
        return scan

    provider = None
    if settings_service.get_bool(db, "crawl.image_scan") and settings_service.ai_enabled(db):
        provider = get_ai(**settings_service.ai_credentials(db, bulk=True))
    limit = settings_service.get_int(db, "crawl.image_scan_max")
    checked = 0

    urls = item.image_urls or ([item.image_url] if item.image_url else [])
    sort = 0
    for url in urls[: feed_images.MAX_IMAGES]:
        if provider is not None and checked >= limit:
            break
        try:
            downloaded = _download_image(url)
            if downloaded is None:
                continue
            raw, mime, final_url = downloaded
            seen, called = (
                _inspect(db, provider, raw, actor_id) if provider is not None else (None, False)
            )
            # Every photo a call went out for counts toward the limit, a
            # failed one included; its retry does not count twice.
            checked += called
            if seen is not None and seen is not _UNSCANNABLE:
                scan["model"] = getattr(catalogue, "VISION_MODEL", None)
            verdict = seen.verdict[:20] if seen is not None else "unchecked"
            reason = (seen.reason or "") if seen is not None else ""
            scan["candidates"].append({"url": url, "verdict": verdict, "reason": reason[:200]})
            if seen is not None and verdict != "clean":
                continue
            media = media_service.create_image_media(
                db,
                raw=raw,
                filename=(url.rsplit("/", 1)[-1].split("?")[0] or "photo.jpg")[:255],
                mime=mime,
                max_bytes=MAX_IMAGE_BYTES,
                uploaded_by=actor_id,
                alt_te=item.title[:500],
                # §12.5: the service refuses a non-own image with no credit,
                # and that refusal is doing real work here.
                credit=source.name,
                source_type="syndicated",
            )
        except Exception:  # noqa: BLE001 — one bad picture, not one bad import
            logger.warning(
                "ingest_image_failed", item_id=item.id, url=url[:120], exc_info=True
            )
            continue

        media.copyright = source.licence.value
        media.meta = {
            "ingested_item_id": item.id,
            "origin_url": url,
            "photo_check": {"verdict": verdict, "model": scan["model"] if seen else None},
        }
        # Only when a redirect moved it, so the common case stays quiet and an
        # unexpected host is the thing that stands out in the row.
        if final_url != url:
            media.meta["fetched_from"] = final_url

        if article.hero_media_id is None:
            article.hero_media_id = media.id
            db.add(
                ArticleMedia(
                    article_id=article.id, media_id=media.id, role="hero", sort=0
                )
            )
            if not source.may_store_full_text:
                # An excerpt licence buys one illustrating picture with a
                # credit. A gallery of the publisher's photographs is not an
                # excerpt of anything.
                break
            continue
        sort += 1
        db.add(
            ArticleMedia(
                article_id=article.id, media_id=media.id, role="gallery", sort=sort
            )
        )
    return scan


def _illustrate(db: Session, article: Article, source: ContentSource) -> bool:
    """The last rung, an AI picture — True when one became the hero.

    Only ever asked on the automatic path, and only when every one of these
    holds: the admin switch, image generation available, today's pictures
    under `crawl.ai_illustration_daily_cap`, and the month's spend under the
    budget-alert line (so they stop well before editors run out). A crime
    story (by section, sub-section or the source's own default — the model's
    filing can move a crime story elsewhere) or one with a death, violence or
    disaster word anywhere in it is an incident: it gets the incident prompt,
    a generic representative scene, never the event itself.
    `generate_for_article` still refuses sensitive topics (sexual assault,
    suicide, minors, communal, caste, religion) and bills the draw; the
    picture is ours (`source_type="own"`) and labelled AI by `ai_generated`.
    It comes from the headline alone — no crawled photo goes anywhere near the
    model.
    """
    from app.services import ai_image_service

    if not settings_service.get_bool(db, "crawl.ai_illustrations"):
        return False
    if ai_image_service.unavailable_reason(db) is not None:
        return False
    drawn_today = db.scalar(
        select(func.count(AiUsage.id)).where(
            AiUsage.operation == "crawl_image",
            AiUsage.created_at >= ai_usage_service.day_start(),
        )
    )
    if (drawn_today or 0) >= settings_service.get_int(db, "crawl.ai_illustration_daily_cap"):
        return False
    budget = ai_usage_service.budget_paise()
    if budget and ai_usage_service.month_spend_paise(db) * 100 >= (
        budget * env_settings.AI_BUDGET_ALERT_PERCENT
    ):
        return False
    incident = ai_image_service.is_incident(db, article, source.default_category_id)
    try:
        media = ai_image_service.generate_for_article(
            db, article, actor_id=None, operation="crawl_image", incident=incident
        )
    except AppError:  # a refused topic, the budget, a provider outage: no hero
        logger.info("ingest_illustration_skipped", article_id=article.id, exc_info=True)
        return False
    # `generate_for_article` only swaps the hero on an editable story, and a
    # rewrite lands SUBMITTED, so the hero is set here, as `_attach_media` does.
    article.hero_media_id = media.id
    db.add(ArticleMedia(article_id=article.id, media_id=media.id, role="hero", sort=0))
    db.flush()
    return True


def _classified_place(
    db: Session,
    cls: dict[str, Any],
    item: IngestedItem,
    source: ContentSource,
    mandal_id: int | None,
    district_id: int | None,
) -> tuple[int | None, int | None]:
    """Mandal and district for a classified rewrite.

    The mandal is the editor's, else the AI's filing. The district follows the
    mandal, so the pair cannot disagree; the AI's own district is used only
    when there is no mandal. An editor's district beats a mandal nobody chose
    that sits in another district — the mandal goes.

    A filing's `None` is an answer, not a gap: `_classify` already kept the
    fetch-time guess wherever it stands, and dropped it only for a homonym.
    Falling back to it put #128 (Singareni Collieries, 2026-09-30) back in
    Singareni mandal, Khammam. Only a filing that failed (`{}` plus its
    glyph flag) has no keys and still takes the fetch-time guess.
    """
    wanted = mandal_id if mandal_id is not None else (
        cls["mandal_id"] if "mandal_id" in cls else item.matched_mandal_id
    )
    mandal = db.get(Mandal, wanted) if wanted else None
    if district_id is not None:
        if mandal is not None and mandal_id is None and mandal.district_id != district_id:
            mandal = None
        return (mandal.id if mandal else None), district_id
    return (mandal.id if mandal else None), (
        (mandal.district_id if mandal else None)
        or (cls["district_id"] if "district_id" in cls else item.matched_district_id)
        or source.default_district_id
    )


def _apply_classified_tags(
    db: Session, article: Article, tags: list[dict[str, Any]]
) -> None:
    """The AI's tags: an existing tag by id, a new one created inactive.

    Inactive until the story is published (`workflow_service.transition`), so
    a rejected story leaves no tag on the site. A person is never created
    from a model's say-so — only an existing person tag is reused — and an
    existing tag's type is never changed.
    """
    from app.services import workflow_service

    existing: list[Tag] = []
    names: list[str] = []
    types: dict[str, TagType] = {}
    for entry in tags:
        tag = db.get(Tag, entry["tag_id"]) if entry.get("tag_id") else None
        if tag is not None:
            existing.append(tag)
        elif entry.get("type") != TagType.PERSON.value and entry.get("name"):
            name = str(entry["name"])[:140]
            names.append(name)
            types[name] = TagType(entry.get("type") or TagType.TOPIC.value)
    workflow_service._apply_tags(db, article, names, types=types, create_inactive=True)
    have = {link.tag_id for link in article.tags}
    for tag in existing:
        if tag.id not in have:
            have.add(tag.id)
            article.tags.append(ArticleTag(tag_id=tag.id, sort=len(article.tags)))


def import_item(
    db: Session,
    item: IngestedItem,
    *,
    actor_id: int | None,
    auto: bool = False,
    use_rewrite: bool = True,
    mandal_id: int | None = None,
    district_id: int | None = None,
    category_id: int | None = None,
    rewrite: IngestedRewrite | None = None,
    illustrate: bool = False,
    claimed: bool = False,
) -> Article:
    """Turn a queued item into an article awaiting review.

    Never PUBLISHED, never SUBMITTED-and-approved: an editor still reads it.
    `source_type='syndicated'` plus a mandatory `source_credit` means the
    publish gate in `workflow_service` already refuses to let it go live
    without attribution.

    Two shapes come out of here:

      * **With a ready rewrite** — our own Telugu words, crediting the
        publisher. Lands in SUBMITTED, because machine copy sitting unnoticed
        in an editor's drafts is how it eventually gets published by accident.
      * **Without one** — the pre-existing behaviour, unchanged: headline,
        excerpt, link, DRAFT.

    `author_id` is the importing editor either way, which is what makes the
    two-person rule bite: they cannot then approve their own import.

    A rewrite that carries a `classification` (the crawl's AI filing) fills
    what the editor did not: section and sub-section, place, typed tags and
    `breaking_suggested`. Explicit arguments always win, and `is_breaking` is
    never set — breaking is a person's call. Without a classification this
    behaves exactly as it always has.

    `rewrite` passes the READY row the caller already holds; `claimed` says
    the caller took the item with `claim_item` (otherwise this does);
    `illustrate` allows the paid AI drawing, which only the automatic path
    asks for — never a web request.
    """
    from nanoid import generate

    from app.models.content import WorkflowTransition
    from app.telugu.normalize import normalize_headline
    from app.telugu.transliterate import slugify

    if item.status == IngestStatus.IMPORTED and item.article_id:
        raise ConflictError(
            message_en="That item was already imported.",
            details={"article_id": item.article_id},
        )
    source = item.source
    if source is None:
        raise ValidationError(message_en="The item has no source.")
    if not claimed and not claim_item(db, item.id):
        raise already_in_review(item.id)

    if not use_rewrite:
        rewrite = None
    elif rewrite is None:
        rewrite = item.ready_rewrite
    cls = (rewrite.classification if rewrite is not None else None) or None

    if rewrite is not None:
        title = normalize_headline(rewrite.title_te) or normalize_headline(item.title)
        body = rewrite.body or _body_document(item, source)
        summary = rewrite.summary_te or item.summary
    else:
        title = normalize_headline(item.title)
        body = _body_document(item, source)
        summary = item.summary
    doc, plain, html, words, seconds = tiptap.derive(body)

    resolved_mandal = mandal_id if mandal_id is not None else item.matched_mandal_id
    resolved_district = (
        district_id
        if district_id is not None
        else (item.matched_district_id or source.default_district_id)
    )
    resolved_category = (
        category_id if category_id is not None else source.default_category_id
    )
    subcategory_id = None
    if cls:
        resolved_mandal, resolved_district = _classified_place(
            db, cls, item, source, mandal_id, district_id
        )
        if category_id is None and cls.get("category_id"):
            picked = db.get(Category, cls["category_id"])
            if picked is not None and picked.is_active:
                resolved_category = picked.id
        sub = db.get(Category, cls["subcategory_id"]) if cls.get("subcategory_id") else None
        if (
            sub is not None
            and sub.is_active
            and resolved_category is not None
            and sub.parent_id == resolved_category
        ):
            subcategory_id = sub.id

    article = Article(
        short_id=generate(size=6),
        slug=slugify(title)[:180] or "syndicated",
        title_te=title,
        title_en=item.title if (item.language or "").startswith("en") else None,
        summary_te=summary,
        body=doc,
        body_plain=plain,
        body_html=html,
        word_count=words,
        reading_time_sec=seconds,
        category_id=resolved_category,
        subcategory_id=subcategory_id,
        district_id=resolved_district,
        mandal_id=resolved_mandal,
        author_id=actor_id,
        created_by=actor_id,
        article_source_type="AI_REWRITE" if rewrite is not None else "IMPORTED",
        updated_by=actor_id,
        # §17 attribution. `workflow_service` blocks publication of a non-own
        # source without a credit, so this is not decoration. A rewrite is our
        # own words, but the *facts* are still the publisher's reporting, so
        # the credit requirement applies to it identically.
        source_type="syndicated",
        source_credit=source.name,
        canonical_url=item.canonical_url,
        article_type=(
            ArticleType.AI_REWRITE if rewrite is not None else ArticleType.SYNDICATED
        ),
        # A rewrite goes straight into the review queue; an excerpt import keeps
        # the old DRAFT behaviour so nothing about existing sources changes.
        status=ArticleStatus.PENDING if rewrite is not None else ArticleStatus.DRAFT,
        workflow_state=(
            WorkflowState.SUBMITTED if rewrite is not None else WorkflowState.DRAFT
        ),
        byline_te=(item.author or source.name)[:200],
        published_at=None,
        ai_generated=rewrite is not None,
        ai_model=(rewrite.model if rewrite is not None else None),
        ai_confidence=(rewrite.confidence if rewrite is not None else None),
        # A suggestion the desk sees, never the flag itself: `is_breaking`
        # stays a person's decision.
        breaking_suggested=bool(cls and cls.get("breaking") is True),
    )
    db.add(article)
    db.flush()

    # Each block in its own savepoint: a failed write inside rolls back to
    # here and the import goes on, instead of leaving the session unusable.
    scan: dict[str, Any] = {"model": None, "candidates": []}
    hero = "none"
    try:
        with db.begin_nested():
            scan = _attach_media(db, item, article, actor_id)
            if article.hero_media_id is not None:
                hero = "crawled"
            else:
                # Rung (a) found nothing usable. `story_image_service` tries an
                # open-licence photograph — CC0/PDM, no credit line — behind
                # `crawl.open_licence_images`, and returns None for "no
                # picture". Then, on the automatic path alone, an AI drawing.
                from app.services import story_image_service

                if story_image_service.resolve_hero(db, article, item, actor_id=actor_id):
                    hero = "open_licence"
                elif illustrate and _illustrate(db, article, source):
                    hero = "ai_illustration"
    except Exception:  # noqa: BLE001 — same reasoning as the notification
        # fan-out in `workflow_service`: a picture must never fail an import.
        hero = "none"
        logger.warning("ingest_media_attach_failed", item_id=item.id, exc_info=True)
    item.photo_check = {**scan, "hero": hero}

    if cls and cls.get("tags"):
        try:
            with db.begin_nested():
                _apply_classified_tags(db, article, cls["tags"])
        except Exception:  # noqa: BLE001 — tags are a convenience, not the story
            logger.warning("ingest_tags_failed", item_id=item.id, exc_info=True)

    _apply_masthead(db, article, source, rewrite is not None)

    if rewrite is not None:
        note = f"AI rewrite of {source.name} imported for review"
    elif auto:
        note = f"Auto-imported from {source.name}"
    else:
        note = f"Imported from {source.name}"
    db.add(
        WorkflowTransition(
            article_id=article.id,
            from_state=None,
            to_state=article.workflow_state,
            actor_id=actor_id,
            note=note,
            created_at=utcnow(),
        )
    )

    if auto:
        # The same line the big aggregators carry. A reader deserves to know
        # no editor read this.
        article.correction_note_te = AUTO_NOTICE_TE.format(source=source.name)

    item.status = IngestStatus.IMPORTED
    item.article_id = article.id
    item.reviewed_by, item.reviewed_at = actor_id, utcnow()
    # NOT dropped here. Importing a rewrite is not the end of its review — the
    # article lands PENDING and an editor still has to read it, and that is the
    # reader they were being held for. `workflow_service` drops them when the
    # article reaches PUBLISHED or REJECTED, which is where the decision
    # actually lands. An excerpt import (no rewrite) holds nothing either way.
    db.flush()

    logger.info(
        "ingest_item_imported",
        item_id=item.id,
        article_id=article.id,
        source=source.slug,
        auto=auto,
    )
    return article



def _apply_masthead(
    db: Session, article: Article, source: ContentSource, is_rewrite: bool
) -> None:
    """Publish a rewrite under our own name when the source does not require a credit.

    `ContentSource.attribution_required` is the admin's per-source answer and
    already governs what `_body_document` prints; this makes the rewrite path
    obey the same flag instead of crediting unconditionally. What it changes is
    the *copy*: our own Telugu expression of facts, carrying our masthead. What
    it does not change is the provenance — `canonical_url`, the `IngestedItem`
    row and `IngestedRewrite.attribution_te` all still record the origin, and
    the newsroom screens read them.

    **A borrowed photograph is the exception, and it is not negotiable here.**
    No rewrite makes somebody else's picture ours, so an article carrying one
    stays `syndicated` with its credit; `media_service` demands `Media.credit`
    for a non-own image separately, and that stays true either way.

    What is tested is the hero's **licence, not its existence**. `resolve_hero`
    runs before this and may have attached a CC0/PDM photograph that needs no
    credit — ours to use, nothing borrowed — and a bare
    `hero_media_id is not None` check read that as "their photograph" and put
    the source publisher's name back on the page. The net effect was that
    turning on `crawl.open_licence_images` credited *more* articles than
    leaving it off, which is the exact outcome the feature exists to remove.
    `media_service.CREDIT_EXEMPT` is the same set the credit rule uses, so the
    two cannot drift apart. A hero we cannot load is treated as borrowed: the
    safe direction is the credit line, not its absence.
    """
    if not is_rewrite or source.attribution_required:
        return

    # The byline goes first and unconditionally. `byline_te` was
    # `item.author or source.name` — the feed's own journalist — so a rewrite
    # nobody at that outlet wrote was going out under a named reporter there.
    # That is a worse misattribution than the missing credit, and no
    # photograph makes it right.
    article.byline_te = SITE_NAME_TE

    if article.hero_media_id is not None:
        hero = db.get(Media, article.hero_media_id)
        if hero is None or hero.source_type not in media_service.CREDIT_EXEMPT:
            # Our words, their photograph. `source_credit` stays so the
            # borrowed picture is credited and the publish gate keeps demanding
            # it; only a story where nothing is borrowed becomes `own`.
            return
    article.source_type = "own"
    article.source_credit = None


def queue_counts(db: Session) -> dict[str, int]:
    rows = db.execute(
        select(IngestedItem.status, func.count(IngestedItem.id)).group_by(
            IngestedItem.status
        )
    ).all()
    counts = {status.value: 0 for status in IngestStatus}
    for status, count in rows:
        counts[IngestStatus(status).value] = int(count)
    return counts
