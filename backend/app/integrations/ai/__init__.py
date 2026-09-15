"""AI provider factory (updated doc §15–18).

The provider name comes from an editable setting, so like the TTS factory this
resolves per call. An unknown or unconfigured name degrades to the heuristic
provider rather than raising: the AI screens must stay usable when a key is
missing, they simply have less to show.
"""

from __future__ import annotations

from app.integrations.ai.base import AiProvider, DraftText, TopicIdea
from app.integrations.ai.heuristic import HeuristicAi
from app.integrations.ai.llm import LlmAi

__all__ = ["AiProvider", "DraftText", "HeuristicAi", "LlmAi", "TopicIdea", "get_ai"]

_LLM_KEYS = {"gemini", "openai", "anthropic", "aimlapi"}


def get_ai(
    provider: str | None = None,
    *,
    api_key: str = "",
    base_url: str = "",
    model: str = "",
) -> AiProvider:
    """Resolve the configured provider, degrading to the keyless heuristic.

    `api_key`/`base_url`/`model` come from the editable settings (see
    `settings_service.ai_credentials`) so a provider can be configured from the
    CMS. Blank means "fall back to the deploy environment", which is what an
    install that predates the settings-managed key keeps doing.
    """
    name = (provider or "heuristic").lower()
    if name in _LLM_KEYS:
        candidate = LlmAi(name, api_key=api_key, base_url=base_url, model=model)
        if candidate.available():
            return candidate
    return HeuristicAi()
