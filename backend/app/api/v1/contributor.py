"""Applying to be a contributor — the reader's side.

    GET    /users/me/contributor
    POST   /users/me/contributor                 start or edit the application
    POST   /users/me/contributor/documents       upload one document
    DELETE /users/me/contributor/documents/{id}
    POST   /users/me/contributor/submit

These need only a signed-in session, like every other `/users/me` route: a
reader holds no permission keys, and applying is something any reader may do.

**No response here ever contains a document URL.** `KycDocument` has no `url`
column, and the applicant gets back an id, the kind, the masked number and a
timestamp. Their own passport scan is not re-served to them from a link that
could be forwarded.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, get_current_principal
from app.core.errors import ConflictError, NotFoundError
from app.core.ratelimit import rate_limit
from app.db.session import get_db
from app.models.enums import AuditAction, ContributorType, KycDocumentKind, KycStatus
from app.models.geo import District, Mandal
from app.models.kyc import ContributorProfile, KycDocument
from app.services import audit_service, kyc_service, secure_upload_service

router = APIRouter(prefix="/users/me/contributor", tags=["contributor"])


class ContributorIn(BaseModel):
    contributor_type: ContributorType = ContributorType.CITIZEN
    display_name_te: str = Field(min_length=2, max_length=120)
    bio_te: str | None = Field(default=None, max_length=1000)
    district_slug: str | None = None
    mandal_slug: str | None = None
    organisation: str | None = Field(default=None, max_length=200)
    portfolio_url: str | None = Field(default=None, max_length=500)
    course_year: int | None = Field(default=None, ge=1, le=8)


def _document_row(document: KycDocument) -> dict:
    # Deliberately no url, no storage_key, no sha256 — nothing an applicant
    # could use to reach the file, and nothing worth intercepting.
    return {
        "id": document.id,
        "kind": document.kind,
        "number_masked": document.number_masked,
        "uploaded_at": document.uploaded_at,
    }


def _profile_row(db: Session, profile: ContributorProfile | None) -> dict:
    if profile is None:
        return {
            "status": KycStatus.NOT_STARTED,
            "contributor_type": None,
            "documents": [],
            "missing": [],
            "can_edit": True,
        }
    return {
        "id": profile.id,
        "status": profile.kyc_status,
        "contributor_type": profile.contributor_type,
        "display_name_te": profile.display_name_te,
        "bio_te": profile.bio_te,
        "organisation": profile.organisation,
        "portfolio_url": profile.portfolio_url,
        "course_year": profile.course_year,
        "district_id": profile.district_id,
        "mandal_id": profile.mandal_id,
        "review_note": profile.review_note,
        "submitted_at": profile.submitted_at,
        "reviewed_at": profile.reviewed_at,
        "expires_at": profile.expires_at,
        "verified_badge": profile.verified_badge,
        "documents": [_document_row(d) for d in profile.documents],
        "missing": kyc_service.missing_documents(db, profile),
        "can_edit": profile.kyc_status
        in (KycStatus.NOT_STARTED, KycStatus.DRAFT, KycStatus.MORE_INFO),
        "pending_limit": kyc_service.pending_limit(db, profile.user_id),
    }


@router.get("")
def my_application(
    db: Session = Depends(get_db),
    p: Principal = Depends(get_current_principal),
):
    return _profile_row(db, kyc_service.profile_for(db, p.id))


@router.post("")
def start_application(
    payload: ContributorIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(get_current_principal),
    _rl: None = Depends(rate_limit("kyc", 3)),
):
    district_id = mandal_id = None
    if payload.district_slug:
        district = db.scalar(
            select(District).where(District.slug == payload.district_slug)
        )
        district_id = district.id if district else None
    if payload.mandal_slug:
        mandal = db.scalar(select(Mandal).where(Mandal.slug == payload.mandal_slug))
        mandal_id = mandal.id if mandal else None

    profile = kyc_service.start_or_update(
        db,
        user=p.user,
        contributor_type=payload.contributor_type,
        display_name_te=payload.display_name_te,
        bio_te=payload.bio_te,
        district_id=district_id,
        mandal_id=mandal_id,
        organisation=payload.organisation,
        portfolio_url=payload.portfolio_url,
        course_year=payload.course_year,
    )
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="contributor_profile",
        entity_id=profile.id,
        actor=p.user,
        after={"type": profile.contributor_type, "status": profile.kyc_status},
        request=request,
    )
    return _profile_row(db, profile)


@router.post("/documents", status_code=201)
async def upload_document(
    request: Request,
    kind: KycDocumentKind = Form(...),
    number: str | None = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    p: Principal = Depends(get_current_principal),
    _rl: None = Depends(rate_limit("kyc_upload", 8)),
):
    profile = kyc_service.profile_for(db, p.id)
    if profile is None:
        raise ConflictError(
            message_en="Start your application before uploading documents.",
            message_te="పత్రాలు అప్‌లోడ్ చేసే ముందు దరఖాస్తు ప్రారంభించండి.",
        )

    raw = await file.read(secure_upload_service.MAX_DOC_BYTES + 1)
    document = kyc_service.add_document(
        db,
        profile=profile,
        kind=kind,
        raw=raw,
        declared_mime=file.content_type,
        number=number,
    )
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="kyc_document",
        entity_id=document.id,
        actor=p.user,
        after={"kind": document.kind, "bytes": document.bytes},
        request=request,
    )
    return _document_row(document)


@router.delete("/documents/{document_id}")
def remove_document(
    document_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(get_current_principal),
):
    profile = kyc_service.profile_for(db, p.id)
    if profile is None:
        raise NotFoundError()
    document = db.get(KycDocument, document_id)
    if document is None or document.profile_id != profile.id:
        raise NotFoundError()
    if profile.kyc_status not in (
        KycStatus.NOT_STARTED,
        KycStatus.DRAFT,
        KycStatus.MORE_INFO,
    ):
        raise ConflictError(
            message_en="Documents cannot be removed while the application is under review.",
            message_te="సమీక్షలో ఉన్నప్పుడు పత్రాలు తొలగించలేరు.",
        )

    from app.integrations.storage import get_private_storage

    try:
        get_private_storage().delete(document.storage_key)
    except Exception:  # noqa: BLE001 — the row goes either way
        pass
    db.delete(document)
    db.flush()
    audit_service.record(
        db,
        action=AuditAction.DELETE,
        entity_type="kyc_document",
        entity_id=document_id,
        actor=p.user,
        request=request,
    )
    return {"ok": True, "id": document_id}


@router.post("/submit")
def submit_application(
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(get_current_principal),
    _rl: None = Depends(rate_limit("kyc", 3)),
):
    profile = kyc_service.profile_for(db, p.id)
    if profile is None:
        raise NotFoundError()
    profile = kyc_service.submit(db, profile=profile, user=p.user)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="contributor_profile",
        entity_id=profile.id,
        actor=p.user,
        after={"status": profile.kyc_status},
        request=request,
    )
    return _profile_row(db, profile)
