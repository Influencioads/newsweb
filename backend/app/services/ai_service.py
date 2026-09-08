"""AI news assistance (updated doc §15–18).

The pipeline is deliberately three separate, human-gated steps:

    discover  ->  ai_suggestions      (an idea; an editor accepts or rejects)
    write     ->  ai_article_drafts   (copy; an editor reads it)
    convert   ->  articles @ SUBMITTED (the ordinary workflow takes over)

Nothing skips a step, and the last one lands in SUBMITTED — so approving still
requires a second person and publishing a third (§6.3). There is no code path
here that sets PUBLISHED, and `ai.publish_without_review` is not a permission
that exists.

Copyright (§17): the research pass reads only feeds named in
`AI_ALLOWED_SOURCE_FEEDS`. With none configured it reads nothing at all and
falls back to gap analysis over our *own* archive — which is why the feature is
useful on day one without anyone having to decide what is safe to scrape.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings as env_settings
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.integrations.ai import get_ai
from app.models.ai import AiArticleDraft, AiSource, AiSuggestion
from app.models.content import Article, Category
from app.models.enums import (
    AiDraftStatus,
    AiSuggestionStatus,
    ArticleStatus,
    ArticleType,
    WorkflowState,
)
from app.models.geo import District
from app.services import settings_service, tiptap

logger = get_logger(__name__)

#: Licences the research pass will accept. Anything else is recorded as
#: "unknown" and shown to the editor as unverified rather than being used.
PERMITTED_LICENCES = {"api", "rss", "press-release", "cc-by", "cc0", "public-domain"}


def allowed_source_hosts() -> set[str]:
    """§17 — the explicit allow-list. Empty means "read nothing"."""
    raw = env_settings.AI_ALLOWED_SOURCE_FEEDS or ""
    return {h.strip().lower() for h in raw.replace("\n", ",").split(",") if h.strip()}


# --------------------------------------------------------------------------- #
# Discovery (§15, §16)
# --------------------------------------------------------------------------- #
def _recent_coverage(db: Session, limit: int = 40) -> str:
    """Our own recent headlines. This is the only article text the model sees —
    ours, not anybody else's."""
    rows = db.execute(
        select(Article.title_te, Category.name_en)
        .join(Category, Article.category_id == Category.id, isouter=True)
        .where(Article.status == ArticleStatus.PUBLISHED, Article.deleted_at.is_(None))
        .order_by(Article.published_at.desc())
        .limit(limit)
    ).all()
    return "\n".join(f"- [{cat or 'general'}] {title}" for title, cat in rows)


def _coverage_gaps(db: Session, limit: int) -> list[dict[str, Any]]:
    """Suggestions derived from our own data alone — no provider, no cost, no
    copyright question. A category or district that has gone quiet is a real
    newsroom prompt, so this is a genuine fallback rather than a placeholder."""
    since = utcnow() - timedelta(days=3)
    published = [Article.status == ArticleStatus.PUBLISHED, Article.deleted_at.is_(None)]

    recent_by_category = dict(db.execute(
        select(Article.category_id, func.count(Article.id))
        .where(*published, Article.published_at >= since)
        .group_by(Article.category_id)
    ).all())
    ideas: list[dict[str, Any]] = []
    for category in db.scalars(
        select(Category).where(Category.is_active.is_(True)).order_by(Category.sort)
    ).all():
        count = int(recent_by_category.get(category.id, 0))
        if count >= 3:
            continue
        ideas.append({
            "topic_te": f"{category.name_te} — తాజా కథనం అవసరం",
            "topic_en": f"{category.name_en} needs a fresh story",
            "rationale_te": (f"గత 3 రోజుల్లో ఈ విభాగంలో {count} కథనాలు మాత్రమే "
                             f"ప్రచురించాం."),
            "category_id": category.id,
            "score": round(min(1.0, (3 - count) / 3), 2),
        })

    recent_by_district = dict(db.execute(
        select(Article.district_id, func.count(Article.id))
        .where(*published, Article.published_at >= since, Article.district_id.is_not(None))
        .group_by(Article.district_id)
    ).all())
    for district in db.scalars(
        select(District).where(District.is_active.is_(True)).order_by(District.sort).limit(20)
    ).all():
        if int(recent_by_district.get(district.id, 0)) > 0:
            continue
        ideas.append({
            "topic_te": f"{district.name_te} జిల్లా — స్థానిక వార్త అవసరం",
            "topic_en": f"{district.name_en} district has no recent local story",
            "rationale_te": "గత 3 రోజుల్లో ఈ జిల్లా నుంచి కథనం ప్రచురించలేదు.",
            "district_id": district.id,
            "score": 0.6,
        })

    ideas.sort(key=lambda i: i["score"], reverse=True)
    return ideas[:limit]


def generate_suggestions(db: Session, *, limit: int | None = None,
                         actor_id: int | None = None) -> list[AiSuggestion]:
    """§16 — build today's suggestion list. Idempotent within a day: an open
    suggestion with the same topic is not duplicated."""
    if not settings_service.ai_enabled(db):
        raise ConflictError(
            message_en="AI is switched off. Enable it in Settings first.",
            message_te="AI ఆఫ్‌లో ఉంది. ముందుగా సెట్టింగ్స్‌లో ఆన్ చేయండి.")

    cap = limit or settings_service.get_int(db, "ai.daily_suggestion_limit")
    cap = max(1, min(cap, 50))
    today = utcnow() - timedelta(hours=24)
    made_today = int(db.scalar(select(func.count(AiSuggestion.id)).where(
        AiSuggestion.created_at >= today)) or 0)
    if made_today >= cap:
        raise ConflictError(
            message_en=f"Today's suggestion limit ({cap}) is already reached.",
            details={"limit": cap, "created_today": made_today})
    room = cap - made_today

    provider_name = str(settings_service.get(db, "ai.provider") or "heuristic")
    provider = get_ai(provider_name)
    min_score = float(settings_service.get(db, "ai.min_score") or 0.0)

    raw: list[dict[str, Any]] = []
    if provider.key != "heuristic":
        try:
            for idea in provider.propose_topics(context=_recent_coverage(db), limit=room):
                if idea.score < min_score:
                    continue
                category = None
                if idea.category_slug:
                    category = db.scalar(select(Category).where(Category.slug == idea.category_slug))
                raw.append({
                    "topic_te": idea.topic_te, "topic_en": idea.topic_en,
                    "rationale_te": idea.rationale_te,
                    "category_id": category.id if category else None,
                    "score": idea.score, "sources": idea.sources,
                })
        except Exception:  # noqa: BLE001 — a provider outage falls back, never 500s
            logger.warning("ai_provider_topics_failed", provider=provider.key, exc_info=True)

    if not raw:
        raw = _coverage_gaps(db, room)

    existing = {
        s.topic_te for s in db.scalars(
            select(AiSuggestion).where(AiSuggestion.status == AiSuggestionStatus.NEW)).all()
    }
    created: list[AiSuggestion] = []
    for item in raw:
        if item["topic_te"] in existing:
            continue
        existing.add(item["topic_te"])
        suggestion = AiSuggestion(
            topic_te=item["topic_te"][:400],
            topic_en=(item.get("topic_en") or None),
            rationale_te=item.get("rationale_te"),
            category_id=item.get("category_id"),
            district_id=item.get("district_id"),
            score=float(item.get("score", 0.5)),
            engine=provider.key,
            model=provider_name if provider.key != "heuristic" else None,
        )
        db.add(suggestion)
        db.flush()
        _attach_sources(db, suggestion, item.get("sources") or [])
        created.append(suggestion)

    logger.info("ai_suggestions_generated", count=len(created), engine=provider.key,
                actor_id=actor_id)
    return created


def _attach_sources(db: Session, suggestion: AiSuggestion, sources: list[dict]) -> None:
    """§17 attribution, filtered by the allow-list. A source outside it is
    dropped rather than stored, so an editor is never shown a link we had no
    right to fetch."""
    allowed = allowed_source_hosts()
    for source in sources[:8]:
        url = str(source.get("url") or "")
        publisher = str(source.get("publisher") or "").strip()
        if not url.startswith("http") or not publisher:
            continue
        host = url.split("/")[2].lower() if "//" in url else ""
        if allowed and not any(host.endswith(a) for a in allowed):
            continue
        licence = str(source.get("licence") or "unknown").lower()
        db.add(AiSource(
            suggestion_id=suggestion.id,
            publisher=publisher[:200],
            title=(str(source.get("title"))[:500] if source.get("title") else None),
            url=url[:900],
            licence=licence if licence in PERMITTED_LICENCES else "unknown",
            # Kept short on purpose: verification, not reproduction.
            excerpt=(str(source.get("excerpt"))[:400] if source.get("excerpt") else None),
        ))


# --------------------------------------------------------------------------- #
# Review (§16)
# --------------------------------------------------------------------------- #
def get_suggestion(db: Session, suggestion_id: int) -> AiSuggestion:
    row = db.get(AiSuggestion, suggestion_id)
    if row is None:
        raise NotFoundError()
    return row


def reject_suggestion(db: Session, suggestion_id: int, *, actor_id: int,
                      note: str | None) -> AiSuggestion:
    suggestion = get_suggestion(db, suggestion_id)
    suggestion.status = AiSuggestionStatus.REJECTED
    suggestion.reviewed_by, suggestion.reviewed_at = actor_id, utcnow()
    suggestion.review_note = (note or None)
    return suggestion


def create_draft(db: Session, suggestion_id: int, *, actor_id: int,
                 notes: str | None = None) -> AiArticleDraft:
    """§15 — write copy for an accepted suggestion. Still nothing readers see."""
    if not settings_service.ai_enabled(db):
        raise ConflictError(message_en="AI is switched off.")
    suggestion = get_suggestion(db, suggestion_id)
    if suggestion.status == AiSuggestionStatus.REJECTED:
        raise ConflictError(message_en="That suggestion was rejected.")

    provider = get_ai(str(settings_service.get(db, "ai.provider") or "heuristic"))
    sources = [{"publisher": s.publisher, "url": s.url} for s in suggestion.sources]
    text = provider.write_draft(
        topic=suggestion.topic_te,
        notes=notes or suggestion.rationale_te or "",
        sources=sources,
    )

    body = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": p}]}
        for p in text.paragraphs_te
    ]}
    _, plain, _, words, _ = tiptap.derive(body)

    draft = AiArticleDraft(
        suggestion_id=suggestion.id,
        title_te=text.title_te,
        summary_te=text.summary_te or None,
        body=body,
        body_plain=plain,
        category_id=suggestion.category_id,
        district_id=suggestion.district_id,
        engine=provider.key,
        model=str(settings_service.get(db, "ai.provider")),
        confidence=text.confidence,
        word_count=words,
        created_by=actor_id,
    )
    db.add(draft)
    suggestion.status = AiSuggestionStatus.ACCEPTED
    suggestion.reviewed_by, suggestion.reviewed_at = actor_id, utcnow()
    db.flush()
    logger.info("ai_draft_created", draft_id=draft.id, engine=provider.key)
    return draft


def get_draft(db: Session, draft_id: int) -> AiArticleDraft:
    row = db.get(AiArticleDraft, draft_id)
    if row is None:
        raise NotFoundError()
    return row


def discard_draft(db: Session, draft_id: int, *, actor_id: int) -> AiArticleDraft:
    draft = get_draft(db, draft_id)
    if draft.status == AiDraftStatus.CONVERTED:
        raise ConflictError(message_en="That draft already became an article.")
    draft.status = AiDraftStatus.DISCARDED
    return draft


def convert_draft(db: Session, draft_id: int, principal) -> Article:
    """Turn a draft into a real Article — **at SUBMITTED**, never published.

    From here it is indistinguishable from copy a human filed: an editor
    approves it, a *different* editor publishes it, and `ai_generated` plus
    `article_type` keep the provenance visible at every step.
    """
    from nanoid import generate

    from app.models.content import WorkflowTransition

    draft = get_draft(db, draft_id)
    if draft.status == AiDraftStatus.CONVERTED and draft.article_id:
        raise ConflictError(message_en="That draft already became an article.",
                            details={"article_id": draft.article_id})
    if draft.status == AiDraftStatus.DISCARDED:
        raise ConflictError(message_en="That draft was discarded.")
    if not draft.body:
        raise ValidationError(message_en="The draft has no body to convert.")

    principal.assert_scope(district_id=draft.district_id, mandal_id=None)

    from app.telugu.normalize import normalize_headline
    from app.telugu.transliterate import slugify

    title = normalize_headline(draft.title_te)
    body, plain, html, words, seconds = tiptap.derive(draft.body)
    article = Article(
        short_id=generate(size=6),
        slug=slugify(title)[:180] or "ai-draft",
        title_te=title,
        summary_te=draft.summary_te,
        body=body, body_plain=plain, body_html=html,
        word_count=words, reading_time_sec=seconds,
        category_id=draft.category_id,
        district_id=draft.district_id,
        author_id=principal.id,
        created_by=principal.id,
        updated_by=principal.id,
        # Provenance is not optional and is not editable through the API.
        ai_generated=True,
        ai_model=draft.model,
        ai_confidence=draft.confidence,
        article_type=ArticleType.AI_DRAFT,
        # SUBMITTED, not DRAFT: it goes straight into the review queue where a
        # human has to act on it. It cannot sit unnoticed in someone's drafts.
        status=ArticleStatus.PENDING,
        workflow_state=WorkflowState.SUBMITTED,
        source_type="own",
    )
    db.add(article)
    db.flush()

    db.add(WorkflowTransition(article_id=article.id, from_state=None,
                              to_state=WorkflowState.SUBMITTED, actor_id=principal.id,
                              note=f"AI draft #{draft.id} converted for review",
                              created_at=utcnow()))
    draft.status = AiDraftStatus.CONVERTED
    draft.article_id = article.id
    if draft.suggestion:
        draft.suggestion.status = AiSuggestionStatus.USED
    logger.info("ai_draft_converted", draft_id=draft.id, article_id=article.id)
    return article
