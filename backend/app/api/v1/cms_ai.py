"""AI newsroom assistance (updated doc §15–18).

    GET    /cms/ai/suggestions            — today's ideas (ai.use)
    POST   /cms/ai/suggestions/generate   — run discovery (ai.use)
    POST   /cms/ai/suggestions/{id}/draft — write copy for one (ai.use)
    POST   /cms/ai/suggestions/{id}/reject
    GET    /cms/ai/drafts                 — AI copy awaiting a decision
    POST   /cms/ai/drafts/{id}/convert    — becomes an Article at SUBMITTED
    POST   /cms/ai/drafts/{id}/discard

Note what is missing: there is no publish route here, and `convert` returns an
article in SUBMITTED. Everything below routes through the same editorial gate
as human copy.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_permission
from app.db.session import get_db
from app.models.ai import AiArticleDraft, AiSuggestion
from app.models.enums import AiDraftStatus, AiSuggestionStatus, AuditAction
from app.services import ai_service, audit_service

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
