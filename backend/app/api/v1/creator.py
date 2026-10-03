"""Creator submissions (updated doc §17) and the CMS assist endpoint (§18).

POST /users/me/submissions          — submit an article (signed-in reader)
GET  /users/me/submissions          — my submissions with status
GET  /cms/moderation/submissions    — moderation queue
POST /cms/moderation/submissions/{id}/approve | /reject
POST /cms/ai/assist                 — §18 suggestions (ai.use)
POST /cms/ai/headlines              — alternative headlines + SEO pair (ai.use)
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.cms_ai import _scoped_article
from app.core.config import settings
from app.core.deps import (
    Principal,
    get_current_principal,
    require_any_permission,
    require_permission,
)
from app.core.errors import ConflictError
from app.core.ratelimit import rate_limit
from app.db.session import get_db
from app.models.content import Article, Category
from app.models.creator import CreatorSubmission
from app.models.enums import AuditAction, SubmissionStatus, Vertical
from app.models.geo import District
from app.models.media import Media
from app.models.kyc import ContributorProfile
from app.repositories import article_repo
from app.services import (
    ai_assist_service,
    audit_service,
    kyc_service,
    media_service,
    submission_service,
)

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


def _submission_out(
    submission: CreatorSubmission, article_url: str | None
) -> SubmissionOut:
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


@router.post(
    "/users/me/submissions/{submission_id}/media",
    status_code=201,
    summary="Attach one photograph to a pending submission",
)
async def attach_submission_media(
    submission_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
    _rl: None = Depends(rate_limit("submission_media", 6)),
) -> dict:
    """Photographs are what verification buys, and until now nothing spent it:
    `kyc_service.may_attach_images` existed with no caller.

    Deliberately not `media.upload`: granting a reader that permission would
    hand them the whole CMS media API. This is their own photo on their own
    submission, so it is scoped to `/users/me` like the avatar route.
    """
    profile = kyc_service.profile_for(db, principal.id)
    if profile is None or not kyc_service.may_attach_images(db, principal.id):
        raise ConflictError(
            message_en="Only verified contributors can attach photographs.",
            message_te="ధృవీకరించిన విలేకరులు మాత్రమే ఫోటోలు జోడించగలరు.",
            details={"kyc": "approval required"},
        )
    submission = submission_service.check_can_attach(
        db, submission_id=submission_id, user_id=principal.id
    )

    raw = await file.read()
    media = media_service.create_image_media(
        db,
        raw=raw,
        filename=file.filename or "photo",
        mime=file.content_type or "application/octet-stream",
        max_bytes=settings.UPLOAD_IMAGE_MAX_BYTES,
        uploaded_by=principal.id,
        # §12.5: a photograph that is not ours needs a credit, and the
        # contributor's chosen byline is that credit.
        source_type="contributed",
        credit=profile.display_name_te,
    )
    submission_service.attach_media(db, submission=submission, media_id=media.id)
    audit_service.record(
        db,
        action=AuditAction.MEDIA_UPLOAD,
        entity_type="creator_submission",
        entity_id=submission.id,
        actor=principal.user,
        after={"media_id": media.id, "bytes": media.bytes},
        request=request,
    )
    return {
        "id": media.id,
        "url": media.cdn_url or f"/media/{media.storage_key}",
        "media_ids": submission.media_ids,
    }


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
        )
        .unique()
        .scalars()
    )
    article_ids = [s.article_id for s in rows if s.article_id]
    urls: dict[int, str] = {}
    if article_ids:
        for article in db.execute(
            select(Article).where(Article.id.in_(article_ids))
        ).scalars():
            if article.is_live:
                urls[article.id] = article.url_path
    return [
        _submission_out(s, urls.get(s.article_id) if s.article_id else None)
        for s in rows
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
    vertical: Vertical | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(_moderator),
) -> dict:
    where = [CreatorSubmission.status == status] if status else []
    if vertical is not None:
        where.append(ContributorProfile.vertical == vertical)
    # Outer-joined so the desk sees which vertical a story came from — and can
    # work one desk's queue — while submissions from readers with no
    # contributor profile at all still appear.
    stmt = (
        select(CreatorSubmission, ContributorProfile.vertical)
        .outerjoin(
            ContributorProfile,
            ContributorProfile.user_id == CreatorSubmission.user_id,
        )
        .where(*where)
        .order_by(CreatorSubmission.created_at.asc())
        .limit(limit)
        .offset(offset)
    )
    rows = list(db.execute(stmt).unique().all())
    categories = {c.id: c for c in db.execute(select(Category)).scalars()}
    districts = {d.id: d for d in db.execute(select(District)).scalars()}
    # Resolve the ids to URLs here. A moderator cannot look at an integer, and
    # the whole point of letting a contributor attach a photograph is that
    # somebody sees it before the story is approved.
    photo_ids = {mid for s, _v in rows for mid in (s.media_ids or [])}
    photos = (
        {
            m.id: m
            for m in db.scalars(select(Media).where(Media.id.in_(photo_ids))).all()
        }
        if photo_ids
        else {}
    )
    return {
        "items": [
            {
                "id": s.id,
                "title_te": s.title_te,
                "body_te": s.body_te,
                "creator_name_te": s.user.name_te if s.user else None,
                "creator_phone": s.user.phone if s.user else None,
                "vertical": v,
                "media": [
                    {
                        "id": m.id,
                        "url": m.cdn_url,
                        "alt_te": m.alt_te,
                    }
                    for m in (photos.get(i) for i in (s.media_ids or []))
                    if m is not None and m.deleted_at is None
                ],
                "category_slug": categories[s.category_id].slug
                if s.category_id in categories
                else None,
                "district_slug": districts[s.district_id].slug
                if s.district_id in districts
                else None,
                "status": s.status,
                "review_note": s.review_note,
                "article_id": s.article_id,
                "created_at": s.created_at,
            }
            for s, v in rows
        ]
    }


@router.post(
    "/cms/moderation/submissions/{submission_id}/approve",
    summary="Approve into the review queue",
)
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


@router.post(
    "/cms/moderation/submissions/{submission_id}/reject", summary="Reject with a note"
)
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
        default=None,
        description="Assist an existing draft; or pass title/body directly",
    )
    title_te: str | None = Field(default=None, max_length=400)
    body_plain: str | None = Field(default=None, max_length=60_000)
    # The editor's standfirst: without it the style checklist never lints it
    # and shows a clean pass over a placeholder or a banned phrase there.
    summary_te: str | None = Field(default=None, max_length=1000)


@router.post(
    "/cms/ai/assist", summary="Editorial suggestions (§18) — heuristic engine v1"
)
def assist(
    payload: AssistIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("ai.use")),
) -> dict:
    title = payload.title_te or ""
    body = payload.body_plain or ""
    summary: str | None = payload.summary_te
    exclude = None
    if payload.article_id is not None:
        article = _scoped_article(db, payload.article_id, p)
        title = article.title_te
        body = article.body_plain or ""
        summary = article.summary_te
        exclude = article.id
    return ai_assist_service.assist(
        db,
        title_te=title,
        body_plain=body,
        summary_te=summary,
        exclude_article_id=exclude,
    )


@router.post("/cms/ai/headlines", summary="Headline ideas in the house style")
def headlines(
    payload: AssistIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("ai.use")),
) -> dict:
    """Up to eight headline options and an SEO title/description.

    The one paid call beside assist: the editorial model, billed to the
    caller. With AI off or no key it answers 200 `available: false` with the
    reason, so the button explains itself instead of failing.
    """
    title = payload.title_te or ""
    body = payload.body_plain or ""
    summary = payload.summary_te
    if payload.article_id is not None:
        article = _scoped_article(db, payload.article_id, p)
        title = article.title_te
        body = article.body_plain or ""
        summary = summary or article.summary_te
    return ai_assist_service.headline_ideas(
        db, title_te=title, body_plain=body, summary_te=summary, actor_id=p.id
    )
