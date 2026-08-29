"""Wikimedia Commons adapter.

Chosen as the primary source over Openverse for one practical reason: Openverse
rate-limits anonymous clients hard (HTTP 429 after a few dozen queries), while
Commons serves generous anonymous traffic provided a real User-Agent is sent, as
their API etiquette requires.

Everything on Commons is freely licensed or public domain, and `extmetadata`
returns the licence, the artist and the licence URL — which is what makes proper
§12.5 attribution possible rather than guesswork.

Coverage matters too: Commons has deep photographic coverage of Indian places,
infrastructure and civic subjects, which is exactly what a Telugu district paper
needs illustrations for.
"""

from __future__ import annotations

import re
import time

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.integrations.images.base import (
    StockImage,
    StockImageProvider,
    is_commercial_safe,
)

logger = get_logger(__name__)

API = "https://commons.wikimedia.org/w/api.php"

def _user_agent() -> str:
    """Build the outbound User-Agent Wikimedia's policy requires.

    Their CDN returns 403 for User-Agents carrying placeholder contact details
    (anything on example.com), so `IMAGE_SOURCE_CONTACT` must name the real
    publication site or editorial address. Verified behaviour, not a guess.
    """
    contact = (settings.IMAGE_SOURCE_CONTACT or "").strip()
    if not contact or "example.com" in contact or "example.org" in contact:
        # Fall back to an identifying token with no fake contact rather than
        # sending something the upstream will reject outright.
        return "TeluguNewsPlatform/1.0 (editorial image sourcing)"
    return f"TeluguNewsPlatform/1.0 ({contact})"


USER_AGENT = _user_agent()

#: Map Commons licence short names onto our internal codes.
_LICENSE_CODES = {
    "cc0": "cc0",
    "cc-zero": "cc0",
    "public domain": "pdm",
    "pd": "pdm",
    "cc by": "by",
    "cc by-sa": "by-sa",
    "cc-by": "by",
    "cc-by-sa": "by-sa",
}

_HTML_TAGS = re.compile(r"<[^>]+>")


def _clean(value: str | None) -> str | None:
    """Commons `extmetadata` values arrive as small HTML fragments."""
    if not value:
        return None
    text = _HTML_TAGS.sub("", value).strip()
    return text or None


def _license_code(short_name: str | None, raw: str | None) -> tuple[str, str | None]:
    """Return (internal_code, version) from a Commons licence string."""
    text = (short_name or raw or "").strip().lower()
    if not text:
        return "", None

    version = None
    m = re.search(r"(\d\.\d)", text)
    if m:
        version = m.group(1)

    if "publicdomain" in text.replace(" ", "") or text.startswith("pd"):
        return "pdm", None
    if "cc0" in text:
        return "cc0", None

    base = text.split(",")[0]
    for needle, code in _LICENSE_CODES.items():
        if base.startswith(needle):
            # by-sa must win over by, so check the longer key first.
            if "sa" in base.split() or "-sa" in base:
                return "by-sa", version
            return code, version

    if "by-sa" in text:
        return "by-sa", version
    if "by" in text:
        return "by", version
    return "", version


class WikimediaSource(StockImageProvider):
    key = "wikimedia"

    #: Commons etiquette: serialise requests rather than hammering the API.
    MIN_INTERVAL = 0.35

    def __init__(self, timeout: float = 30.0) -> None:
        self.timeout = timeout
        self._last_call = 0.0
        self._client = httpx.Client(
            headers={"User-Agent": USER_AGENT}, timeout=timeout, follow_redirects=True
        )

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call
        if elapsed < self.MIN_INTERVAL:
            time.sleep(self.MIN_INTERVAL - elapsed)
        self._last_call = time.monotonic()

    def search(self, query: str, *, limit: int = 5) -> list[StockImage]:
        params = {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrsearch": f"{query} filetype:bitmap",
            "gsrnamespace": "6",          # File:
            "gsrlimit": str(max(limit * 3, 10)),
            "prop": "imageinfo",
            "iiprop": "url|size|extmetadata|mime",
            "iiurlwidth": "1600",
        }
        try:
            self._throttle()
            resp = self._client.get(API, params=params)
            resp.raise_for_status()
            payload = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("wikimedia_search_failed", query=query, error=str(exc))
            return []

        pages = (payload.get("query") or {}).get("pages") or {}
        results: list[StockImage] = []

        for page in pages.values():
            info = (page.get("imageinfo") or [{}])[0]
            mime = info.get("mime", "")
            if not mime.startswith("image/") or mime == "image/svg+xml":
                continue

            meta = info.get("extmetadata") or {}
            short = _clean((meta.get("LicenseShortName") or {}).get("value"))
            raw_license = _clean((meta.get("License") or {}).get("value"))
            code, version = _license_code(short, raw_license)
            if not is_commercial_safe(code):
                continue

            # `thumburl` at 1600px avoids pulling 30 MB originals. The API
            # appends utm_* tracking params, and upload.wikimedia.org replies
            # 403 to a request carrying them — strip the query string.
            url = info.get("thumburl") or info.get("url")
            if not url:
                continue
            url = url.split("?", 1)[0]

            title = _clean(page.get("title", "").replace("File:", "")) or ""
            title = re.sub(r"\.(jpe?g|png|webp|tiff?)$", "", title, flags=re.I)
            title = title.replace("_", " ")

            results.append(
                StockImage(
                    source=self.key,
                    external_id=str(page.get("pageid", "")),
                    title=title,
                    image_url=url,
                    creator=_clean((meta.get("Artist") or {}).get("value")),
                    license_code=code,
                    license_version=version,
                    license_url=_clean((meta.get("LicenseUrl") or {}).get("value")),
                    landing_url=page.get("canonicalurl")
                    or f"https://commons.wikimedia.org/?curid={page.get('pageid')}",
                    provider="Wikimedia Commons",
                    width=info.get("thumbwidth") or info.get("width"),
                    height=info.get("thumbheight") or info.get("height"),
                )
            )
            if len(results) >= limit:
                break

        logger.info("wikimedia_search", query=query, found=len(results))
        return results

    def download(self, image: StockImage) -> bytes:
        self._throttle()
        # Defensive: strip params here too, in case a StockImage was built
        # elsewhere with the API's tracking query intact.
        resp = self._client.get(image.image_url.split("?", 1)[0])
        resp.raise_for_status()
        return resp.content
