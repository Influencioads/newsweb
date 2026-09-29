"""Sarvam AI TTS: the four things about this vendor that differ from aimlapi.

Each test here is one way the request or the reply is shaped differently, and
every one of them is a 4xx or a silent empty file if got wrong. They are the
cheap version of the measurement the aimlapi adapter's comments describe —
nobody has run these against a live key, so the checks are on what this code
*sends* and *accepts*, not on what Sarvam returns.
"""

from __future__ import annotations

import base64
import io
import struct
import wave

import httpx
import pytest

from app.core.errors import AiProviderError
from app.integrations.ai import catalogue
from app.integrations.tts import SarvamTts, get_tts
from app.services import audio_concat


def _wav() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8000)
        out.writeframes(b"".join(struct.pack("<h", 0) for _ in range(80)))
    return buffer.getvalue()


WAV = _wav()


class _Transport:
    """Answers one reply and keeps the request and headers that got it."""

    def __init__(self, body: object, status: int = 200) -> None:
        self.body, self.status = body, status
        self.payload: dict = {}
        self.headers: dict = {}
        self.url = ""

    def post(self, url: str, *, json: dict, headers: dict, **_kw: object):
        self.url, self.payload, self.headers = url, json, headers
        return httpx.Response(
            self.status,
            json=self.body,
            request=httpx.Request("POST", url),
        )


def _install(monkeypatch: pytest.MonkeyPatch, transport: _Transport) -> None:
    monkeypatch.setattr("app.integrations.tts.sarvam.httpx.post", transport.post)


def _ok(audio: bytes = WAV) -> dict:
    return {"request_id": "r-1", "audios": [base64.b64encode(audio).decode()]}


class TestRequestShape:
    def test_the_key_is_a_subscription_header_not_a_bearer_token(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The one thing every other adapter here does differently. A Bearer
        token is a 403 on an otherwise perfect request."""
        transport = _Transport(_ok())
        _install(monkeypatch, transport)
        SarvamTts(api_key="sk_test").synthesise("హలో", language="te-IN")
        assert transport.headers["api-subscription-key"] == "sk_test"
        assert "Authorization" not in transport.headers
        assert transport.url == "https://api.sarvam.ai/text-to-speech"

    def test_the_language_field_is_language_code_and_a_bare_tag_is_repaired(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        transport = _Transport(_ok())
        _install(monkeypatch, transport)
        SarvamTts(api_key="k").synthesise("హలో", language="te")
        assert transport.payload["language_code"] == "te-IN"
        assert "target_language_code" not in transport.payload

    def test_an_unsupported_language_is_refused_before_it_is_billed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Substituting Telugu would hand a Japanese story audio nobody can
        use, which reads as success. Refusing is the honest failure."""
        transport = _Transport(_ok())
        _install(monkeypatch, transport)
        with pytest.raises(AiProviderError):
            SarvamTts(api_key="k").synthesise("hello", language="ja-JP")
        assert transport.payload == {}, "the call must not have been made"

    def test_a_speaker_from_the_other_model_is_replaced_not_sent(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`anushka` is v2 only; on v3 it is a 422. `alloy` belongs to OpenAI
        and is a 422 here in either model."""
        transport = _Transport(_ok())
        _install(monkeypatch, transport)
        SarvamTts(api_key="k", model="sarvam/bulbul:v3", voice="anushka").synthesise(
            "హలో", language="te-IN"
        )
        assert transport.payload["speaker"] in catalogue.tts_voices("sarvam/bulbul:v3")
        assert transport.payload["model"] == "bulbul:v3"

    def test_pace_is_omitted_at_one_and_clamped_to_the_model_range(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A settings row written for aimlapi's 0.25–4.0 must not become a 422
        here, and the default request keeps its minimal shape."""
        transport = _Transport(_ok())
        _install(monkeypatch, transport)
        SarvamTts(api_key="k", speed=1.0).synthesise("హలో", language="te-IN")
        assert "pace" not in transport.payload

        SarvamTts(api_key="k", model="sarvam/bulbul:v3", speed=4.0).synthesise(
            "హలో", language="te-IN"
        )
        assert transport.payload["pace"] == 2.0

    def test_a_model_left_behind_by_the_other_provider_falls_back(self) -> None:
        """`voice.model` is one row shared with aimlapi. Switching provider
        leaves an `openai/…` id in it, and sending that is a 422."""
        assert SarvamTts(api_key="k", model="openai/gpt-4o-mini-tts").model_name == (
            catalogue.DEFAULT_SARVAM_MODEL
        )
        assert SarvamTts(api_key="k", model="sarvam/bulbul:v3").model_name == "bulbul:v3"


class TestReplyShape:
    def test_base64_in_audios_is_decoded_to_the_real_container(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        transport = _Transport(_ok())
        _install(monkeypatch, transport)
        out = SarvamTts(api_key="k").synthesise("హలో", language="te-IN")
        assert out.audio == WAV
        assert out.mime == "audio/wav"
        assert out.usage == {}, "Sarvam reports no spend; zero is unknown, not free"

    def test_an_empty_or_junk_body_never_reaches_the_audio_column(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        for body in ({"audios": []}, {"request_id": "r"}, {"audios": ["not base64!"]}):
            transport = _Transport(body)
            _install(monkeypatch, transport)
            with pytest.raises(AiProviderError):
                SarvamTts(api_key="k").synthesise("హలో", language="te-IN")

    def test_base64_of_something_that_is_not_audio_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An error page the transport accepted is the failure mode this
        guard exists for — it decodes cleanly and plays as silence."""
        transport = _Transport(_ok(b"<html>rate limited</html>"))
        _install(monkeypatch, transport)
        with pytest.raises(AiProviderError):
            SarvamTts(api_key="k").synthesise("హలో", language="te-IN")


class TestChunking:
    def test_the_character_ceiling_is_enforced_as_well_as_the_byte_one(self) -> None:
        """Telugu at three bytes a character hides this: 4500 bytes is 1500
        characters and the two limits agree. English is one byte a character,
        so the same chunk is 4500 characters and a 422."""
        english = "This is a sentence. " * 200  # 4000 chars, 4000 bytes
        assert len(audio_concat.split_for_tts(english)) == 1
        chunks = audio_concat.split_for_tts(
            english, max_chars=catalogue.SARVAM_MAX_CHARS
        )
        assert len(chunks) > 1
        assert all(len(c) <= catalogue.SARVAM_MAX_CHARS for c in chunks)
        assert "".join(chunks.copy()).replace(" ", "") == english.replace(" ", "")

    def test_the_provider_declares_that_ceiling(self) -> None:
        assert SarvamTts(api_key="k").max_chars == catalogue.SARVAM_MAX_CHARS
        assert get_tts("aimlapi", api_key="k").max_chars == 0


class TestPresets:
    def test_every_preset_names_a_speaker_its_own_model_accepts(self) -> None:
        """The pace is a judgement; the speaker is a fact, and a preset that
        names a speaker of the other model is a 422 one click away."""
        for model, presets in catalogue.SARVAM_NEWS_PRESETS.items():
            speakers = catalogue.tts_voices(model)
            assert speakers, model
            for preset in presets:
                assert preset.speaker in speakers, f"{model}: {preset.speaker}"
                low, high = catalogue.sarvam_pace_range(model)
                assert low <= preset.pace <= high, f"{model}: {preset.label}"

    def test_presets_are_offered_only_where_they_mean_something(self) -> None:
        """An aimlapi voice is not Telugu-first, so an "ETV read" label on one
        would be a promise with nothing behind it."""
        assert catalogue.voice_presets("openai/gpt-4o-mini-tts") == ()
        assert len(catalogue.voice_presets("sarvam/bulbul:v3")) == 6


class TestVendorErrors:
    def test_a_retired_model_is_redirected_rather_than_sent(self) -> None:
        """Measured 2026-09-19: bulbul:v2 answers 400 "has been deprecated".
        A settings row saved before that would 400 on every single article."""
        assert catalogue.sarvam_model("sarvam/bulbul:v2") == "bulbul:v3"
        assert catalogue.sarvam_model("bulbul:v2") == "bulbul:v3"
        assert "sarvam/bulbul:v2" not in [c["id"] for c in catalogue.choices_for("tts_sarvam")]

    def test_the_vendors_own_message_reaches_the_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The whole point of the 400 above was that it named the fix. Reporting
        "the AI service is unavailable" throws that away."""
        transport = _Transport(
            {"error": {"message": "Model 'bulbul:v2' has been deprecated.", "code": "invalid_request_error"}},
            status=400,
        )
        _install(monkeypatch, transport)
        with pytest.raises(AiProviderError) as caught:
            SarvamTts(api_key="k").synthesise("హలో", language="te-IN")
        assert "deprecated" in str(caught.value.details["error"])
        assert "400" in str(caught.value.details["error"])
