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
from dataclasses import dataclass, field


def sniff_mime(audio: bytes) -> str:
    """The container these bytes actually are, or "" for neither.

    A response's own `content-type` is deliberately not consulted, because it
    is a measured lie rather than a theoretical risk: aimlapi's
    `elevenlabs/*` declares `audio/wav` and sends MP3, while qwen, hume and
    deepgram send real WAV. A WAV stored as `audio/mpeg` is a silent player
    failure on the reader's device, so the magic bytes are the only thing worth
    trusting.

    Refusing everything else is the same guard the old code spelled as "did the
    body start with JSON or HTML": an error page the transport accepted must
    never reach the audio column.

    It lives here, not in one adapter, because every provider needs the same
    answer — Sarvam hands back base64 whose container its own settings decide,
    and trusting the declared type there would be the identical bug.
    """
    if audio[:4] == b"RIFF" and audio[8:12] == b"WAVE":
        return "audio/wav"
    if audio[:3] == b"ID3":
        return "audio/mpeg"
    if len(audio) >= 2 and audio[0] == 0xFF and audio[1] & 0xE0 == 0xE0:
        # MPEG frame sync, i.e. an MP3 with no ID3 tag. The sync word is
        # ELEVEN bits, so the mask is 0xE0: 0xF0 would only match 0xEn, which
        # is MPEG-2.5, and would refuse the FF FB / FF FA / FF F3 that
        # `elevenlabs/*` mp3_44100_* actually returns — after it was billed.
        return "audio/mpeg"
    return ""


@dataclass(slots=True)
class Synthesis:
    audio: bytes
    mime: str
    duration_sec: int
    voice: str
    #: What the vendor said this call cost, in its own envelope (aimlapi
    #: reports `meta.usage.usd_spent`). The service sums it across segments and
    #: writes one ledger row; see `ai_usage_service.record`. Empty is the honest
    #: answer for a provider that reports nothing, and for the local no-op.
    usage: dict[str, float | int] = field(default_factory=dict)


class TtsProvider(ABC):
    key: str = "base"
    #: False means "this provider cannot produce a file" — the reader falls back
    #: to the on-device voice, which is exactly the pre-§19 behaviour.
    can_synthesise: bool = True
    #: Usage reported by the most recent synthesis, in the provider's own
    #: envelope. `synthesise_long` leaves the sum across segments here, and
    #: `ensure_audio` bills it. Replaced, never mutated in place.
    last_usage: dict[str, float | int] = {}
    #: A per-request **character** ceiling, on top of the shared UTF-8 byte
    #: one `audio_concat` enforces. 0 means the provider has none worth
    #: declaring. Two units rather than one because the vendors genuinely
    #: disagree: Google caps bytes, Sarvam caps characters, and for Telugu
    #: those differ by three times. `synthesise_long` is the only caller.
    max_chars: int = 0

    @abstractmethod
    def synthesise(
        self, text: str, *, language: str, voice: str | None = None
    ) -> Synthesis:
        """Render `text` to audio. Raises AiProviderError on failure."""

    def available(self) -> bool:
        """Is this provider configured well enough to be called?"""
        return self.can_synthesise
