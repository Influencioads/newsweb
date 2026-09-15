"""TTS provider factory (updated doc §19).

Deliberately **not** `lru_cache`d on no arguments: the provider is chosen by an
editable setting (§20), so it has to be resolvable per call. Constructing one is
just an object with two config reads, so there is nothing to cache.
"""

from __future__ import annotations

from app.integrations.tts.aimlapi import AimlapiTts
from app.integrations.tts.base import Synthesis, TtsProvider
from app.integrations.tts.bhashini import BhashiniTts
from app.integrations.tts.google import GoogleTts
from app.integrations.tts.local import LocalTts

__all__ = [
    "AimlapiTts",
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
    "aimlapi": AimlapiTts,
}

#: Adapters that take their credentials from the caller (the editable settings)
#: rather than reading the environment themselves.
_CONFIGURABLE = {"aimlapi"}


def get_tts(
    provider: str | None = None,
    *,
    api_key: str = "",
    base_url: str = "",
    model: str = "",
    voice: str = "",
) -> TtsProvider:
    """An unknown name falls back to `local` rather than raising: a typo in a
    settings row must not take article pages down, it must only mean no audio.

    Credentials are keyword-only and optional so the older adapters, which read
    the environment for themselves, keep their existing constructor.
    """
    name = (provider or "local").lower()
    chosen = _PROVIDERS.get(name, LocalTts)
    if name in _CONFIGURABLE:
        return chosen(api_key=api_key, base_url=base_url, model=model, voice=voice)
    return chosen()
