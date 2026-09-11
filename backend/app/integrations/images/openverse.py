"""Openverse adapter — Creative Commons image search.

Openverse indexes CC-licensed and public-domain images across Flickr, Wikimedia
Commons, museums and government archives. No API key is required for search,
and every result carries its licence, creator and original landing URL, which is
exactly what CC attribution needs.

The `license_type=commercial` filter is passed upstream **and** re-checked
locally in `is_commercial_safe` — a filter that silently changes meaning on the
provider's side must not be the only thing standing between us and an
NC-licensed photo on a commercial news site.
"""

from __future__ import annotations

import httpx

from app.core.logging import get_logger
from app.integrations.images.base import (
    StockImage,
    StockImageProvider,
    is_commercial_safe,
)

logger = get_logger(__name__)

API = "https://api.openverse.org/v1/images/"
USER_AGENT = "TeluguNewsPlatform/1.0 (editorial image sourcing)"


class OpenverseSource(StockImageProvider):
    key = "openverse"

    def __init__(self, timeout: float = 25.0) -> None:
        self.timeout = timeout

    def search(self, query: str, *, limit: int = 5) -> list[StockImage]:
        params = {
            "q": query,
            "page_size": str(max(limit * 3, limit)),  # over-fetch, then filter
            "license_type": "commercial",
            "mature": "false",
        }
        try:
            resp = httpx.get(
                API,
                params=params,
                headers={"User-Agent": USER_AGENT},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            payload = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("openverse_search_failed", query=query, error=str(exc))
            return []

        results: list[StockImage] = []
        for row in payload.get("results", []):
            license_code = row.get("license")
            if not is_commercial_safe(license_code):
                continue
            url = row.get("url")
            if not url:
                continue

            results.append(
                StockImage(
                    source=self.key,
                    external_id=str(row.get("id", "")),
                    title=(row.get("title") or "").strip(),
                    image_url=url,
                    creator=(row.get("creator") or "").strip() or None,
                    license_code=str(license_code),
                    license_version=row.get("license_version"),
                    license_url=row.get("license_url"),
                    landing_url=row.get("foreign_landing_url"),
                    provider=row.get("source") or row.get("provider"),
                    width=row.get("width"),
                    height=row.get("height"),
                )
            )
            if len(results) >= limit:
                break

        logger.info("openverse_search", query=query, found=len(results))
        return results

    def download(self, image: StockImage) -> bytes:
        resp = httpx.get(
            image.image_url,
            headers={"User-Agent": USER_AGENT},
            timeout=self.timeout,
            follow_redirects=True,
        )
        resp.raise_for_status()
        return resp.content
