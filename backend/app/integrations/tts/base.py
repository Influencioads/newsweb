"""Text-to-speech provider contract (updated doc §19).

Same shape as the storage package: the service layer talks to this interface,
never to a vendor SDK, so swapping Google for Bhashini is a settings change
rather than a code change.

A provider returns raw audio bytes. Storing them, hashing the input, and
enforcing the §21 budget are the service's job, not the provider's — that way
every provider gets the same caching and cost ceiling for free.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(slots=True)
class Synthesis:
    audio: bytes
    mime: str
    duration_sec: int
    voice: str


class TtsProvider(ABC):
    key: str = "base"
    #: False means "this provider cannot produce a file" — the reader falls back
    #: to the on-device voice, which is exactly the pre-§19 behaviour.
    can_synthesise: bool = True

    @abstractmethod
    def synthesise(
        self, text: str, *, language: str, voice: str | None = None
    ) -> Synthesis:
        """Render `text` to audio. Raises AiProviderError on failure."""

    def available(self) -> bool:
        """Is this provider configured well enough to be called?"""
        return self.can_synthesise
