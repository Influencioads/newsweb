"""The no-provider provider (updated doc §19).

Ships as the default so the platform runs with no TTS account at all. It never
synthesises: `available()` is False, `tts_service` therefore stores nothing, and
the reader UI falls back to the device voice it already used before §19 — which
means enabling voice in settings without configuring a provider degrades
gracefully instead of erroring on every article.
"""

from __future__ import annotations

from app.core.errors import AiProviderError
from app.integrations.tts.base import Synthesis, TtsProvider


class LocalTts(TtsProvider):
    key = "local"
    can_synthesise = False

    def synthesise(self, text: str, *, language: str, voice: str | None = None) -> Synthesis:
        raise AiProviderError(
            message_en="No server-side voice provider is configured.",
            message_te="సర్వర్ వాయిస్ ప్రొవైడర్ కాన్ఫిగర్ చేయలేదు.",
            details={"provider": "local"},
        )
