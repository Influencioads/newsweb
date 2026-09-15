"""Admin-configurable AI provider credentials (aimlapi and friends).

Two things here are worth a test because breaking either is silent:

  * a provider key set from the CMS must never be readable back — not from the
    settings endpoint, not from the audit log. A leak looks like working code.
  * aimlapi speaks the OpenAI dialect. If it ever falls through to the
    Anthropic branch the request still *sends*, and fails as an opaque provider
    error rather than an obvious wiring bug.
"""

from __future__ import annotations

import pytest

from app.core.security import decrypt_secret
from app.integrations.ai import get_ai
from app.integrations.ai.heuristic import HeuristicAi
from app.integrations.ai.llm import _DEFAULT_MODEL, LlmAi
from app.services import settings_service


# --------------------------------------------------------------- the secret
def test_api_key_is_encrypted_at_rest_and_decrypts_back():
    stored = settings_service._coerce("ai.api_key", "sk-live-abc123")
    assert "sk-live-abc123" not in stored
    assert decrypt_secret(stored) == "sk-live-abc123"


def test_blank_clears_the_key():
    assert settings_service._coerce("ai.api_key", "") == ""


def test_resubmitting_the_mask_leaves_the_key_alone():
    """The screen round-trips the mask when the admin edits a different field.
    Storing it would silently replace a working key with bullet characters."""
    with pytest.raises(settings_service._Unchanged):
        settings_service._coerce("ai.api_key", settings_service._SECRET_MASK)


def test_secret_never_echoed_to_a_caller():
    assert settings_service.masked_value("ai.api_key", "sk-live-abc123") == (
        settings_service._SECRET_MASK
    )
    # An unset secret reads as empty, not as a mask — otherwise the screen
    # would claim a key is stored when none is.
    assert settings_service.masked_value("ai.api_key", "") == ""
    # Non-secrets pass through untouched.
    assert settings_service.masked_value("ai.provider", "aimlapi") == "aimlapi"


def test_is_secret_only_for_secret_kinds():
    assert settings_service.is_secret("ai.api_key") is True
    assert settings_service.is_secret("ai.provider") is False
    assert settings_service.is_secret("ai.model") is False


def test_optional_strings_accept_blank():
    """`str` rejects blank; `str_optional` must not — blank is how an admin
    says "use the adapter default"."""
    assert settings_service._coerce("ai.model", "") == ""
    assert settings_service._coerce("ai.model", "openai/gpt-4o-mini") == (
        "openai/gpt-4o-mini"
    )


# ------------------------------------------------------------- the adapter
@pytest.fixture
def no_aimlapi_env(monkeypatch):
    """Isolate from a developer's own AIMLAPI_* vars.

    These adapters deliberately fall back to the environment, so a machine with
    real credentials exported would otherwise make these assertions pass or
    fail depending on whose laptop runs them.
    """
    for name in ("AIMLAPI_API_KEY", "AIMLAPI_BASE_URL", "AIMLAPI_MODEL"):
        monkeypatch.setattr(f"app.core.config.settings.{name}", "")


def test_aimlapi_uses_the_openai_dialect_not_anthropic(no_aimlapi_env):
    url, model, headers = LlmAi("aimlapi", api_key="k")._credentials()
    assert url == "https://api.aimlapi.com/v1/chat/completions"
    assert headers["Authorization"] == "Bearer k"
    assert "x-api-key" not in headers  # the Anthropic branch
    assert model == _DEFAULT_MODEL["aimlapi"]


def test_aimlapi_default_model_is_namespaced():
    """A bare `gpt-4o-mini` is not a valid aimlapi id; it fails at generation
    time as a timeout rather than a clear error."""
    assert "/" in _DEFAULT_MODEL["aimlapi"]


@pytest.mark.parametrize(
    "given",
    ["https://api.aimlapi.com/v1", "https://api.aimlapi.com/v1/"],
)
def test_base_url_accepts_the_api_root(given, no_aimlapi_env):
    """People paste the root, because that is what providers document."""
    url, _, _ = LlmAi("aimlapi", api_key="k", base_url=given)._credentials()
    assert url == "https://api.aimlapi.com/v1/chat/completions"


def test_base_url_accepts_the_full_endpoint_unchanged(no_aimlapi_env):
    full = "https://api.aimlapi.com/v1/chat/completions"
    url, _, _ = LlmAi("aimlapi", api_key="k", base_url=full)._credentials()
    assert url == full


def test_settings_key_wins_over_the_environment(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.AIMLAPI_API_KEY", "from-env")
    assert LlmAi("aimlapi", api_key="from-settings")._resolved_key() == "from-settings"
    assert LlmAi("aimlapi")._resolved_key() == "from-env"


def test_no_key_anywhere_degrades_to_the_keyless_provider(monkeypatch):
    """§18: a missing key must not 500 the AI screens — it must quietly do less."""
    monkeypatch.setattr("app.core.config.settings.AIMLAPI_API_KEY", "")
    assert isinstance(get_ai("aimlapi"), HeuristicAi)
    assert isinstance(get_ai("aimlapi", api_key="k"), LlmAi)


def test_unknown_provider_degrades_rather_than_raising():
    assert isinstance(get_ai("no-such-provider", api_key="k"), HeuristicAi)


# ----------------------------------------------------------------- the voice
def test_aimlapi_tts_is_registered_and_takes_settings_credentials():
    from app.integrations.tts import get_tts
    from app.integrations.tts.aimlapi import AimlapiTts

    provider = get_tts("aimlapi", api_key="k")
    assert isinstance(provider, AimlapiTts)
    assert provider.available() is True


def test_aimlapi_tts_uses_the_tts_route_not_the_openai_speech_route():
    """aimlapi answers 404 on /v1/audio/speech. The working route is /v1/tts,
    and it takes `text` rather than OpenAI's `input`."""
    from app.integrations.tts.aimlapi import AimlapiTts

    assert AimlapiTts(api_key="k")._endpoint() == "https://api.aimlapi.com/v1/tts"


def test_aimlapi_tts_endpoint_derives_from_a_chat_base_url():
    """The AI base-url setting is shared, so it may point at chat/completions.
    The speech route is a sibling of that, not a child of it."""
    from app.integrations.tts.aimlapi import AimlapiTts

    p = AimlapiTts(api_key="k", base_url="https://api.aimlapi.com/v1/chat/completions")
    assert p._endpoint() == "https://api.aimlapi.com/v1/tts"


def test_local_tts_still_cannot_synthesise():
    """The shipped default must stay a no-op, so a deploy with no key produces
    no audio rather than erroring on every article."""
    from app.integrations.tts import get_tts

    assert get_tts("local").available() is False


def test_unknown_tts_name_falls_back_to_local():
    from app.integrations.tts import get_tts
    from app.integrations.tts.local import LocalTts

    assert isinstance(get_tts("nope"), LocalTts)
