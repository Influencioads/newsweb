"""aimlapi.com image generation (updated doc §15–18).

An editorial illustration is the one thing the stock-photo providers in
`integrations/images` cannot supply: there is no Wikimedia photograph of a
budget announcement, and the desk ends up publishing a story with no art. The
same key an admin pastes for the text features draws one, which is why this
adapter sits beside the chat adapter rather than in a package of its own.

What it refuses to do:
  * **Trust the header.** The mime comes from the magic bytes. The same
    measurement that produced the model table caught a vendor declaring
    `audio/wav` over MP3 bytes, and an error page arrives with a perfectly
    respectable `content-type` too.
  * **Guess a size.** Three vendor families spell a 16:9 frame in three
    incompatible fields and the wrong one is a 400, so the spelling is the
    catalogue's to own, not this module's.
  * **Store what it could not identify.** Bytes that are not an image are
    refused rather than handed to the media library.

Credentials arrive from the caller rather than the environment, so the CMS
settings screen is the place a key is configured. See `get_image`.
"""

from __future__ import annotations

import base64
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings
from app.core.errors import AiProviderError
from app.integrations.ai.catalogue import DEFAULT_IMAGE_MODEL, image_size_args

__all__ = ["AimlapiImage", "GeneratedImage", "ImageProvider", "get_image"]

#: Images are not text, so they do not get the text ceiling.
#: `AI_DEFAULT_TIMEOUT_MS` is 25 s; the two listed models rendered in 4–11 s,
#: but the slowest model on the account took 39 s and a request queued behind
#: other traffic waits on top of its own render. Abandoning a call that is
#: already being charged for is the worst outcome available, so this is set to
#: roughly twice the slowest measurement — loose enough for a bad day, still
#: bounded so a CMS request cannot hang forever.
_TIMEOUT_SEC = 90.0

#: Measured: gpt-image-1.5 answered PNG, the flux family JPEG. WebP needs two
#: checks, so it is tested separately below rather than sitting in this table.
_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)


#: The multipart field each reference picture travels in on `/images/edits`.
#: aimlapi's page for gpt-image-2.5-flare says `image` takes one file or a
#: list; OpenAI's own edits route spells a list `image[]`. Unverified against
#: the live route (2026-09-28): aimlapi ignores fields it does not know, so a
#: 200 proves nothing — if a drawing ignores its references, try "image".
EDIT_IMAGE_FIELD = "image[]"
#: The vendor takes 16; four is plenty to set a style and keeps the upload,
#: and the bill for its input tokens, small.
MAX_REFERENCES = 4


def _sniff(raw: bytes) -> str:
    """The real image type from the bytes, or `""` when these are not one."""
    for signature, mime in _MAGIC:
        if raw.startswith(signature):
            return mime
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return ""


@dataclass(slots=True)
class GeneratedImage:
    raw: bytes
    mime: str
    model: str
    #: The vendor's own usage envelope (`meta.usage`), carrying `usd_spent`.
    #: Converting that to paise is the ledger's job — the float stays the
    #: vendor's, and nothing downstream has to re-parse the reply to find it.
    usage: dict


class ImageProvider(ABC):
    key: str = "base"
    #: Usage reported by the most recent draw, in the vendor's own envelope.
    #: A draw that is charged and then fails to produce a storable image still
    #: has to reach the ledger, and the raise carries no body — so the caller
    #: reads it from here. Same name and role as `LlmAi.last_usage` and
    #: `TtsProvider.last_usage`. Replaced, never mutated in place.
    last_usage: dict[str, float | int] = {}

    @abstractmethod
    def available(self) -> bool:
        """Is this provider configured well enough to be called?"""

    @abstractmethod
    def generate(self, prompt: str, *, aspect: str = "16:9") -> GeneratedImage:
        """Draw `prompt`. Raises AiProviderError on failure."""


class AimlapiImage(ImageProvider):
    key = "aimlapi"

    def __init__(
        self,
        *,
        api_key: str = "",
        base_url: str = "",
        model: str = "",
    ) -> None:
        self._api_key = (api_key or "").strip()
        self._base_url = (base_url or "").strip()
        self._model = (model or "").strip()
        self.last_usage: dict[str, float | int] = {}

    def _resolved_key(self) -> str:
        return self._api_key or settings.AIMLAPI_API_KEY

    def _endpoint(self, route: str = "generations") -> str:
        base = (self._base_url or settings.AIMLAPI_BASE_URL or "").rstrip("/")
        if not base:
            return f"https://api.aimlapi.com/v1/images/{route}"
        if base.endswith("/images/generations"):
            return base.removesuffix("generations") + route
        # The shared base setting may point at /chat/completions; the images
        # route is a sibling of it, not a child.
        base = base.removesuffix("/chat/completions")
        return f"{base}/images/{route}"

    def available(self) -> bool:
        return bool(self._resolved_key())

    def _require_key(self) -> None:
        if not self.available():
            raise AiProviderError(
                message_en="No aimlapi API key is configured.",
                message_te="aimlapi API కీ కాన్ఫిగర్ చేయలేదు.",
                details={"provider": self.key},
            )

    def generate(self, prompt: str, *, aspect: str = "16:9") -> GeneratedImage:
        self._require_key()
        model = self._model or DEFAULT_IMAGE_MODEL
        payload: dict[str, object] = {"model": model, "prompt": prompt}
        # Only google's family names the frame as a ratio; the others spell
        # the shape as a keyword the catalogue owns, and inventing a second
        # keyword here would be the 400 that map exists to prevent.
        payload.update(image_size_args(model, aspect))
        return self._draw(self._endpoint(), model, json=payload)

    def edit(
        self,
        prompt: str,
        images: list[tuple[str, bytes, str]],
        *,
        aspect: str = "16:9",
    ) -> GeneratedImage:
        """Draw `prompt` with `images` — (filename, bytes, mime) — attached.

        The creative studio's design references: the model reads them for
        style. Multipart to `/images/edits`, the route beside generations.
        Only the gpt-image family documents that route, so any other model is
        a ValueError raised before anything is sent or billed.
        """
        self._require_key()
        model = self._model or DEFAULT_IMAGE_MODEL
        if not model.startswith("openai/gpt-image"):
            raise ValueError(f"{model} does not take reference images")
        if not images or len(images) > MAX_REFERENCES:
            raise ValueError(f"between 1 and {MAX_REFERENCES} reference images")
        data = {"model": model, "prompt": prompt, **image_size_args(model, aspect)}
        files = [(EDIT_IMAGE_FIELD, image) for image in images]
        return self._draw(self._endpoint("edits"), model, data=data, files=files)

    def _draw(self, url: str, model: str, **request: Any) -> GeneratedImage:
        """POST one draw and parse the reply, whichever route it went to."""
        self.last_usage = {}
        try:
            # No Content-Type here: httpx writes it from `json=`, and for
            # multipart it must carry the boundary httpx generates.
            response = httpx.post(
                url,
                headers={"Authorization": f"Bearer {self._resolved_key()}"},
                timeout=_TIMEOUT_SEC,
                **request,
            )
            response.raise_for_status()
            body = response.json()
        except httpx.HTTPError as exc:
            raise AiProviderError(
                details={"provider": self.key, "error": str(exc)[:200]}
            ) from exc
        except ValueError as exc:  # not JSON
            raise AiProviderError(
                details={"provider": self.key, "error": "unexpected response shape"}
            ) from exc

        # Before any of the raises below, because every one of them describes a
        # draw the vendor has already billed: an unsupported format from
        # `_sniff`, an undecodable payload, a signed URL that 404s. Recorded
        # without this, a charged draw lands in the ledger at zero paise.
        self.last_usage = ((body or {}).get("meta") or {}).get("usage") or {}

        data = (body or {}).get("data") or []
        entry = data[0] if data and isinstance(data[0], dict) else {}
        raw = self._image_bytes(entry)

        mime = _sniff(raw)
        if not mime:
            # An HTML or JSON body here is an error page the transport did not
            # treat as a failure. Storing it would put a text file in the media
            # library behind an image URL, and the failure would only show up
            # on the reader's screen.
            raise AiProviderError(
                details={
                    "provider": self.key,
                    "error": f"expected an image, got {len(raw)} unrecognised bytes",
                }
            )
        return GeneratedImage(
            raw=raw,
            mime=mime,
            # What answered, not what was asked for: aimlapi resolves aliases,
            # and the ledger should record the id that was actually billed.
            model=str((body or {}).get("model") or model),
            usage=self.last_usage,
        )

    def _image_bytes(self, entry: dict) -> bytes:
        """The image itself, whichever of the two envelopes it arrived in."""
        encoded = entry.get("b64_json")
        if encoded:
            try:
                return base64.b64decode(encoded)
            except (ValueError, TypeError) as exc:  # binascii.Error, or not text
                raise AiProviderError(
                    details={"provider": self.key, "error": "undecodable b64_json"}
                ) from exc
        url = entry.get("url")
        if not url:
            raise AiProviderError(
                details={"provider": self.key, "error": "no image in response"}
            )
        try:
            # The file URL answers 302 to a signed S3 location.
            fetched = httpx.get(url, timeout=_TIMEOUT_SEC, follow_redirects=True)
            fetched.raise_for_status()
        except httpx.HTTPError as exc:
            raise AiProviderError(
                details={
                    "provider": self.key,
                    "error": f"image fetch: {str(exc)[:160]}",
                }
            ) from exc
        return fetched.content


def get_image(
    provider: str | None = None,
    *,
    api_key: str = "",
    base_url: str = "",
    model: str = "",
) -> ImageProvider | None:
    """The configured image provider, or None when there is not one.

    None rather than a raise, and None rather than a keyless fallback: nothing
    draws an illustration without a paid key, so the honest answer to "no key"
    is "this install cannot draw". The CMS screen stays usable and simply hides
    the button, the same way `get_ai` degrades to the heuristic instead of
    taking the AI screens down.

    A blank name resolves to aimlapi because it is the only provider here; an
    unknown one is a typo in a settings row, and a typo must not cost an editor
    a paid call against the wrong vendor.
    """
    if (provider or "aimlapi").lower() != "aimlapi":
        return None
    candidate = AimlapiImage(api_key=api_key, base_url=base_url, model=model)
    return candidate if candidate.available() else None
