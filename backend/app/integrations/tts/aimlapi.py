"""aimlapi.com text-to-speech (updated doc §19).

aimlapi fronts many vendors behind one account, and its speech route follows
the OpenAI `/v1/audio/speech` shape: JSON in, raw audio bytes out — no base64
envelope, unlike Google's. That means the same key an admin pastes for the
text features also produces audio, which is the whole reason this adapter
exists: audio bulletins need a real voice, and the shipped default (`local`)
deliberately cannot synthesise.

Credentials arrive from the caller rather than the environment, so the CMS
settings screen is the place a key is configured. See `get_tts`.
"""

from __future__ import annotations

import httpx

from app.core.config import settings
from app.core.errors import AiProviderError
from app.integrations.tts.base import Synthesis, TtsProvider

#: Telugu speech runs slower than English prose. The service only uses this to
#: show a duration before the file is measured properly, so an approximation
#: that errs short is better than one that errs long.
_CHARS_PER_SECOND = 13.0

_DEFAULT_MODEL = "openai/gpt-4o-mini-tts"
_DEFAULT_VOICE = "alloy"


class AimlapiTts(TtsProvider):
    key = "aimlapi"

    def __init__(
        self,
        *,
        api_key: str = "",
        base_url: str = "",
        model: str = "",
        voice: str = "",
    ) -> None:
        self._api_key = (api_key or "").strip()
        self._base_url = (base_url or "").strip()
        self._model = (model or "").strip()
        self._voice = (voice or "").strip()

    def _resolved_key(self) -> str:
        return self._api_key or settings.AIMLAPI_API_KEY

    def _endpoint(self) -> str:
        base = (self._base_url or settings.AIMLAPI_BASE_URL or "").rstrip("/")
        if not base:
            return "https://api.aimlapi.com/v1/tts"
        if base.endswith("/tts"):
            return base
        # The chat adapter's base setting may point at /chat/completions; the
        # speech route is a sibling of it, not a child.
        base = base.removesuffix("/chat/completions")
        return f"{base}/tts"

    def available(self) -> bool:
        return bool(self._resolved_key())

    def synthesise(
        self, text: str, *, language: str, voice: str | None = None
    ) -> Synthesis:
        if not self.available():
            raise AiProviderError(
                message_en="No aimlapi API key is configured.",
                message_te="aimlapi API కీ కాన్ఫిగర్ చేయలేదు.",
                details={"provider": self.key},
            )
        chosen = voice or self._voice or _DEFAULT_VOICE
        payload = {
            "model": self._model or _DEFAULT_MODEL,
            # aimlapi names this `text`, not OpenAI's `input`.
            "text": text,
            "voice": chosen,
        }
        timeout = settings.AI_DEFAULT_TIMEOUT_MS / 1000
        try:
            response = httpx.post(
                self._endpoint(),
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._resolved_key()}",
                    "Content-Type": "application/json",
                },
                timeout=timeout,
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

        # The reply is an envelope pointing at the rendered file, not the audio
        # itself, so synthesising takes two round trips.
        url = ((body or {}).get("audio") or {}).get("url")
        if not url:
            raise AiProviderError(
                details={"provider": self.key, "error": "no audio url in response"}
            )
        try:
            # The file URL answers 302 to a signed S3 location.
            fetched = httpx.get(url, timeout=timeout, follow_redirects=True)
            fetched.raise_for_status()
            audio = fetched.content
        except httpx.HTTPError as exc:
            raise AiProviderError(
                details={"provider": self.key, "error": f"audio fetch: {str(exc)[:160]}"}
            ) from exc

        # An HTML or JSON body here would be an error page the transport did not
        # treat as a failure. Storing it would put a text file in the audio
        # column and the player would fail silently on the reader's device.
        content_type = fetched.headers.get("content-type", "")
        if not audio or content_type.startswith(("application/json", "text/")):
            raise AiProviderError(
                details={
                    "provider": self.key,
                    "error": f"expected audio, got {content_type or 'nothing'}",
                }
            )
        return Synthesis(
            audio=audio,
            mime="audio/mpeg",
            duration_sec=max(1, round(len(text) / _CHARS_PER_SECOND)),
            voice=chosen,
        )
