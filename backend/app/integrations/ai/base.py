"""LLM provider contract (updated doc §15–17).

Two calls, because that is all §15–17 needs: propose topics, and write a draft
from one. Both return plain Python structures — no vendor types leak into the
service layer, so a provider swap is a settings change.

Everything here is *suggestion* machinery. No method publishes, and none can:
the service turns a draft into an ordinary Article in the SUBMITTED state, and
the workflow's separate-approver rule takes over from there.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass(slots=True)
class TopicIdea:
    topic_te: str
    topic_en: str | None = None
    rationale_te: str | None = None
    category_slug: str | None = None
    score: float = 0.5
    #: Attribution for §17 — publisher, url, licence, optional short excerpt.
    sources: list[dict] = field(default_factory=list)


@dataclass(slots=True)
class DraftText:
    title_te: str
    summary_te: str
    paragraphs_te: list[str]
    confidence: float = 0.5


class AiProvider(ABC):
    key: str = "base"

    def available(self) -> bool:
        return True

    @abstractmethod
    def propose_topics(self, *, context: str, limit: int) -> list[TopicIdea]:
        """Suggest stories worth covering. `context` is our own recent coverage,
        never someone else's article text."""

    @abstractmethod
    def write_draft(self, *, topic: str, notes: str, sources: list[dict]) -> DraftText:
        """Write original Telugu copy about `topic`.

        `sources` carries publisher names and URLs so the model can attribute,
        not so it can reproduce: implementations must instruct the model to
        write in its own words and never to copy sentences.
        """
