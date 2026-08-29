"""Licensed image sources.

`get_image_source()` is the only way feature code obtains a provider, so adding
a paid agency feed later is a registry change rather than a rewrite.
"""

from __future__ import annotations

from functools import lru_cache

from app.integrations.images.base import (
    COMMERCIAL_SAFE_LICENSES,
    StockImage,
    StockImageProvider,
    is_commercial_safe,
)
from app.integrations.images.openverse import OpenverseSource
from app.integrations.images.wikimedia import WikimediaSource

__all__ = [
    "COMMERCIAL_SAFE_LICENSES",
    "OpenverseSource",
    "WikimediaSource",
    "StockImage",
    "StockImageProvider",
    "get_image_source",
    "is_commercial_safe",
]


@lru_cache
def get_image_source(provider: str = "wikimedia") -> StockImageProvider:
    """Default is Wikimedia Commons: Openverse rate-limits anonymous clients
    hard, while Commons serves generous traffic to a properly identified
    User-Agent and has deeper coverage of Indian subjects."""
    match provider.lower():
        case "wikimedia" | "commons":
            return WikimediaSource()
        case "openverse":
            return OpenverseSource()
        case _:
            raise ValueError(f"Unknown image source '{provider}'")
