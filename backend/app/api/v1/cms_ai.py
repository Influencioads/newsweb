"""AI newsroom assistance (updated doc §15–18).

    GET    /cms/ai/suggestions            — today's ideas (ai.use)
    POST   /cms/ai/suggestions/generate   — run discovery (ai.use)
    POST   /cms/ai/suggestions/{id}/draft — write copy for one (ai.use)
    POST   /cms/ai/suggestions/{id}/reject
    GET    /cms/ai/drafts                 — AI copy awaiting a decision
    POST   /cms/ai/drafts/{id}/convert    — becomes an Article at SUBMITTED
    POST   /cms/ai/drafts/{id}/discard
    POST   /cms/ai/articles/{id}/image    — draw an illustration (article.edit)
    POST   /cms/ai/articles/{id}/social-card/text — the card's words (article.edit)
    POST   /cms/ai/articles/{id}/social-card      — render a news card (article.edit)
    GET    /cms/ai/creative/references        — the studio's design references (media.view)
    POST   /cms/ai/creative/references        — upload one (media.upload)
    DELETE /cms/ai/creative/references/{id}   — remove one (media.delete)

Note what is missing: there is no publish route here, and `convert` returns an
article in SUBMITTED. Everything below routes through the same editorial gate
as human copy.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import Principal, require_any_permission, require_permission
from app.core.errors import NotFoundError
from app.db.session import get_db
from app.models.ai import AiArticleDraft, AiSuggestion
from app.models.content import Article
from app.models.enums import AiDraftStatus, AiSuggestionStatus, AuditAction
from app.models.media import Media
from app.services import (
    ai_image_service,
    ai_service,
    audit_service,
    media_service,
    social_card_service,
)

router = APIRouter(prefix="/cms/ai", tags=["ai"])


class GenerateIn(BaseModel):
    limit: int | None = Field(default=None, ge=1, le=50)


class DraftIn(BaseModel):
    notes: str | None = Field(default=None, max_length=2000)


class RejectIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


def _suggestion_row(s: AiSuggestion) -> dict:
    return {
        "id": s.id,
        "topic_te": s.topic_te,
        "topic_en": s.topic_en,
        "rationale_te": s.rationale_te,
        "category_id": s.category_id,
        "district_id": s.district_id,
        "status": s.status,
        "score": round(s.score, 2),
        "engine": s.engine,
        "model": s.model,
        "created_at": s.created_at,
        "review_note": s.review_note,
        # §17: attribution travels with the suggestion so the editor can check
        # the claim before a word is written.
        "sources": [
            {
                "publisher": x.publisher,
                "title": x.title,
                "url": x.url,
                "licence": x.licence,
                "excerpt": x.excerpt,
            }
            for x in s.sources
        ],
    }


def _draft_row(d: AiArticleDraft) -> dict:
    return {
        "id": d.id,
        "suggestion_id": d.suggestion_id,
        "title_te": d.title_te,
        "summary_te": d.summary_te,
        "body": d.body,
        "body_plain": d.body_plain,
        "category_id": d.category_id,
        "district_id": d.district_id,
        "status": d.status,
        "engine": d.engine,
        "model": d.model,
        "confidence": d.confidence,
        "word_count": d.word_count,
        "article_id": d.article_id,
        "created_at": d.created_at,
    }


@router.get("/suggestions")
def list_suggestions(
    status: AiSuggestionStatus | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("ai.use")),
):
    stmt = select(AiSuggestion)
    if status is not None:
        stmt = stmt.where(AiSuggestion.status == status)
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.order_by(AiSuggestion.score.desc(), AiSuggestion.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return {"items": [_suggestion_row(s) for s in rows], "total": total}


@router.post("/suggestions/generate", status_code=201)
def generate(
    payload: GenerateIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("ai.use")),
):
    created = ai_service.generate_suggestions(db, limit=payload.limit, actor_id=p.id)
    audit_service.record(
        db,
        action=AuditAction.AI_RUN,
        entity_type="ai_suggestion",
        entity_id="generate",
        actor=p.user,
        after={"count": len(created)},
        request=request,
    )
    return {"items": [_suggestion_row(s) for s in created], "total": len(created)}


@router.post("/suggestions/{suggestion_id}/reject")
def reject(
    suggestion_id: int,
    payload: RejectIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("ai.use")),
):
    suggestion = ai_service.reject_suggestion(
        db, suggestion_id, actor_id=p.id, note=payload.note
    )
    audit_service.record(
        db,
        action=AuditAction.REJECT,
        entity_type="ai_suggestion",
        entity_id=suggestion.id,
        actor=p.user,
        note=payload.note,
        request=request,
    )
    return _suggestion_row(suggestion)


@router.post("/suggestions/{suggestion_id}/draft", status_code=201)
def draft(
    suggestion_id: int,
    payload: DraftIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("ai.use")),
):
    row = ai_service.create_draft(db, suggestion_id, actor_id=p.id, notes=payload.notes)
    audit_service.record(
        db,
        action=AuditAction.AI_RUN,
        entity_type="ai_article_draft",
        entity_id=row.id,
        actor=p.user,
        request=request,
    )
    return _draft_row(row)


@router.get("/drafts")
def list_drafts(
    status: AiDraftStatus | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("ai.use")),
):
    stmt = select(AiArticleDraft)
    if status is not None:
        stmt = stmt.where(AiArticleDraft.status == status)
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.order_by(AiArticleDraft.created_at.desc()).offset(offset).limit(limit)
    ).all()
    return {"items": [_draft_row(d) for d in rows], "total": total}


@router.get("/drafts/{draft_id}")
def get_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("ai.use")),
):
    return _draft_row(ai_service.get_draft(db, draft_id))


@router.post("/drafts/{draft_id}/convert", status_code=201)
def convert(
    draft_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("article.create")),
):
    """Creating the article needs `article.create` — the same permission a
    person needs to file copy. AI does not get a shortcut."""
    article = ai_service.convert_draft(db, draft_id, p)
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="article",
        entity_id=article.id,
        actor=p.user,
        after={"from_ai_draft": draft_id, "workflow_state": article.workflow_state},
        request=request,
    )
    return {
        "article_id": article.id,
        "short_id": article.short_id,
        "workflow_state": article.workflow_state,
        "status": article.status,
    }


@router.post("/drafts/{draft_id}/discard")
def discard(
    draft_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("ai.use")),
):
    row = ai_service.discard_draft(db, draft_id, actor_id=p.id)
    audit_service.record(
        db,
        action=AuditAction.DELETE,
        entity_type="ai_article_draft",
        entity_id=row.id,
        actor=p.user,
        request=request,
    )
    return _draft_row(row)


class ImageIn(BaseModel):
    brief: str | None = Field(default=None, max_length=500)
    force: bool = False


@router.post("/articles/{article_id}/image")
def generate_image(
    article_id: int,
    payload: ImageIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_any_permission("article.edit", "article.edit_own")),
):
    """Draw an illustration for a story that has no picture.

    `article.edit_own` is scoped the way `audio._article` scopes it: the
    permission says a story may be edited, the scope says which one. Without
    that check a stringer could spend the newsroom's image budget on somebody
    else's copy.

    Switched off and no-key answer `available: false` with the reason, exactly
    as generate-audio does — those are states of the install, not errors an
    editor caused. A provider failure and a refused topic still raise, because
    the CMS must show what actually went wrong.
    """
    article = _scoped_article(db, article_id, p)

    reason = ai_image_service.unavailable_reason(db)
    media = None
    if reason is None:
        media = ai_image_service.generate_for_article(
            db, article, actor_id=p.id, brief=payload.brief, force=payload.force
        )
    audit_service.record(
        db,
        action=AuditAction.AI_RUN,
        entity_type="article",
        entity_id=article.id,
        actor=p.user,
        after={"image_media_id": media.id if media else None, "reason": reason},
        request=request,
    )
    return {
        "available": reason is None,
        "media": (
            {
                "id": media.id,
                "url": media.cdn_url,
                "width": media.width,
                "height": media.height,
                "alt_te": media.alt_te,
                "ai_generated": media.ai_generated,
                "ai_model": media.ai_model,
                # Whether it actually became the picture on the story is the
                # outcome the editor pressed the button for.
                "is_hero": article.hero_media_id == media.id,
            }
            if media
            else None
        ),
        "reason": reason,
    }


def _scoped_article(db: Session, article_id: int, p: Principal) -> Article:
    """The story, if this person may work on it — see `generate_image`."""
    article = db.get(Article, article_id)
    if article is None or article.deleted_at:
        raise NotFoundError()
    p.assert_scope(district_id=article.district_id, mandal_id=article.mandal_id)
    return article


@router.post("/articles/{article_id}/social-card/text")
def social_card_text(
    article_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_any_permission("article.edit", "article.edit_own")),
):
    """A short headline, two-sentence summary and tag for a news card.

    Written by the editorial model when AI is on; with AI off it is our own
    headline and standfirst trimmed, so the button never dead-ends. Only the
    model's version is audited — it is the one that cost money.
    """
    article = _scoped_article(db, article_id, p)
    out = social_card_service.card_text(db, article, actor_id=p.id)
    if out["engine"] == "ai":
        audit_service.record(
            db,
            action=AuditAction.AI_RUN,
            entity_type="article",
            entity_id=article.id,
            actor=p.user,
            after={"social_card_text": True},
            request=request,
        )
    return out


class SocialCardIn(BaseModel):
    aspect: Literal["1:1", "4:5", "16:9", "9:16"] = "4:5"
    template: Literal["panel", "overlay", "frame"] = "panel"
    headline: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    summary: Annotated[str, StringConstraints(strip_whitespace=True, max_length=400)] = ""
    tag: Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)] | None = None
    #: story = the article's hero, ai = draw one with the image model, none =
    #: brand background. `photo_media_id` overrides story/ai with that exact
    #: picture — how the CMS re-renders after a text edit without paying for a
    #: second drawing.
    photo: Literal["story", "ai", "none"] = "story"
    photo_media_id: int | None = Field(default=None, ge=1)
    brief: str | None = Field(default=None, max_length=500)
    #: The creative studio's custom canvas, in pixels; replaces `aspect`.
    width: int | None = Field(default=None, ge=320, le=4096)
    height: int | None = Field(default=None, ge=320, le=4096)
    #: A design backdrop GPT Image 2.5 draws in the style of these references
    #: (none: in our palette). `backdrop_media_id` reuses one already drawn —
    #: the free re-render after a text edit, as `photo_media_id` is.
    use_ai_backdrop: bool = False
    reference_media_ids: list[int] = Field(default_factory=list, max_length=4)
    backdrop_media_id: int | None = Field(default=None, ge=1)
    backdrop_brief: str | None = Field(default=None, max_length=300)
    #: Also file the finished card in the media library.
    save: bool = False

    @model_validator(mode="after")
    def _both_sides(self) -> "SocialCardIn":
        if (self.width is None) != (self.height is None):
            raise ValueError("width and height go together")
        return self


@router.post("/articles/{article_id}/social-card")
def social_card(
    article_id: int,
    payload: SocialCardIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_any_permission("article.edit", "article.edit_own")),
):
    """Render a news card — photo, headline, summary, masthead — in one of the
    four social shapes or the creative studio's exact size, store it, and
    return its URL.

    Same permission and scope as `generate_image`, because `photo: ai` and
    `use_ai_backdrop` spend the same image budget. The backdrop is design
    only; the story's own photograph and the approved words are placed on it
    here, never drawn by the model. Nothing about the story changes: the card is a
    file, and a drawn picture waits in the media library, never replacing the
    hero. Unavailable (no Telugu shaping here, image generation switched off)
    answers `available: false` with the reason, as the image route does.
    """
    article = _scoped_article(db, article_id, p)
    drawing = payload.photo == "ai" and payload.photo_media_id is None
    designing = payload.use_ai_backdrop and payload.backdrop_media_id is None
    out = social_card_service.make_card(
        db,
        article,
        aspect=payload.aspect,
        template=payload.template,
        headline=payload.headline,
        summary=payload.summary,
        tag=payload.tag,
        photo=payload.photo,
        photo_media_id=payload.photo_media_id,
        brief=payload.brief,
        actor_id=p.id,
        size=(payload.width, payload.height) if payload.width and payload.height else None,
        reference_media_ids=payload.reference_media_ids,
        backdrop_media_id=payload.backdrop_media_id,
        use_ai_backdrop=payload.use_ai_backdrop,
        backdrop_brief=payload.backdrop_brief,
        save=payload.save,
    )
    card = out["card"]
    if card and ((drawing and card["photo"]) or (designing and card["backdrop"])):
        audit_service.record(
            db,
            action=AuditAction.AI_RUN,
            entity_type="article",
            entity_id=article.id,
            actor=p.user,
            after={
                "social_card_image_media_id": card["photo"]["media_id"] if drawing else None,
                "creative_backdrop_media_id": card["backdrop"]["media_id"] if designing else None,
            },
            request=request,
        )
    if card and card["media_id"]:
        audit_service.record(
            db,
            action=AuditAction.MEDIA_UPLOAD,
            entity_type="media",
            entity_id=card["media_id"],
            actor=p.user,
            after={"creative": True, "article_id": article.id},
            request=request,
        )
    return out


# --------------------------------------------------------------------------- #
# Creative studio: the desk's design references
# --------------------------------------------------------------------------- #
def _reference_row(m: Media) -> dict:
    return {
        "id": m.id,
        "url": m.cdn_url or f"/media/{m.storage_key}",
        "width": m.width,
        "height": m.height,
        "filename": m.filename,
        "created_at": m.created_at,
    }


def _reference(db: Session, media_id: int) -> Media:
    media = db.get(Media, media_id)
    if media is None or media.deleted_at or not (media.meta or {}).get("design_reference"):
        raise NotFoundError()
    return media


@router.get("/creative/references")
def creative_references(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("media.view")),
):
    """The designs the desk pushed for GPT Image 2.5 to take its style from.

    Kept out of `GET /cms/media`, so they are never offered as a story's
    picture; this is the only list that shows them.
    """
    rows = db.scalars(
        select(Media)
        .where(Media.deleted_at.is_(None), media_service.meta_flag("design_reference"))
        .order_by(Media.created_at.desc())
        .limit(200)
    ).all()
    return {"items": [_reference_row(m) for m in rows]}


@router.post("/creative/references", status_code=201)
async def upload_creative_reference(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("media.upload")),
):
    """A reference design, through the same validating, re-encoding pipeline
    as every upload. It is only ever read for style, never published, so it
    needs no credit — whoever made it."""
    media = media_service.create_image_media(
        db,
        raw=await file.read(),
        filename=file.filename or "reference",
        mime=file.content_type or "application/octet-stream",
        max_bytes=settings.UPLOAD_IMAGE_MAX_BYTES,
        uploaded_by=p.id,
        source_type="own",
        meta={"design_reference": True},
    )
    audit_service.record(
        db,
        action=AuditAction.MEDIA_UPLOAD,
        entity_type="media",
        entity_id=media.id,
        actor=p.user,
        after={"design_reference": True, "filename": media.filename},
        request=request,
    )
    return _reference_row(media)


@router.delete("/creative/references/{media_id}")
def delete_creative_reference(
    media_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("media.delete")),
):
    """Remove a reference. Only references: this is not a general media
    delete, and a story's photo id sent here is a 404."""
    media = _reference(db, media_id)
    media_service.delete_media(db, media)
    audit_service.record(
        db,
        action=AuditAction.MEDIA_DELETE,
        entity_type="media",
        entity_id=media.id,
        actor=p.user,
        after={"design_reference": True},
        request=request,
    )
    return {"removed": True}
