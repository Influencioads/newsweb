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
"""

from __future__ import annotations

import hashlib
import re
from datetime import timedelta
from typing import Any

import bleach
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.integrations.feeds import FeedEntry, FeedResult, fetch_feed
from app.models.content import Article
from app.models.enums import (
    ArticleStatus,
    ArticleType,
    IngestStatus,
    MandalMatchMethod,
    WorkflowState,
)
from app.models.ingestion import ContentSource, IngestedItem
from app.services import gazetteer_service, settings_service, tiptap

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

#: A source failing this many times in a row is left alone until an admin
#: looks; hammering a broken endpoint every half hour is how you get blocked.
MAX_CONSECUTIVE_FAILURES = 8


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
    """Sources whose polling interval has elapsed."""
    now = utcnow()
    rows = db.scalars(
        select(ContentSource).where(
            ContentSource.is_active.is_(True),
            ContentSource.consecutive_failures < MAX_CONSECUTIVE_FAILURES,
        )
    ).all()
    return [
        s
        for s in rows
        if s.last_fetched_at is None
        or (now - s.last_fetched_at)
        >= timedelta(minutes=max(5, s.fetch_interval_minutes))
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

    item = IngestedItem(
        source_id=source.id,
        guid=entry.guid,
        url=entry.url,
        canonical_url=entry.url,
        title=entry.title,
        summary=summary or None,
        content_html=body,
        author=(entry.author or None),
        image_url=entry.image_url,
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
        source.feed_url, etag=source.etag, last_modified=source.last_modified
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


def reject_item(
    db: Session, item_id: int, *, actor_id: int, note: str | None
) -> IngestedItem:
    item = get_item(db, item_id)
    item.status = IngestStatus.REJECTED
    item.reviewed_by, item.reviewed_at = actor_id, utcnow()
    item.review_note = note
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

    rewrite = item.ready_rewrite if use_rewrite else None

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
        category_id=(
            category_id if category_id is not None else source.default_category_id
        ),
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
    )
    db.add(article)
    db.flush()

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
    db.flush()

    logger.info(
        "ingest_item_imported",
        item_id=item.id,
        article_id=article.id,
        source=source.slug,
        auto=auto,
    )
    return article


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
