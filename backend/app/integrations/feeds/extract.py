"""Pulling an article body out of an HTML page, for feeds that carry only a stub.

Many district and mandal-level Telugu outlets publish a feed with a headline
and one sentence. That is enough to link to, and not enough to rewrite from —
so when a source's licence and an admin both permit it, the article page is
fetched and the body extracted here.

**Precision order matters more than coverage.** Wrong extraction is worse than
none: navigation text, related-links blocks and comment threads fed into a
rewrite prompt produce an article about the wrong thing. So the strategies run
strongest-first and stop at the first one that yields real text:

  1. **JSON-LD `NewsArticle.articleBody`.** Indian news sites emit this almost
     universally because Google News wants it. It is the publisher's own
     statement of what the article body is, and it comes with a real publish
     date and lead image attached.
  2. `og:description` / `meta[name=description]` — a better standfirst than
     most RSS stubs, even when there is no body.
  3. `[itemprop=articleBody]`, then `<article>`.
  4. Paragraph density — the element holding the most `<p>` text once the
     chrome is stripped.

Parsing is BeautifulSoup on the **stdlib `html.parser`** backend. `lxml`,
`selectolax`, `readability-lxml` and `trafilatura` would all be better at this
and all need a C toolchain, which this project deliberately avoids (see the
PyMySQL and blurhash notes in requirements.txt). BS4 on html.parser is pure
Python and handles the tag soup that real pages contain.

Nothing here decides whether the text may be *stored*. That is the licence's
job and it lives in `ingestion_service`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone

from bs4 import BeautifulSoup, Tag

from app.core.logging import get_logger
from app.integrations.feeds.fetcher import fetch_page

logger = get_logger(__name__)

#: Enough for any news article; a cap in case a page inlines its whole archive.
MAX_EXTRACT_CHARS = 12_000

#: Stripped before any text measurement. These carry text that reads like prose
#: to a density heuristic and is never the story.
_CHROME = (
    "script",
    "style",
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "noscript",
    "iframe",
    "figure",
    "figcaption",
)

_MIN_BODY_CHARS = 200


@dataclass(slots=True)
class PageText:
    status: str  # ok | empty | blocked_by_robots | fetch_failed | http_* | not_html
    title: str | None = None
    text: str = ""
    html: str | None = None
    image_url: str | None = None
    published_at: datetime | None = None
    #: Which strategy produced `text`, so the queue can show its working.
    method: str = "none"
    word_count: int = 0


def _clean(soup: BeautifulSoup) -> BeautifulSoup:
    for tag in soup.find_all(_CHROME):
        tag.decompose()
    return soup


def _text_of(node) -> str:
    paragraphs = [
        " ".join(p.get_text(" ", strip=True).split())
        for p in node.find_all("p")
    ]
    paragraphs = [p for p in paragraphs if len(p) > 30]
    if paragraphs:
        return "\n\n".join(paragraphs)
    return " ".join(node.get_text(" ", strip=True).split())


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iter_jsonld(soup: BeautifulSoup):
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.get_text() or ""
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        # A page may ship one object, a list, or an @graph wrapper.
        candidates = data if isinstance(data, list) else [data]
        for candidate in list(candidates):
            if isinstance(candidate, dict) and isinstance(candidate.get("@graph"), list):
                candidates.extend(candidate["@graph"])
        for candidate in candidates:
            if isinstance(candidate, dict):
                yield candidate


def _from_jsonld(soup: BeautifulSoup) -> tuple[str, str | None, datetime | None, str | None] | None:
    """`(body, headline, published_at, image_url)` from schema.org, or None."""
    wanted = {"newsarticle", "article", "reportagenewsarticle", "blogposting"}
    for node in _iter_jsonld(soup):
        types = node.get("@type")
        types = types if isinstance(types, list) else [types]
        if not any(str(t).lower() in wanted for t in types if t):
            continue
        body = str(node.get("articleBody") or "").strip()
        if len(body) < _MIN_BODY_CHARS:
            continue

        image = node.get("image")
        if isinstance(image, dict):
            image = image.get("url")
        elif isinstance(image, list) and image:
            first = image[0]
            image = first.get("url") if isinstance(first, dict) else first

        return (
            " ".join(body.split("\n")) if "\n" not in body else body,
            str(node.get("headline") or "").strip() or None,
            _parse_date(node.get("datePublished")),
            str(image) if image else None,
        )
    return None


def _meta(
    soup: BeautifulSoup, *, prop: str | None = None, name: str | None = None
) -> str | None:
    attrs: dict[str, str] = {"property": prop} if prop else {"name": name or ""}
    tag = soup.find("meta", attrs=attrs)
    if not isinstance(tag, Tag):
        return None
    # BS4 returns a list when an attribute is declared multi-valued; `content`
    # never is in practice, but the type says it might be.
    content = tag.get("content")
    if isinstance(content, list):
        content = " ".join(content)
    value = (content or "").strip()
    return value or None


def _from_markup(soup: BeautifulSoup) -> tuple[str, str] | None:
    """`(body, method)` from explicit markup, or None."""
    node = soup.find(attrs={"itemprop": "articleBody"})
    if node is not None:
        text = _text_of(node)
        if len(text) >= _MIN_BODY_CHARS:
            return text, "itemprop"
    node = soup.find("article")
    if node is not None:
        text = _text_of(node)
        if len(text) >= _MIN_BODY_CHARS:
            return text, "article_tag"
    return None


def _by_paragraph_density(soup: BeautifulSoup) -> tuple[str, str] | None:
    """Last resort: the container holding the most paragraph text."""
    best_text, best_len = "", 0
    for node in soup.find_all(["div", "section", "main"]):
        paragraphs = node.find_all("p", recursive=False) or node.find_all("p")
        if len(paragraphs) < 3:
            continue
        text = _text_of(node)
        if len(text) > best_len:
            best_text, best_len = text, len(text)
    if best_len >= _MIN_BODY_CHARS:
        return best_text, "density"
    return None


def extract_from_html(html: str, *, max_chars: int = MAX_EXTRACT_CHARS) -> PageText:
    """Extract without fetching — the unit-testable half."""
    if not (html or "").strip():
        return PageText(status="empty")

    soup = BeautifulSoup(html, "html.parser")

    # Read metadata before stripping chrome: og: tags live in <head>, and the
    # JSON-LD block is a <script>, which _clean() removes.
    jsonld = _from_jsonld(soup)
    og_image = _meta(soup, prop="og:image")
    og_title = _meta(soup, prop="og:title")
    description = _meta(soup, prop="og:description") or _meta(soup, name="description")
    html_title = soup.title.get_text(strip=True) if soup.title else None

    if jsonld is not None:
        body, headline, published, image = jsonld
        text = body[:max_chars]
        return PageText(
            status="ok",
            title=headline or og_title or html_title,
            text=text,
            image_url=image or og_image,
            published_at=published,
            method="jsonld",
            word_count=len(text.split()),
        )

    _clean(soup)
    found = _from_markup(soup) or _by_paragraph_density(soup)
    if found is not None:
        text, method = found
        text = text[:max_chars]
        return PageText(
            status="ok",
            title=og_title or html_title,
            text=text,
            image_url=og_image,
            method=method,
            word_count=len(text.split()),
        )

    if description:
        # Not a body, but a better standfirst than a one-line RSS stub, and
        # honestly labelled so nothing downstream mistakes it for reporting.
        return PageText(
            status="ok",
            title=og_title or html_title,
            text=description[:max_chars],
            image_url=og_image,
            method="meta_description",
            word_count=len(description.split()),
        )

    return PageText(status="empty", title=og_title or html_title, image_url=og_image)


def extract_article(url: str, *, max_chars: int = MAX_EXTRACT_CHARS) -> PageText:
    """Fetch `url` and extract its article text. Never raises."""
    page = fetch_page(url)
    if page.status != "ok" or not page.html:
        return PageText(status=page.status)
    result = extract_from_html(page.html, max_chars=max_chars)
    logger.info(
        "page_extracted", url=url, method=result.method, words=result.word_count
    )
    return result
