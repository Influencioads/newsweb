"""Editorial assist (updated doc §18) — suggestions only; editors decide.

Engine note, stated plainly: this is `heuristic-v1`, running entirely locally.
No AI provider keys are configured yet, and pretending otherwise would be
worse than useless in a newsroom. The heuristics are the ones that genuinely
work without a model:

  * duplicate detection    — token-overlap similarity against the recent
                             archive (the §18 feature with the highest value,
                             and no model needed)
  * tag suggestion         — existing tags + the term glossary found in copy
  * category suggestion    — majority category of the most-similar articles
  * summary                — lead-sentence extract (news buries nothing;
                             the lead IS the summary baseline)
  * SEO title/description  — deterministic trims to search limits

When provider keys land, an LLM adapter replaces individual functions behind
the same response shape; the endpoint and UI do not change. The response
carries `engine` so the CMS can label the provenance honestly.
"""

from __future__ import annotations

import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.content import Article, Tag, TermGlossary
from app.models.enums import ArticleStatus, TagType
from app.telugu.normalize import normalize_text

ENGINE = "heuristic-v1"

SIMILARITY_WINDOW_DAYS = 45
SIMILARITY_CANDIDATES = 300
TOP_SIMILAR = 3
SUMMARY_MAX_WORDS = 45
SEO_TITLE_MAX = 60
SEO_DESCRIPTION_MAX = 160

_TOKEN_RE = re.compile(r"[\wఀ-౿]{2,}")


def _tokens(text: str) -> set[str]:
    return set(_TOKEN_RE.findall((text or "").lower()))


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    return intersection / (len(a) + len(b) - intersection)


def find_duplicates(
    db: Session, *, title_te: str, body_plain: str, exclude_article_id: int | None = None
) -> list[dict]:
    """§18 duplicate detection: top similar recent stories with a percentage.

    Title tokens are weighted by comparing them separately — two rewrites of
    the same press note share a headline vocabulary even when bodies drift.
    """
    probe_title = _tokens(title_te)
    probe_body = _tokens(body_plain)

    cutoff = utcnow() - timedelta(days=SIMILARITY_WINDOW_DAYS)
    stmt = (
        select(Article)
        .where(
            Article.status == ArticleStatus.PUBLISHED,
            Article.deleted_at.is_(None),
            Article.published_at >= cutoff,
        )
        .order_by(Article.published_at.desc())
        .limit(SIMILARITY_CANDIDATES)
    )
    scored: list[tuple[float, Article]] = []
    for candidate in db.execute(stmt).unique().scalars():
        if exclude_article_id is not None and candidate.id == exclude_article_id:
            continue
        title_sim = _jaccard(probe_title, _tokens(candidate.title_te))
        body_sim = _jaccard(probe_body, _tokens(candidate.body_plain or ""))
        similarity = 0.45 * title_sim + 0.55 * body_sim
        if similarity >= 0.15:
            scored.append((similarity, candidate))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [
        {
            "article_id": a.id,
            "short_id": a.short_id,
            "title_te": a.title_te,
            "similarity_percent": round(s * 100, 1),
        }
        for s, a in scored[:TOP_SIMILAR]
    ]


def suggest_tags(db: Session, *, text: str, limit: int = 6) -> list[dict]:
    """Existing tags and glossary terms that literally occur in the copy —
    the editor confirms; nothing is invented (§18 'for editor review')."""
    haystack = normalize_text(text or "").lower()
    if not haystack:
        return []

    suggestions: list[dict] = []
    seen: set[str] = set()

    for tag in db.execute(select(Tag).where(Tag.is_active.is_(True))).scalars():
        for needle in (tag.name_te, tag.name_en):
            if needle and len(needle) >= 3 and needle.lower() in haystack:
                if tag.slug not in seen:
                    seen.add(tag.slug)
                    suggestions.append(
                        {"slug": tag.slug, "name_te": tag.name_te, "type": tag.type, "exists": True}
                    )
                break

    for term in db.execute(select(TermGlossary)).scalars():
        needle = term.term_te or term.term_en
        if needle and len(needle) >= 3 and needle.lower() in haystack:
            slug = re.sub(r"[^a-z0-9]+", "-", term.term_en.lower()).strip("-")
            if slug and slug not in seen:
                seen.add(slug)
                suggestions.append(
                    {
                        "slug": slug,
                        "name_te": term.term_te,
                        "type": term.type or TagType.TOPIC,
                        "exists": False,
                    }
                )

    return suggestions[:limit]


def suggest_category(db: Session, *, title_te: str, body_plain: str) -> dict | None:
    """Nearest-neighbour vote: the majority category among the most-similar
    recent stories. Honest and archive-grounded; no keyword lists to rot."""
    probe = _tokens(f"{title_te} {body_plain}")
    if not probe:
        return None

    cutoff = utcnow() - timedelta(days=SIMILARITY_WINDOW_DAYS)
    stmt = (
        select(Article)
        .where(
            Article.status == ArticleStatus.PUBLISHED,
            Article.deleted_at.is_(None),
            Article.category_id.is_not(None),
            Article.published_at >= cutoff,
        )
        .order_by(Article.published_at.desc())
        .limit(SIMILARITY_CANDIDATES)
    )
    neighbours: list[tuple[float, Article]] = []
    for candidate in db.execute(stmt).unique().scalars():
        similarity = _jaccard(probe, _tokens(f"{candidate.title_te} {candidate.body_plain or ''}"))
        if similarity > 0.05:
            neighbours.append((similarity, candidate))
    neighbours.sort(key=lambda pair: pair[0], reverse=True)

    votes: dict[int, float] = {}
    for similarity, article in neighbours[:5]:
        votes[article.category_id] = votes.get(article.category_id, 0.0) + similarity  # type: ignore[arg-type]
    if not votes:
        return None
    best_id = max(votes, key=lambda k: votes[k])
    category = next(
        (a.category for _s, a in neighbours if a.category_id == best_id and a.category), None
    )
    if category is None:
        return None
    return {"slug": category.slug, "name_te": category.name_te, "name_en": category.name_en}


_SENTENCE_SPLIT = re.compile(r"(?<=[።.!?॥])\s+|\n+")


def extract_summary(body_plain: str, *, max_words: int = SUMMARY_MAX_WORDS) -> str:
    """Lead-sentence extract (§14/§18 'short-news summary'). News writing puts
    the story in the first sentences; the editor trims from there."""
    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(body_plain or "") if s.strip()]
    words: list[str] = []
    for sentence in sentences:
        sentence_words = sentence.split()
        if words and len(words) + len(sentence_words) > max_words:
            break
        words.extend(sentence_words)
        if len(words) >= max_words:
            break
    return " ".join(words[:max_words])


def suggest_seo(*, title_te: str, summary_te: str | None, body_plain: str) -> dict:
    description_source = (summary_te or "").strip() or extract_summary(body_plain, max_words=30)
    return {
        "seo_title": (title_te or "").strip()[:SEO_TITLE_MAX],
        "seo_description": description_source[:SEO_DESCRIPTION_MAX],
    }


def assist(
    db: Session,
    *,
    title_te: str,
    body_plain: str,
    summary_te: str | None,
    exclude_article_id: int | None = None,
) -> dict:
    text = f"{title_te}\n{body_plain}"
    return {
        "engine": ENGINE,
        "duplicates": find_duplicates(
            db, title_te=title_te, body_plain=body_plain, exclude_article_id=exclude_article_id
        ),
        "suggested_tags": suggest_tags(db, text=text),
        "suggested_category": suggest_category(db, title_te=title_te, body_plain=body_plain),
        "summary_te": extract_summary(body_plain),
        "seo": suggest_seo(title_te=title_te, summary_te=summary_te, body_plain=body_plain),
    }
