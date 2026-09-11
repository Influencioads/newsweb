"""LLM provider contract (updated doc §15–17).

Three calls: propose topics, write a draft from one, and rewrite somebody
else's report as our own Telugu copy. All return plain Python structures — no
vendor types leak into the service layer, so a provider swap is a settings
change.

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


@dataclass(slots=True)
class RewriteText:
    """The result of rewriting an external report.

    `refused` is the field that earns its place. Given three sentences of feed
    stub, a model will cheerfully produce eight confident paragraphs of
    invented detail — names, numbers, quotes — and nothing downstream can tell
    the difference. So the contract gives it a way to decline, and the service
    treats a refusal as a normal outcome rather than a failure.
    """

    title_te: str
    summary_te: str
    paragraphs_te: list[str]
    confidence: float = 0.5
    #: The model could not stand behind a claim it kept. Shown to the editor.
    unverified: bool = False
    refused: bool = False
    refusal_reason: str | None = None


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

    @abstractmethod
    def rewrite_item(
        self,
        *,
        headline: str,
        body_text: str,
        publisher: str,
        source_url: str,
        language_in: str = "te",
        target_words: int = 220,
    ) -> RewriteText:
        """Rewrite an external report as original Telugu copy.

        `body_text` is somebody else's words. Implementations must instruct the
        model to reproduce none of them, to add no fact the input does not
        contain, and to refuse rather than invent. The service appends the
        attribution itself and does not rely on the model to do it.

        This is abstract rather than a default implementation on purpose: it
        forces every provider to answer, and the keyless provider's answer —
        headline, excerpt, credit, nothing invented — is exactly the
        legally-safe excerpt import the platform did before AI existed. The
        pipeline degrades instead of failing.
        """
