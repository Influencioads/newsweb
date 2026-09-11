"""Google Cloud Text-to-Speech (updated doc §19).

Uses the REST endpoint with an API key rather than the client library, for the
same reason PyMySQL is preferred over mysqlclient here: no build toolchain, no
service-account file to mount, one setting to fill in.

Telugu is `te-IN`. Google returns base64 MP3, and reports no duration, so it is
estimated from the text — Telugu narration runs at roughly 12 characters per
second, which is close enough for a progress bar and is corrected on the client
once the audio element reports `duration`.
"""

from __future__ import annotations

import base64

import httpx

from app.core.config import settings
from app.core.errors import AiProviderError
from app.integrations.tts.base import Synthesis, TtsProvider

_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"
_CHARS_PER_SECOND = 12.0


class GoogleTts(TtsProvider):
    key = "google"

    def available(self) -> bool:
        return bool(settings.GOOGLE_TTS_API_KEY)

    def synthesise(
        self, text: str, *, language: str, voice: str | None = None
    ) -> Synthesis:
        if not self.available():
            raise AiProviderError(
                message_en="GOOGLE_TTS_API_KEY is not set.",
                details={"provider": self.key},
            )
        chosen = voice or settings.GOOGLE_TTS_VOICE or f"{language}-Standard-A"
        payload = {
            "input": {"text": text},
            "voice": {"languageCode": language, "name": chosen},
            "audioConfig": {"audioEncoding": "MP3", "speakingRate": 1.0},
        }
        try:
            response = httpx.post(
                _ENDPOINT,
                params={"key": settings.GOOGLE_TTS_API_KEY},
                json=payload,
                timeout=settings.AI_DEFAULT_TIMEOUT_MS / 1000,
            )
            response.raise_for_status()
            encoded = response.json().get("audioContent")
        except httpx.HTTPError as exc:
            raise AiProviderError(
                details={"provider": self.key, "error": str(exc)[:200]}
            ) from exc

        if not encoded:
            raise AiProviderError(
                details={"provider": self.key, "error": "empty response"}
            )
        audio = base64.b64decode(encoded)
        return Synthesis(
            audio=audio,
            mime="audio/mpeg",
            duration_sec=max(1, round(len(text) / _CHARS_PER_SECOND)),
            voice=chosen,
        )
