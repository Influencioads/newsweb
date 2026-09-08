"""The no-key AI provider (updated doc §15–16).

Ships as the default so the AI screens are real and testable without an account
or a rupee of spend. It reads only our *own* database — under-covered
categories, districts that have gone quiet, tags trending among readers — and
turns those gaps into story ideas.

That makes it genuinely useful rather than a stub: "no Guntur story in 3 days"
is a real newsroom prompt. It writes no prose, so `write_draft` produces a
clearly-marked skeleton for a journalist to fill, never fake reporting.
"""

from __future__ import annotations

from app.integrations.ai.base import AiProvider, DraftText, TopicIdea


class HeuristicAi(AiProvider):
    key = "heuristic"

    def propose_topics(self, *, context: str, limit: int) -> list[TopicIdea]:
        # The gap analysis lives in ai_service, which has the session; this
        # provider is the fallback path and contributes no ideas of its own.
        return []

    def write_draft(self, *, topic: str, notes: str, sources: list[dict]) -> DraftText:
        cited = ", ".join(str(s.get("publisher", "")) for s in sources if s.get("publisher"))
        return DraftText(
            title_te=topic[:400],
            summary_te=(notes or topic)[:300],
            paragraphs_te=[
                f"[రాయవలసి ఉంది] {topic}",
                notes or "ఈ అంశంపై విలేకరి వివరాలు జోడించాలి.",
                f"మూలాలు: {cited}" if cited else "మూలాలను ధృవీకరించండి.",
            ],
            confidence=0.2,
        )
