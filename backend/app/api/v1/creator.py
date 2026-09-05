"""Creator submissions (updated doc §17) and the CMS assist endpoint (§18).

    POST /users/me/submissions          — submit an article (signed-in reader)
    GET  /users/me/submissions          — my submissions with status
    GET  /cms/moderation/submissions    — moderation queue
    POST /cms/moderation/submissions/{id}/approve | /reject
    POST /cms/ai/assist                 — §18 suggestions (ai.use)
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, get_current_principal, require_any_permission, require_permission
from app.core.errors import NotFoundError
from app.core.ratelimit import rate_limit
from app.db.session import get_db
from app.models.content import Article, Category
from app.models.creator import CreatorSubmission
from app.models.enums import AuditAction, SubmissionStatus
from app.models.geo import District
from app.repositories import article_repo
from app.services import ai_assist_service, audit_service, submission_service

router = APIRouter(tags=["creator"])


# --------------------------------------------------------------------------- #
# reader side (§17)
# --------------------------------------------------------------------------- #
class SubmissionIn(BaseModel):
    title_te: str = Field(min_length=10, max_length=400)
    body_te: str = Field(min_length=100, max_length=20_000)
    category_slug: str | None = None
    district_slug: str | None = None
    accept_guidelines: bool = Field(
        description="Must be true — §17 requires accepting the content guidelines"
    )


class SubmissionOut(BaseModel):
    id: int
    title_te: str
    status: SubmissionStatus
    review_note: str | None
    article_url: str | None
    created_at: datetime
    reviewed_at: datetime | None


def _submission_out(submission: CreatorSubmission, article_url: str | None) -> SubmissionOut:
    return SubmissionOut(
        id=submission.id,
        title_te=submission.title_te,
        status=submission.status,
        review_note=submission.review_note,
        article_url=article_url,
        created_at=submission.created_at,
        reviewed_at=submission.reviewed_at,
    )


@router.post(
    "/users/me/submissions",
    response_model=SubmissionOut,
    status_code=201,
    summary="Submit an article for moderation (§17)",
)
def create_submission(
    payload: SubmissionIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
    _rl: None = Depends(rate_limit("submission", 3)),
) -> SubmissionOut:
    category = (
        article_repo.get_category_by_slug(db, payload.category_slug)
        if payload.category_slug
        else None
    )
    district = (
        article_repo.get_district_by_slug(db, payload.district_slug)
        if payload.district_slug
        else None
    )
    submission = submission_service.create_submission(
        db,
        user_id=principal.id,
        title_te=payload.title_te,
        body_te=payload.body_te,
        category_id=category.id if category else None,
        district_id=district.id if district else None,
        accept_guidelines=payload.accept_guidelines,
    )
    return _submission_out(submission, None)


@router.get(
    "/users/me/submissions",
    response_model=list[SubmissionOut],
    summary="My submissions and their review status",
)
def my_submissions(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[SubmissionOut]:
    rows = list(
        db.execute(
            select(CreatorSubmission)
            .where(CreatorSubmission.user_id == principal.id)
            .order_by(CreatorSubmission.created_at.desc())
            .limit(50)
        ).unique().scalars()
    )
    article_ids = [s.article_id for s in rows if s.article_id]
    urls: dict[int, str] = {}
    if article_ids:
        for article in db.execute(select(Article).where(Article.id.in_(article_ids))).scalars():
            if article.is_live:
                urls[article.id] = article.url_path
    return [
        _submission_out(s, urls.get(s.article_id) if s.article_id else None) for s in rows
    ]


# --------------------------------------------------------------------------- #
# moderation side (§17, §19 Moderation)
# --------------------------------------------------------------------------- #
_moderator = require_any_permission("comment.moderate", "article.review")


class RejectIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


@router.get("/cms/moderation/submissions", summary="Creator submission queue")
def submission_queue(
    status: SubmissionStatus | None = Query(default=SubmissionStatus.PENDING),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(_moderator),
) -> dict:
    where = [CreatorSubmission.status == status] if status else []
    rows = list(
        db.execute(
            select(CreatorSubmission)
            .where(*where)
            .order_by(CreatorSubmission.created_at.asc())
            .limit(limit)
            .offset(offset)
        ).unique().scalars()
    )
    categories = {c.id: c for c in db.execute(select(Category)).scalars()}
    districts = {d.id: d for d in db.execute(select(District)).scalars()}
    return {
        "items": [
            {
                "id": s.id,
                "title_te": s.title_te,
                "body_te": s.body_te,
                "creator_name_te": s.user.name_te if s.user else None,
                "creator_phone": s.user.phone if s.user else None,
                "category_slug": categories[s.category_id].slug if s.category_id in categories else None,
                "district_slug": districts[s.district_id].slug if s.district_id in districts else None,
                "status": s.status,
                "review_note": s.review_note,
                "article_id": s.article_id,
                "created_at": s.created_at,
            }
            for s in rows
        ]
    }


@router.post("/cms/moderation/submissions/{submission_id}/approve", summary="Approve into the review queue")
def approve_submission(
    submission_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(_moderator),
) -> dict:
    submission, article = submission_service.approve_submission(
        db, submission_id=submission_id, moderator_id=p.id
    )
    audit_service.record(
        db,
        action=AuditAction.APPROVE,
        entity_type="creator_submission",
        entity_id=submission.id,
        actor=p.user,
        after={"article_id": article.id},
        request=request,
    )
    return {"id": submission.id, "status": submission.status, "article_id": article.id}


@router.post("/cms/moderation/submissions/{submission_id}/reject", summary="Reject with a note")
def reject_submission(
    submission_id: int,
    payload: RejectIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(_moderator),
) -> dict:
    submission = submission_service.reject_submission(
        db, submission_id=submission_id, moderator_id=p.id, note=payload.note
    )
    audit_service.record(
        db,
        action=AuditAction.REJECT,
        entity_type="creator_submission",
        entity_id=submission.id,
        actor=p.user,
        note=payload.note,
        request=request,
    )
    return {"id": submission.id, "status": submission.status}


# --------------------------------------------------------------------------- #
# §18 assist — suggestions only; the editor decides
# --------------------------------------------------------------------------- #
class AssistIn(BaseModel):
    article_id: int | None = Field(
        default=None, description="Assist an existing draft; or pass title/body directly"
    )
    title_te: str | None = Field(default=None, max_length=400)
    body_plain: str | None = Field(default=None, max_length=60_000)


@router.post("/cms/ai/assist", summary="Editorial suggestions (§18) — heuristic engine v1")
def assist(
    payload: AssistIn,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("ai.use")),
) -> dict:
    title = payload.title_te or ""
    body = payload.body_plain or ""
    summary: str | None = None
    exclude = None
    if payload.article_id is not None:
        article = db.get(Article, payload.article_id)
        if article is None:
            raise NotFoundError()
        title = article.title_te
        body = article.body_plain or ""
        summary = article.summary_te
        exclude = article.id
    return ai_assist_service.assist(
        db, title_te=title, body_plain=body, summary_te=summary, exclude_article_id=exclude
    )
