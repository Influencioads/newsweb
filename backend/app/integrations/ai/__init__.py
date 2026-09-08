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

_LLM_KEYS = {"gemini", "openai", "anthropic"}


def get_ai(provider: str | None = None) -> AiProvider:
    name = (provider or "heuristic").lower()
    if name in _LLM_KEYS:
        candidate = LlmAi(name)
        if candidate.available():
            return candidate
    return HeuristicAi()
