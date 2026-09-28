"""Sarvam AI text-to-speech (updated doc §19).

An Indic-first vendor billed on its own account, not through aimlapi, and the
reason to reach for it is the same reason `bhashini` is here: the voices were
trained on Indian languages rather than adapted to them. Unlike bhashini it is
configured entirely from the CMS settings screen — there is no environment
variable, because an admin pasting a key is the whole setup.

Three things about this API differ from every other adapter here, and each one
is a 4xx if got wrong. All three are from the published reference:

  * The key goes in `api-subscription-key`, not `Authorization: Bearer`.
  * The language field is `language_code` and it is an **enum** — an unlisted
    tag is a 422, so this adapter refuses one here rather than paying for it.
  * The reply is `{"audios": ["<base64>"]}`: a list of base64 strings, not
    audio bytes and not a URL to fetch.

The text ceiling is per model and counted in **characters** (1500 on v2, 2500
on v3), while the shared splitter counts UTF-8 bytes. Telugu is three bytes a
character, so 4500 bytes is 1500 characters and the two agree by accident —
until an English pull-quote makes a 4500-byte chunk 4500 characters long and
the call 422s. `max_chars` is what stops that; see `TtsProvider.max_chars`.
"""

from __future__ import annotations

import base64
import binascii

import httpx

from app.core.config import settings
from app.core.errors import AiProviderError
from app.integrations.ai import catalogue
from app.integrations.tts.base import Synthesis, TtsProvider, sniff_mime

_ENDPOINT = "https://api.sarvam.ai/text-to-speech"

#: Same estimate the aimlapi adapter uses, and for the same reason: it is only
#: shown until `audio_concat` measures the real WAV duration.
_CHARS_PER_SECOND = 13.0

#: The `language_code` enum, verbatim. Refusing an unlisted tag is deliberate:
#: silently substituting Telugu would hand a Hindi story audio nobody can use,
#: which is a worse failure than none because it looks like it worked.
_LANGUAGES = frozenset(
    {
        "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN",
        "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
    }
)


def _language_code(language: str) -> str:
    """`language` as the enum spells it, or "" if it has no spelling there.

    A bare `te` is accepted because the settings field is free text and that is
    the likeliest way to write it wrong while still meaning exactly one thing.
    """
    tag = (language or "").strip()
    if not tag:
        return ""
    for candidate in (tag, tag.replace("_", "-"), f"{tag}-IN"):
        for known in _LANGUAGES:
            if known.casefold() == candidate.casefold():
                return known
    return ""


def _vendor_error(response: httpx.Response) -> str:
    """What Sarvam actually objected to, not just the status line.

    This exists because of a real failure on 2026-09-19: the first live call
    answered 400 `"Model 'bulbul:v2' has been deprecated. Please use
    'bulbul:v3' instead."` — a message that names the problem AND the fix —
    and the adapter reported "The AI service is unavailable right now."
    An error an editor cannot act on is barely better than silence, and this
    one was one string away from being actionable.
    """
    try:
        detail = (response.json() or {}).get("error") or {}
        message = detail.get("message")
        if message:
            return f"{response.status_code}: {str(message)[:300]}"
    except ValueError:
        pass
    return f"{response.status_code}: {response.text[:200]}"


class SarvamTts(TtsProvider):
    key = "sarvam"
    #: The smaller of the two model ceilings. Picking per model would mean the
    #: splitter had to know which model is configured, and 1500 only costs a v3
    #: install some extra requests, never a failure.
    max_chars = catalogue.SARVAM_MAX_CHARS

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
        # Accepted only so `get_tts` can hand every configurable adapter the
        # same keywords. A base_url configured for the aimlapi account must not
        # end up in front of api.sarvam.ai — see `tts_credentials`, which is
        # where that is decided, and `_endpoint`, which refuses it anyway.
        self._base_url = (base_url or "").strip()
        self._model = (model or "").strip()
        self._voice = (voice or "").strip()
        self._speed = float(speed or 1.0)
        self.last_usage: dict[str, float | int] = {}

    @property
    def model_name(self) -> str:
        """Which model answers, resolved once so the request and the ledger row
        cannot disagree.

        The `sarvam/` prefix is how the one shared model dropdown tells this
        vendor's ids from aimlapi's; the API wants the bare name.
        """
        return catalogue.sarvam_model(self._model)

    def _endpoint(self) -> str:
        base = self._base_url.rstrip("/")
        if not base or "sarvam" not in base:
            return _ENDPOINT
        return base if base.endswith("/text-to-speech") else f"{base}/text-to-speech"

    def available(self) -> bool:
        return bool(self._api_key)

    def synthesise(
        self, text: str, *, language: str, voice: str | None = None
    ) -> Synthesis:
        if not self.available():
            raise AiProviderError(
                message_en="No Sarvam AI API key is configured.",
                message_te="Sarvam AI API కీ కాన్ఫిగర్ చేయలేదు.",
                details={"provider": self.key},
            )
        code = _language_code(language)
        if not code:
            raise AiProviderError(
                message_en=f"Sarvam AI does not speak {language!r}.",
                message_te="ఈ భాషను Sarvam AI మాట్లాడదు.",
                details={
                    "provider": self.key,
                    "error": f"language {language!r} is not one of "
                    f"{', '.join(sorted(_LANGUAGES))}",
                },
            )
        model = self.model_name
        payload: dict[str, object] = {
            "text": text,
            "language_code": code,
            "model": model,
        }
        # A speaker belongs to a model — v2's `anushka` is a 422 on v3 — so the
        # same repair `valid_voice` does for aimlapi applies here.
        speaker = catalogue.valid_voice(f"sarvam/{model}", voice or self._voice)
        if speaker:
            payload["speaker"] = speaker
        # `pace`, and only when it is not the default: at 1.0 the request keeps
        # its minimal shape, and the clamp stops a settings row written for
        # aimlapi's wider 0.25–4.0 from becoming a 422 here.
        if self._speed != 1.0:
            low, high = catalogue.sarvam_pace_range(model)
            payload["pace"] = round(min(high, max(low, self._speed)), 2)

        self.last_usage = {}
        try:
            response = httpx.post(
                self._endpoint(),
                json=payload,
                headers={
                    "api-subscription-key": self._api_key,
                    "Content-Type": "application/json",
                },
                timeout=settings.AI_DEFAULT_TIMEOUT_MS / 1000,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # The vendor explained itself; pass that through verbatim.
            raise AiProviderError(
                details={"provider": self.key, "error": _vendor_error(exc.response)}
            ) from exc
        except httpx.HTTPError as exc:
            # No response at all — timeout, DNS, TLS. Only the client has a say.
            raise AiProviderError(
                details={"provider": self.key, "error": str(exc)[:200]}
            ) from exc
        try:
            body = response.json()
        except ValueError as exc:
            raise AiProviderError(
                details={"provider": self.key, "error": "unexpected response shape"}
            ) from exc

        audio = self._decode(body)
        mime = sniff_mime(audio)
        if not mime:
            raise AiProviderError(
                details={
                    "provider": self.key,
                    "error": f"expected mp3 or wav, got {len(audio)} bytes",
                }
            )
        return Synthesis(
            audio=audio,
            mime=mime,
            duration_sec=max(1, round(len(text) / _CHARS_PER_SECOND)),
            voice=speaker or "",
            # Sarvam reports no spend in the response, so the ledger row lands
            # at zero paise — unknown, not free, exactly as ElevenLabs does.
            # Watch the Sarvam dashboard rather than this project's usage meter.
            usage={},
        )

    def _decode(self, body: object) -> bytes:
        """The one audio file out of `{"audios": [...]}`.

        Sarvam answers with a list because the field also serves a batch of
        inputs; this adapter sends one string, so anything past the first entry
        would be audio for text nobody submitted. Joining them is what a guess
        would do, and it is how you ship a file that says a sentence twice.
        """
        items = body.get("audios") if isinstance(body, dict) else None
        if not isinstance(items, list) or not items or not isinstance(items[0], str):
            raise AiProviderError(
                details={"provider": self.key, "error": "no audio in response"}
            )
        try:
            return base64.b64decode(items[0], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise AiProviderError(
                details={"provider": self.key, "error": "audio was not base64"}
            ) from exc
