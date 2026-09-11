"""Bhashini / AI4Bharat TTS (updated doc §19).

The Indian government's language stack. Free tier, Indic-first voices, and it
does not send Telugu editorial copy to a US provider — worth having as a real
option rather than a footnote.

Bhashini's inference endpoint is pipeline-based: the caller supplies the
pipeline id and auth token issued for their account. Both are settings, so no
account details are compiled in.
"""

from __future__ import annotations

import base64

import httpx

from app.core.config import settings
from app.core.errors import AiProviderError
from app.integrations.tts.base import Synthesis, TtsProvider

_CHARS_PER_SECOND = 12.0


class BhashiniTts(TtsProvider):
    key = "bhashini"

    def available(self) -> bool:
        return bool(settings.BHASHINI_API_KEY and settings.BHASHINI_ENDPOINT)

    def synthesise(
        self, text: str, *, language: str, voice: str | None = None
    ) -> Synthesis:
        if not self.available():
            raise AiProviderError(
                message_en="BHASHINI_API_KEY / BHASHINI_ENDPOINT are not set.",
                details={"provider": self.key},
            )
        gender = voice or settings.BHASHINI_VOICE or "female"
        payload = {
            "pipelineTasks": [
                {
                    "taskType": "tts",
                    "config": {
                        "language": {"sourceLanguage": language.split("-")[0]},
                        "gender": gender,
                        "samplingRate": 22050,
                    },
                }
            ],
            "inputData": {"input": [{"source": text}]},
        }
        headers = {"Authorization": settings.BHASHINI_API_KEY}
        if settings.BHASHINI_PIPELINE_ID:
            headers["x-pipeline-id"] = settings.BHASHINI_PIPELINE_ID
        try:
            response = httpx.post(
                settings.BHASHINI_ENDPOINT,
                json=payload,
                headers=headers,
                timeout=settings.AI_DEFAULT_TIMEOUT_MS / 1000,
            )
            response.raise_for_status()
            body = response.json()
            audio_list = (body.get("pipelineResponse") or [{}])[0].get("audio") or []
            encoded = (audio_list[0] if audio_list else {}).get("audioContent")
        except (httpx.HTTPError, IndexError, AttributeError, ValueError) as exc:
            raise AiProviderError(
                details={"provider": self.key, "error": str(exc)[:200]}
            ) from exc

        if not encoded:
            raise AiProviderError(
                details={"provider": self.key, "error": "empty response"}
            )
        return Synthesis(
            audio=base64.b64decode(encoded),
            mime="audio/wav",
            duration_sec=max(1, round(len(text) / _CHARS_PER_SECOND)),
            voice=gender,
        )
