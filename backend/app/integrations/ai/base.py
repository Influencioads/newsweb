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
from datetime import date, datetime


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
    #: Where the model would file the story — the raw strings it returned for
    #: the extra keys `taxonomy` asked for (category, subcategory, district,
    #: place, tags, breaking). Untrusted: `crawl_service._classify` validates
    #: every value against our own tables before anything reaches an article.
    #: None when no taxonomy was offered, or on a refusal.
    classification: dict | None = None
    #: The house-style story type the model says it followed (validated
    #: against `newsroom_style.type_keys`), and what it wants an editor to
    #: check — kept out of the copy, per the guide. None when not asked.
    story_type: str | None = None
    editor_note: str | None = None


@dataclass(slots=True)
class HeadlineOption:
    """One suggested headline: the words and the curiosity device it uses
    (`straight` for the plain factual one)."""

    text: str
    device: str
    label_te: str = ""


@dataclass(slots=True)
class ImageVerdict:
    """What a vision model saw in one crawled photo.

    `verdict` is one of clean / watermark / logo / text / graphic. A verdict is
    all it is: the pipeline rejects a branded photo, it never cleans one, and
    the bytes are never handed to an image edit or generation model.
    """

    verdict: str
    reason: str = ""


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
    def write_draft(
        self,
        *,
        topic: str,
        notes: str,
        sources: list[dict],
        story_type: str | None = None,
        house_style: bool = True,
    ) -> DraftText:
        """Write original Telugu copy about `topic`.

        `sources` carries publisher names and URLs so the model can attribute,
        not so it can reproduce: implementations must instruct the model to
        write in its own words and never to copy sentences.

        `house_style` adds the newsroom style brief; a caller whose output is
        not an article (the bulletin's spoken connectives) turns it off.
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
        taxonomy: dict | None = None,
        story_type: str | None = None,
        feedback: str | None = None,
        source_date: date | datetime | None = None,
    ) -> RewriteText:
        """Rewrite an external report as original Telugu copy.

        `story_type` picks the house-style guide the model follows (None: it
        is offered the likeliest three and reports its pick); `feedback` is
        why the previous answer was rejected, for the one retry the crawl
        allows; `source_date` is when the source was published, so relative
        days (నేడు, నిన్న) are counted from it.

        `taxonomy`, when given, also asks where the story belongs:
        `{"categories": [{"slug", "name", "children": [{"slug", "name"}]}],
        "districts": [name_en, ...]}` read live from our tables. The answer
        comes back raw on `RewriteText.classification`; providers that cannot
        classify ignore it.

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

    def headline_options(
        self, *, headline: str, summary: str, body: str, story_type: str | None = None
    ) -> list[HeadlineOption]:
        """Alternative headlines for our own story, for an editor to pick from.

        Not abstract: the keyless answer is no ideas — there is no honest way
        to invent a headline without a model.
        """
        return []

    def inspect_image(self, raw: bytes) -> ImageVerdict | None:
        """Look at one crawled photo and say whether the publisher branded it.

        Not abstract: None means "cannot check" — no key, a provider without
        image input — and the caller then behaves exactly as before the check
        existed. `raw` is only looked at; it is never edited, cleaned or sent to
        an image model.
        """
        return None
