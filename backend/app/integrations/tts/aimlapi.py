"""aimlapi.com text-to-speech (updated doc §19).

aimlapi fronts many vendors behind one account and one `/v1/tts` route, which
is the whole reason this adapter exists: the key an admin pastes for the text
features also produces audio, and the shipped default (`local`) deliberately
cannot synthesise.

What it does *not* do is make the vendors agree. Measured on 2026-09-18 with
this project's own key, `/v1/tts` answers in two entirely different ways —
openai, qwen, minimax and hume return a JSON envelope pointing at a rendered
file, while elevenlabs and deepgram return the audio itself — and the three
things they disagree about (envelope shape, container, voice enum) are each a
model that silently cost money and produced nothing. Every branch below is a
response this account actually received, not a defensive guess.

Credentials arrive from the caller rather than the environment, so the CMS
settings screen is the place a key is configured. See `get_tts`.
"""

from __future__ import annotations

import time

import httpx

from app.core.config import settings
from app.core.errors import AiProviderError
from app.integrations.ai import catalogue
from app.integrations.tts.base import Synthesis, TtsProvider

#: Telugu speech runs slower than English prose. The service only uses this to
#: show a duration before the file is measured properly, so an approximation
#: that errs short is better than one that errs long.
_CHARS_PER_SECOND = 13.0

#: Attempts at the *rendered file*, not at the synthesis. Three and a short
#: linear backoff cover the measured burst without holding a request open long
#: enough to matter; see `_fetch_envelope`.
_FETCH_ATTEMPTS = 3
_FETCH_BACKOFF_SEC = 0.5


def _sniff_mime(audio: bytes) -> str:
    """The container these bytes actually are, or "" for neither.

    The response's own `content-type` is deliberately not consulted, because it
    is a measured lie rather than a theoretical risk: `elevenlabs/*` declares
    `audio/wav` and sends MP3, while qwen, hume and deepgram send real WAV. A
    WAV stored as `audio/mpeg` is a silent player failure on the reader's
    device, so the magic bytes are the only thing worth trusting.

    Refusing everything else is the same guard the old code spelled as "did the
    body start with JSON or HTML": an error page the transport accepted must
    never reach the audio column.
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


class AimlapiTts(TtsProvider):
    key = "aimlapi"

    def __init__(
        self,
        *,
        api_key: str = "",
        base_url: str = "",
        model: str = "",
        voice: str = "",
        speed: float = 1.0,
    ) -> None:
        self._api_key = (api_key or "").strip()
        self._base_url = (base_url or "").strip()
        self._model = (model or "").strip()
        self._voice = (voice or "").strip()
        # Clamped rather than validated: aimlapi answers 400 to a speed outside
        # its range, and that 400 arrives *after* the POST has been billed. A
        # settings row from before this range was known costs the reader a
        # slightly-wrong pace; refusing it costs them the audio and us the call.
        low, high = catalogue.TTS_SPEED_RANGE
        self._speed = min(high, max(low, float(speed or 1.0)))
        #: Usage reported by the most recent call; the service writes it to the
        #: ledger. Same name and role as `LlmAi.last_usage`.
        self.last_usage: dict[str, float | int] = {}

    def _resolved_key(self) -> str:
        return self._api_key or settings.AIMLAPI_API_KEY

    @property
    def model_name(self) -> str:
        """Which model actually answers, for the ledger row. Resolved here so
        it can never drift from the model the request is sent to."""
        return self._model or catalogue.DEFAULT_TTS_MODEL

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
        model = self.model_name
        # Every vendor has its own voice enum — `alloy` is OpenAI-only and a
        # 400 anywhere else — and minimax and hume take no `voice` field at
        # all, so None means omit the key rather than send an empty one.
        chosen = catalogue.valid_voice(model, voice or self._voice)
        payload: dict[str, object] = {
            "model": model,
            # aimlapi names this `text`, not OpenAI's `input`.
            "text": text,
        }
        if chosen:
            payload["voice"] = chosen
        # The one tone field aimlapi forwards, and only to the models that
        # declare it. At 1.0 it is omitted: the default payload stays exactly
        # the shape every branch below was measured against.
        if self._speed != 1.0 and catalogue.tts_accepts_speed(model):
            payload["speed"] = self._speed

        timeout = settings.AI_DEFAULT_TIMEOUT_MS / 1000
        self.last_usage = {}
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
        except httpx.HTTPError as exc:
            raise AiProviderError(
                details={"provider": self.key, "error": str(exc)[:200]}
            ) from exc

        # Two answers, not one. elevenlabs and deepgram hand back the audio
        # itself; the rest hand back an envelope and a second round trip. The
        # old code called .json() on both, so those four models could never
        # work — and were billed for every attempt.
        if response.headers.get("content-type", "").startswith("application/json"):
            audio = self._fetch_envelope(response, timeout)
        else:
            audio = response.content

        mime = _sniff_mime(audio)
        if not mime:
            raise AiProviderError(
                details={
                    "provider": self.key,
                    "error": "expected mp3 or wav, got "
                    f"{len(audio)} bytes declared "
                    f"{response.headers.get('content-type') or 'nothing'}",
                }
            )
        return Synthesis(
            audio=audio,
            mime=mime,
            duration_sec=max(1, round(len(text) / _CHARS_PER_SECOND)),
            voice=chosen or "",
            usage=self.last_usage,
        )

    def _fetch_envelope(self, response: httpx.Response, timeout: float) -> bytes:
        """Follow a JSON envelope to the rendered file.

        Two documented shapes, and the published schema is not the one that
        answers: every model measured returned `{"audio": {"url": …}}` while
        the schema promises `{"audio": "<uri>"}`. Both are accepted, because
        picking one is guessing which side changes next.
        """
        try:
            body = response.json()
        except ValueError as exc:
            raise AiProviderError(
                details={"provider": self.key, "error": "unexpected response shape"}
            ) from exc

        self.last_usage = self._read_usage(body)
        field = (body or {}).get("audio")
        url = field.get("url") if isinstance(field, dict) else field
        if not url or not isinstance(url, str):
            raise AiProviderError(
                details={"provider": self.key, "error": "no audio url in response"}
            )
        # The file URL answers 302 to a signed S3 location — measured on
        # 2026-09-18 as an OVH-backed host whose TLS handshake intermittently
        # dies with "SSL: UNEXPECTED_EOF_WHILE_READING": ten clean downloads,
        # then four failures in a row on the same host, then a success. Retrying
        # is free — the synthesis is already paid for and the file is already
        # rendered — and it is the only retry there is, because a single hiccup
        # otherwise writes the asset FAILED and `ensure_audio` deliberately
        # never retries a FAILED row, so the article loses its audio until a
        # human notices. The POST above is never retried: that one costs money.
        last: httpx.HTTPError | None = None
        for attempt in range(_FETCH_ATTEMPTS):
            if attempt:
                time.sleep(_FETCH_BACKOFF_SEC * attempt)
            try:
                fetched = httpx.get(url, timeout=timeout, follow_redirects=True)
                fetched.raise_for_status()
                return fetched.content
            except httpx.HTTPError as exc:
                last = exc
        raise AiProviderError(
            details={
                "provider": self.key,
                "error": f"audio fetch: {str(last)[:160]}",
            }
        ) from last

    @staticmethod
    def _read_usage(body: dict) -> dict[str, float | int]:
        """aimlapi's own spend line — the same `meta.usage` `LlmAi` reads.

        Only the envelope carries it. elevenlabs and deepgram reported no cost
        at all in the measured run, so their ledger rows land at zero paise:
        unknown, not free. Watch the vendor balance for those.
        """
        meta = ((body or {}).get("meta") or {}).get("usage") or {}
        if not isinstance(meta, dict) or meta.get("usd_spent") is None:
            return {}
        return {"usd_spent": float(meta["usd_spent"])}
