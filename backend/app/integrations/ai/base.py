"""LLM provider contract (updated doc §15–17).

Four calls: propose topics, write a draft from one, rewrite somebody
else's report as our own Telugu copy, and boil our own story down to the few
words a social news card carries. All return plain Python structures — no
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


@dataclass(slots=True)
class CardText:
    """The words on a social news card: a hook, not the headline.

    `engine` says whether a model wrote it or it was cut from the story, so
    the CMS can say which it is showing.
    """

    headline: str
    summary: str
    tag: str = ""
    engine: str = "heuristic"


def _clip(text: str, limit: int) -> str:
    """At most `limit` characters, cut at a word, never mid-akshara."""
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return (cut or text[:limit]).rstrip(" ,;:-") + "…"


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
        credit_source: bool = True,
    ) -> RewriteText:
        """Rewrite an external report as original Telugu copy.

        `body_text` is somebody else's words. Implementations must instruct the
        model to reproduce none of them, to add no fact the input does not
        contain, and to refuse rather than invent.

        `credit_source` follows `ContentSource.attribution_required` — the
        admin's per-source answer, and the same flag `_body_document` already
        obeys. False means the copy must name no publication at all: the facts
        are not anybody's property, the expression is ours, and the story
        carries our masthead. The provenance does not disappear when it is
        False — `IngestedRewrite.attribution_te`, `Article.canonical_url` and
        the `IngestedItem` row all still record where it came from; it simply
        stops being printed for the reader. A photograph is the exception the
        flag does NOT cover: `Media.credit` is required regardless, because a
        picture is the publisher's own work and no rewrite makes it ours.

        This is abstract rather than a default implementation on purpose: it
        forces every provider to answer, and the keyless provider's answer —
        headline, excerpt, credit, nothing invented — is exactly the
        legally-safe excerpt import the platform did before AI existed. The
        pipeline degrades instead of failing.
        """

    def card_text(self, *, headline: str, summary: str, body: str) -> CardText:
        """The glimpse of our own published story for a social news card.

        Not abstract: the keyless answer — our headline and standfirst,
        trimmed — is a correct card, just not a punchy one. A model only
        shortens and sharpens copy that is already ours; it adds nothing.
        """
        return CardText(
            headline=_clip(headline, 90),
            summary=_clip(summary or body, 170),
        )
