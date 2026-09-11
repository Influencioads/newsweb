"""LLM-backed provider (updated doc §15–17).

One class covers Gemini, OpenAI and Anthropic: they differ in endpoint, auth
header and response shape, and in nothing else this code cares about. Each is a
plain HTTPS call — no vendor SDK, so no dependency churn and no surprise
telemetry.

The prompts encode §17's constraints as instructions the model is given every
time, not as a policy note in a document:

  * write in your own words; never reproduce sentences from a source
  * name the publisher for every factual claim
  * say plainly when something is unverified

They are guidance, not a guarantee — which is exactly why nothing this returns
can reach a reader without an editor approving it.
"""

from __future__ import annotations

import json
import re

import httpx

from app.core.config import settings
from app.core.errors import AiProviderError
from app.integrations.ai.base import AiProvider, DraftText, RewriteText, TopicIdea

_JSON_BLOCK = re.compile(r"\{.*\}|\[.*\]", re.DOTALL)

#: Appended to `_RULES` for the rewrite call only. These are stricter than the
#: general rules because the input is another publisher's reporting: the model
#: is being asked to restate facts it cannot check, from a source it must not
#: copy, about places it knows nothing about.
_REWRITE_RULES = (
    "You are rewriting an external news report for a Telugu newsroom.\n"
    "6. Every factual claim in your output must already be present in the input. "
    "Add no background, no context, no numbers, no names, no dates and no quotes "
    "that the input does not contain. You have no other knowledge of this story.\n"
    "7. Reproduce no sentence and no distinctive phrase from the input. "
    "Restructure the report; do not translate it sentence by sentence.\n"
    "8. If the input contains fewer than about 40 words of actual reporting, or "
    "concerns caste, religion, communal tension, sexual assault, suicide, or a "
    "minor, set \"refused\": true with a one-line reason and write nothing else. "
    "Refusing is a correct answer; inventing detail to fill space is not."
)

_RULES = (
    "You are assisting a Telugu newsroom. Absolute rules:\n"
    "1. Write only in your own words. Never reproduce a sentence from any source.\n"
    "2. Attribute every factual claim to the publisher it came from.\n"
    "3. If a fact is unverified, say so explicitly rather than asserting it.\n"
    "4. Telugu output must be natural news Telugu, not transliterated English.\n"
    "5. Return JSON only, with no commentary and no code fences."
)


class LlmAi(AiProvider):
    """`key` is the provider name: gemini | openai | anthropic."""

    def __init__(self, key: str) -> None:
        self.key = key

    # ------------------------------------------------------------------ auth
    def _credentials(self) -> tuple[str, str, dict[str, str]]:
        if self.key == "gemini":
            model = "gemini-2.0-flash"
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent?key={settings.GEMINI_API_KEY}"
            )
            return url, model, {"Content-Type": "application/json"}
        if self.key == "openai":
            return (
                "https://api.openai.com/v1/chat/completions",
                "gpt-4o-mini",
                {
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
            )
        if self.key == "anthropic":
            return (
                "https://api.anthropic.com/v1/messages",
                "claude-sonnet-5",
                {
                    "x-api-key": settings.ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
            )
        raise AiProviderError(
            details={"provider": self.key, "error": "unknown provider"}
        )

    @property
    def model_name(self) -> str | None:
        """Which model actually answered, for the article's AI provenance.

        Read through `_credentials`, so it can never drift from the model the
        request was sent to.
        """
        try:
            return self._credentials()[1]
        except AiProviderError:
            return None

    def available(self) -> bool:
        return bool(
            {
                "gemini": settings.GEMINI_API_KEY,
                "openai": settings.OPENAI_API_KEY,
                "anthropic": settings.ANTHROPIC_API_KEY,
            }.get(self.key)
        )

    # ------------------------------------------------------------------ call
    def _complete(self, prompt: str) -> str:
        if not self.available():
            raise AiProviderError(
                message_en=f"No API key configured for {self.key}.",
                details={"provider": self.key},
            )
        url, model, headers = self._credentials()
        timeout = settings.AI_DEFAULT_TIMEOUT_MS / 1000
        full = f"{_RULES}\n\n{prompt}"

        if self.key == "gemini":
            payload = {
                "contents": [{"parts": [{"text": full}]}],
                "generationConfig": {"temperature": 0.4, "maxOutputTokens": 2048},
            }
        elif self.key == "openai":
            payload = {
                "model": model,
                "temperature": 0.4,
                "max_tokens": 2048,
                "messages": [{"role": "user", "content": full}],
            }
        else:
            payload = {
                "model": model,
                "max_tokens": 2048,
                "temperature": 0.4,
                "messages": [{"role": "user", "content": full}],
            }

        try:
            response = httpx.post(url, json=payload, headers=headers, timeout=timeout)
            response.raise_for_status()
            body = response.json()
        except httpx.HTTPError as exc:
            raise AiProviderError(
                details={"provider": self.key, "error": str(exc)[:200]}
            ) from exc

        try:
            if self.key == "gemini":
                return body["candidates"][0]["content"]["parts"][0]["text"]
            if self.key == "openai":
                return body["choices"][0]["message"]["content"]
            return body["content"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AiProviderError(
                details={"provider": self.key, "error": "unexpected response shape"}
            ) from exc

    @staticmethod
    def _parse_json(text: str):
        """Models still occasionally wrap JSON in prose or fences despite being
        told not to, so pull the first JSON value out rather than failing."""
        match = _JSON_BLOCK.search(text or "")
        if not match:
            raise AiProviderError(details={"error": "no JSON in model response"})
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise AiProviderError(
                details={"error": "malformed JSON in model response"}
            ) from exc

    # ------------------------------------------------------------- interface
    def propose_topics(self, *, context: str, limit: int) -> list[TopicIdea]:
        prompt = (
            f"Our Telugu news site has recently covered:\n{context}\n\n"
            f"Propose {limit} distinct stories worth covering next for readers in "
            "Andhra Pradesh and Telangana. Prefer under-covered angles over "
            "repeating what we already published.\n\n"
            'Return a JSON array. Each item: {"topic_te": "...", "topic_en": "...", '
            '"rationale_te": "why this matters, one sentence", "category_slug": "...", '
            '"score": 0.0-1.0, "sources": [{"publisher": "...", "url": "...", '
            '"licence": "press-release|rss|api|unknown"}]}. '
            "Use an empty sources array when you have no verifiable source; never invent a URL."
        )
        data = self._parse_json(self._complete(prompt))
        if not isinstance(data, list):
            return []
        ideas: list[TopicIdea] = []
        for row in data[:limit]:
            if not isinstance(row, dict) or not row.get("topic_te"):
                continue
            try:
                score = max(0.0, min(1.0, float(row.get("score", 0.5))))
            except (TypeError, ValueError):
                score = 0.5
            sources = [
                s
                for s in (row.get("sources") or [])
                if isinstance(s, dict) and s.get("url") and s.get("publisher")
            ]
            ideas.append(
                TopicIdea(
                    topic_te=str(row["topic_te"])[:400],
                    topic_en=(
                        str(row["topic_en"])[:400] if row.get("topic_en") else None
                    ),
                    rationale_te=(
                        str(row["rationale_te"])[:800]
                        if row.get("rationale_te")
                        else None
                    ),
                    category_slug=(
                        str(row["category_slug"])[:80]
                        if row.get("category_slug")
                        else None
                    ),
                    score=score,
                    sources=sources[:8],
                )
            )
        return ideas

    def write_draft(self, *, topic: str, notes: str, sources: list[dict]) -> DraftText:
        cited = "\n".join(
            f"- {s.get('publisher')}: {s.get('url')}" for s in sources if s.get("url")
        )
        prompt = (
            f"Write an original Telugu news article about: {topic}\n"
            f"Editor's notes: {notes or '(none)'}\n"
            f"Sources to attribute (do not copy their wording):\n{cited or '(none)'}\n\n"
            'Return JSON: {"title_te": "headline under 100 characters", '
            '"summary_te": "40-word standfirst", "paragraphs_te": ["para", "para", ...], '
            '"confidence": 0.0-1.0}. Six to ten paragraphs. '
            "Mark anything you could not verify with the phrase 'ధృవీకరించలేదు'."
        )
        data = self._parse_json(self._complete(prompt))
        if not isinstance(data, dict) or not data.get("title_te"):
            raise AiProviderError(details={"error": "draft missing a headline"})
        paragraphs = [
            str(p).strip() for p in (data.get("paragraphs_te") or []) if str(p).strip()
        ]
        try:
            confidence = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
        except (TypeError, ValueError):
            confidence = 0.5
        return DraftText(
            title_te=str(data["title_te"])[:400],
            summary_te=str(data.get("summary_te") or "")[:1000],
            paragraphs_te=paragraphs[:30],
            confidence=confidence,
        )

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
        clipped = " ".join((body_text or "").split())[:12_000]
        prompt = (
            f"{_REWRITE_RULES}\n\n"
            f"Below is a news report published by {publisher}. Rewrite it as an "
            "original Telugu news article for our readers in Andhra Pradesh and "
            "Telangana.\n\n"
            "One paragraph must attribute the reporting, in the form "
            f'"... అని {publisher} నివేదించింది." Mark any claim the source itself '
            'presents as unconfirmed with "ధృవీకరించలేదు".\n\n'
            f"Input headline: {headline}\n"
            f"Input language: {language_in}\n"
            f"Input text:\n{clipped}\n\n"
            'Return JSON: {"title_te": "under 100 characters", "summary_te": '
            '"about 40 words", "paragraphs_te": ["...", "..."], "confidence": '
            '0.0-1.0, "unverified": true|false, "refused": false, '
            '"refusal_reason": null}. '
            f"Write four to eight paragraphs, about {target_words} words in total."
        )
        data = self._parse_json(self._complete(prompt))
        if not isinstance(data, dict):
            raise AiProviderError(details={"error": "rewrite response was not an object"})

        if bool(data.get("refused")):
            return RewriteText(
                title_te="",
                summary_te="",
                paragraphs_te=[],
                confidence=0.0,
                refused=True,
                refusal_reason=str(data.get("refusal_reason") or "model declined")[:300],
            )

        paragraphs = [
            str(p).strip()
            for p in (data.get("paragraphs_te") or [])
            if str(p or "").strip()
        ]
        title = str(data.get("title_te") or "").strip()
        if not title or not paragraphs:
            # A response missing either is unusable. Treat it as a refusal
            # rather than importing an empty article shell.
            return RewriteText(
                title_te="",
                summary_te="",
                paragraphs_te=[],
                confidence=0.0,
                refused=True,
                refusal_reason="model returned no usable headline or body",
            )
        try:
            confidence = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
        except (TypeError, ValueError):
            confidence = 0.5
        return RewriteText(
            title_te=title[:400],
            summary_te=str(data.get("summary_te") or "").strip()[:1000],
            paragraphs_te=paragraphs,
            confidence=confidence,
            unverified=bool(data.get("unverified")),
        )
