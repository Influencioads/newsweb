"""TTS provider factory (updated doc §19).

Deliberately **not** `lru_cache`d on no arguments: the provider is chosen by an
editable setting (§20), so it has to be resolvable per call. Constructing one is
just an object with two config reads, so there is nothing to cache.
"""

from __future__ import annotations

from app.integrations.tts.base import Synthesis, TtsProvider
from app.integrations.tts.bhashini import BhashiniTts
from app.integrations.tts.google import GoogleTts
from app.integrations.tts.local import LocalTts

__all__ = [
    "BhashiniTts",
    "GoogleTts",
    "LocalTts",
    "Synthesis",
    "TtsProvider",
    "get_tts",
]

_PROVIDERS: dict[str, type[TtsProvider]] = {
    "local": LocalTts,
    "google": GoogleTts,
    "bhashini": BhashiniTts,
}


def get_tts(provider: str | None = None) -> TtsProvider:
    """An unknown name falls back to `local` rather than raising: a typo in a
    settings row must not take article pages down, it must only mean no audio."""
    return _PROVIDERS.get((provider or "local").lower(), LocalTts)()
