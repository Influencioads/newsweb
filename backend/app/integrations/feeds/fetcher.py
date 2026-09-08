"""Polite feed fetching (updated doc §17).

Three things make the difference between an aggregator publishers tolerate and
one they block:

  * **Conditional GET.** ETag / If-Modified-Since are sent back on every poll,
    so an unchanged feed costs a 304 and a few hundred bytes instead of a full
    download every thirty minutes.
  * **An honest User-Agent** naming the publication and a contact address, so
    anyone reviewing their logs can find us.
  * **robots.txt.** Checked before the first fetch of a host and cached, because
    a feed URL that is disallowed is a publisher saying no.

Parsing is `feedparser`, which handles the twenty-odd date formats, the four
RSS dialects and the malformed XML that real feeds contain. Writing that by
hand is a reliable way to silently drop stories.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import feedparser
import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

#: Politeness floor between two requests to the same host, regardless of how
#: many sources point at it.
_MIN_HOST_INTERVAL_SECONDS = 2.0
_last_hit: dict[str, float] = {}
_robots_cache: dict[str, tuple[RobotFileParser | None, float]] = {}
_ROBOTS_TTL_SECONDS = 3600.0


def user_agent() -> str:
    """Identify ourselves properly. An anonymous crawler is one that gets blocked."""
    return (
        f"{settings.APP_NAME}/1.0 (+{settings.APP_URL}; news aggregation; "
        f"contact: {settings.MAIL_FROM})"
    )


@dataclass(slots=True)
class FeedEntry:
    guid: str
    title: str
    url: str | None = None
    summary: str | None = None
    content_html: str | None = None
    author: str | None = None
    image_url: str | None = None
    published_at: datetime | None = None
    language: str | None = None


@dataclass(slots=True)
class FeedResult:
    #: True when the server answered 304 — nothing changed, nothing to do.
    not_modified: bool = False
    entries: list[FeedEntry] = field(default_factory=list)
    etag: str | None = None
    last_modified: str | None = None
    status: str = "ok"
    error: str | None = None
    feed_title: str | None = None


def _robots_allows(url: str) -> bool:
    """A disallowed feed URL is a publisher saying no. Honour it.

    A robots.txt we cannot fetch is treated as permissive, which is the
    convention — the alternative would mean one flaky request silently
    stopping ingestion from a source we are licensed for.
    """
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    cached = _robots_cache.get(origin)
    now = time.monotonic()
    if cached is None or (now - cached[1]) > _ROBOTS_TTL_SECONDS:
        parser: RobotFileParser | None = RobotFileParser()
        try:
            response = httpx.get(urljoin(origin, "/robots.txt"),
                                 headers={"User-Agent": user_agent()},
                                 timeout=10.0, follow_redirects=True)
            if response.status_code == 200:
                parser.parse(response.text.splitlines())
            else:
                parser = None
        except httpx.HTTPError:
            parser = None
        _robots_cache[origin] = (parser, now)
        cached = _robots_cache[origin]

    parser = cached[0]
    if parser is None:
        return True
    return parser.can_fetch(user_agent(), url)


def _throttle(url: str) -> None:
    host = urlparse(url).netloc
    last = _last_hit.get(host)
    if last is not None:
        wait = _MIN_HOST_INTERVAL_SECONDS - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
    _last_hit[host] = time.monotonic()


def _to_datetime(struct) -> datetime | None:
    if not struct:
        return None
    try:
        return datetime(*struct[:6], tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _entry_image(entry) -> str | None:
    """Feeds hide the image in four different places depending on the dialect."""
    for media in (getattr(entry, "media_content", None) or []):
        url = media.get("url")
        if url:
            return url
    for thumb in (getattr(entry, "media_thumbnail", None) or []):
        url = thumb.get("url")
        if url:
            return url
    for link in (getattr(entry, "links", None) or []):
        if str(link.get("type", "")).startswith("image/") and link.get("href"):
            return link["href"]
    for enclosure in (getattr(entry, "enclosures", None) or []):
        if str(enclosure.get("type", "")).startswith("image/") and enclosure.get("href"):
            return enclosure["href"]
    return None


def _entry_content(entry) -> str | None:
    """The publisher's full text, when the feed carries it.

    Returned regardless of licence — the *service* decides whether to keep it,
    because that decision belongs in one place, not scattered through a parser.
    """
    blocks = getattr(entry, "content", None) or []
    for block in blocks:
        value = block.get("value")
        if value:
            return value
    return None


def fetch_feed(
    url: str,
    *,
    etag: str | None = None,
    last_modified: str | None = None,
    limit: int = 50,
) -> FeedResult:
    """Fetch and parse one feed. Never raises: a bad feed is a status, not a crash."""
    if not _robots_allows(url):
        logger.warning("feed_blocked_by_robots", url=url)
        return FeedResult(status="blocked_by_robots",
                          error="robots.txt disallows fetching this URL")

    headers = {"User-Agent": user_agent(), "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.8"}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified

    _throttle(url)
    try:
        response = httpx.get(url, headers=headers, timeout=25.0, follow_redirects=True)
    except httpx.HTTPError as exc:
        logger.warning("feed_fetch_failed", url=url, error=str(exc)[:200])
        return FeedResult(status="fetch_failed", error=str(exc)[:300])

    if response.status_code == 304:
        return FeedResult(not_modified=True, status="not_modified",
                          etag=etag, last_modified=last_modified)
    if response.status_code >= 400:
        return FeedResult(status=f"http_{response.status_code}",
                          error=f"HTTP {response.status_code}")

    parsed = feedparser.parse(response.content)
    if getattr(parsed, "bozo", 0) and not parsed.entries:
        return FeedResult(status="unparseable",
                          error=str(getattr(parsed, "bozo_exception", ""))[:300])

    feed_language = getattr(parsed.feed, "language", None)
    entries: list[FeedEntry] = []
    for raw in parsed.entries[:limit]:
        link = getattr(raw, "link", None)
        guid = getattr(raw, "id", None) or link
        title = (getattr(raw, "title", "") or "").strip()
        if not guid or not title:
            # Without a stable id or a headline there is nothing to dedup on
            # and nothing to show. Skipping beats storing a blank row.
            continue
        entries.append(FeedEntry(
            guid=str(guid)[:500],
            title=title[:500],
            url=link,
            summary=(getattr(raw, "summary", None) or None),
            content_html=_entry_content(raw),
            author=(getattr(raw, "author", None) or None),
            image_url=_entry_image(raw),
            published_at=_to_datetime(getattr(raw, "published_parsed", None)
                                      or getattr(raw, "updated_parsed", None)),
            language=feed_language,
        ))

    return FeedResult(
        entries=entries,
        etag=response.headers.get("etag"),
        last_modified=response.headers.get("last-modified"),
        status="ok",
        feed_title=getattr(parsed.feed, "title", None),
    )
