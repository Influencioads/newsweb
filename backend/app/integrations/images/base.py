"""Licensed stock-image source contract.

A newsroom cannot lift photographs from another publisher: press photos are
licensed works (agency, wire, or staff), and §12.5 makes the rule explicit —
"wire copy can only be used under licence... Photos need credit — enforce at the
DB level (not null when source != own)."

So this layer only ever talks to sources whose licence permits commercial reuse,
and it carries the licence and attribution back with every result. The credit is
not decoration; `media.credit` is populated from it and publishing is blocked
without one.

Adapters live beside this file:
  * `openverse`  — Creative Commons search across Flickr, Wikimedia, museums
  * `wikimedia`  — Commons directly (CC / public domain)
  * future: Unsplash, Pexels, or a paid agency feed, same interface
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class StockImage:
    """One licensed image, with everything needed to credit it correctly."""

    source: str
    """Provider key, e.g. 'openverse'."""

    external_id: str
    title: str
    image_url: str
    """Direct URL to the image bytes."""

    creator: str | None
    """Photographer or uploader, as the licence requires us to name them."""

    license_code: str
    """Short code, e.g. 'by', 'by-sa', 'cc0', 'pdm'."""

    license_version: str | None
    license_url: str | None
    landing_url: str | None
    """Where the original lives — part of proper CC attribution."""

    provider: str | None = None
    """Upstream host, e.g. 'flickr', 'wikimedia'."""

    width: int | None = None
    height: int | None = None

    @property
    def license_label(self) -> str:
        """Human-readable licence, e.g. 'CC BY 2.0' or 'Public domain'."""
        code = (self.license_code or "").lower()
        if code in {"cc0", "pdm"}:
            return "Public domain" if code == "pdm" else "CC0"
        label = f"CC {code.upper().replace('-', ' ')}"
        return f"{label} {self.license_version}".strip() if self.license_version else label

    @property
    def attribution(self) -> str:
        """The credit line stored in `media.credit`.

        Format: "Creator / Provider (Licence)". CC-BY family licences require
        naming the creator and the licence; this string satisfies that wherever
        the image is displayed.
        """
        parts: list[str] = []
        if self.creator:
            parts.append(self.creator)
        if self.provider:
            parts.append(self.provider.title())
        who = " / ".join(parts) if parts else (self.source.title())
        return f"{who} ({self.license_label})"


#: Licence codes we allow. Non-commercial (`nc`) and no-derivatives (`nd`) are
#: excluded: a news site is a commercial publication and crops images to fit.
COMMERCIAL_SAFE_LICENSES = frozenset({"by", "by-sa", "cc0", "pdm"})


def is_commercial_safe(license_code: str | None) -> bool:
    code = (license_code or "").lower().strip()
    if not code:
        return False
    if "nc" in code.split("-") or "nd" in code.split("-"):
        return False
    return code in COMMERCIAL_SAFE_LICENSES


class StockImageProvider(ABC):
    key: str = "base"

    @abstractmethod
    def search(self, query: str, *, limit: int = 5) -> list[StockImage]:
        """Return licensed images matching `query`, commercial-safe only."""

    @abstractmethod
    def download(self, image: StockImage) -> bytes:
        """Fetch the image bytes."""
