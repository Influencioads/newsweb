"""Deciding which of a crawled article's images are worth downloading.

Pure functions, no database, no network — the same shape as `extract.py`, so
the rules can be tested against a list of URLs.

**The host rule is the policy.** A candidate served by a host that is neither
the article's own host nor a subdomain of it is rejected. That is what makes
"the source article's own images only, no open-web image search" true by
construction rather than by anyone remembering it: an image the publisher does
not serve cannot enter the pipeline at all, whatever code is added later.

**What this does not catch.** It reduces reviewer load; it is *not* a copyright
filter. It catches publisher logos in og:image, WordPress `-150x150`
thumbnails, sprites, tracking pixels and third-party hosts. It does **not**
catch a watermark burned into an otherwise real news photo — the common Telugu
district-stringer case — nor a logo filed under a non-obvious name. The
reviewer still looks at the picture and still decides.
"""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlsplit

#: Four is as many as a story ever needs: a hero and a short gallery.
MAX_IMAGES = 4

#: Below this, it is a thumbnail or a badge, not a photograph.
MIN_WIDTH, MIN_HEIGHT = 480, 270

#: Scanned against the URL **path only**. CDNs put `?w=1200` and cache-busting
#: junk in the query string, and matching there rejects real photographs.
_DENY_TOKENS = (
    "logo", "watermark", "placeholder", "default", "avatar", "icon", "sprite",
    "favicon", "banner", "noimage", "no-image", "blank", "spacer", "1x1",
    "pixel", "share", "whatsapp", "telegram", "subscribe",
)

#: WordPress writes the rendition size into the filename: `photo-150x150.jpg`.
_WP_SIZE = re.compile(r"-(\d{2,4})x(\d{2,4})\.[a-z]{3,4}$", re.IGNORECASE)
_WIDTH_PARAM = re.compile(r"[?&](?:w|width)=(\d+)", re.IGNORECASE)


def _basename(url: str) -> str:
    return urlsplit(url).path.rsplit("/", 1)[-1].lower()


def _publisher_host(url: str) -> str:
    """The article's host with `www.` dropped.

    Without that, a story on `www.example.com` illustrated from
    `cdn.example.com` — or from bare `example.com` — would fail its own
    publisher's test.
    """
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _declared_too_small(url: str) -> bool:
    match = _WP_SIZE.search(urlsplit(url).path)
    if match:
        return int(match.group(1)) < MIN_WIDTH or int(match.group(2)) < MIN_HEIGHT
    match = _WIDTH_PARAM.search(url)
    return bool(match) and int(match.group(1)) < MIN_WIDTH


def is_usable(url: str, *, article_url: str, logo_url: str | None = None) -> bool:
    """Could this URL plausibly be a photograph the publisher took for this story?"""
    if not url or not article_url:
        return False
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False

    publisher = _publisher_host(article_url)
    host = parts.hostname.lower()
    if not publisher or not (host == publisher or host.endswith("." + publisher)):
        return False

    path = parts.path.lower()
    if any(token in path for token in _DENY_TOKENS):
        return False
    if logo_url and _basename(url) and _basename(url) == _basename(logo_url):
        return False
    return not _declared_too_small(url)


def pick(
    candidates: list[str] | None,
    *,
    article_url: str | None,
    logo_url: str | None = None,
    limit: int = MAX_IMAGES,
) -> list[str]:
    """The usable candidates, in feed order, deduplicated and capped.

    An entry with no article URL yields nothing: with no publisher host to
    compare against, the host rule cannot be enforced, and an unenforceable
    rule is not one worth pretending to apply.
    """
    if not candidates or not article_url:
        return []
    kept: list[str] = []
    for candidate in candidates:
        # og:image is routinely relative; resolving it is also what gives it a
        # host to check.
        absolute = urljoin(article_url, (candidate or "").strip())
        if absolute in kept:
            continue
        if is_usable(absolute, article_url=article_url, logo_url=logo_url):
            kept.append(absolute)
            if len(kept) >= limit:
                break
    return kept
