"""Reviewing contributor applications.

    GET  /cms/kyc                                   kyc.review
    GET  /cms/kyc/{id}                              kyc.review
    GET  /cms/kyc/{id}/documents/{doc}/raw          kyc.view_document
    POST /cms/kyc/{id}/approve | reject | request-more

The permission split is the privacy design. `kyc.review` shows the queue, the
applicant's own declaration and masked document numbers — enough to triage,
and enough to reject an obviously incomplete application. Opening the actual
government ID needs `kyc.view_document`, which only editor-in-chief and above
hold, and **every open writes an audit row** with the actor, their IP and the
request id. Splitting them is what makes that log mean something: without it,
"who looked at this person's passport" has the same answer as "who has ever
opened the queue".

The raw route streams from the private bucket with `no-store`. There is no
public URL for these files and no way to mint one.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_permission
from app.core.errors import NotFoundError
from app.db.session import get_db
from app.integrations.kyc.base import KycDecision
from app.models.enums import AuditAction, ContributorType, KycDocumentKind, KycStatus
from app.models.kyc import ContributorProfile, KycDocument
from app.services import audit_service, kyc_service, secure_upload_service

router = APIRouter(prefix="/cms/kyc", tags=["kyc"])


def _document_row(document: KycDocument) -> dict:
    """Metadata a reviewer can triage on, without opening anything."""
    return {
        "id": document.id,
        "kind": document.kind,
        "mime": document.mime,
        "bytes": document.bytes,
        "number_masked": document.number_masked,
        "uploaded_at": document.uploaded_at,
        # The path that requires kyc.view_document and writes an audit row.
        "raw_path": f"/cms/kyc/{document.profile_id}/documents/{document.id}/raw",
    }


def _row(db: Session, profile: ContributorProfile, *, detail: bool = False) -> dict:
    user = profile.user
    row = {
        "id": profile.id,
        "user_id": profile.user_id,
        "name_te": user.name_te if user else None,
        "phone": user.phone if user else None,
        "phone_verified": bool(user and user.phone_verified_at),
        "contributor_type": profile.contributor_type,
        "status": profile.kyc_status,
        "display_name_te": profile.display_name_te,
        "organisation": profile.organisation,
        "portfolio_url": profile.portfolio_url,
        "course_year": profile.course_year,
        "district_id": profile.district_id,
        "mandal_id": profile.mandal_id,
        "submitted_at": profile.submitted_at,
        "reviewed_at": profile.reviewed_at,
        "review_note": profile.review_note,
        "verified_badge": profile.verified_badge,
        "expires_at": profile.expires_at,
        "provider": profile.provider,
        "document_count": len(profile.documents),
    }
    if detail:
        row["bio_te"] = profile.bio_te
        row["internal_note"] = profile.internal_note
        row["documents"] = [_document_row(d) for d in profile.documents]
        row["missing"] = kyc_service.missing_documents(db, profile)
    return row


@router.get("")
def list_applications(
    status: KycStatus | None = KycStatus.SUBMITTED,
    contributor_type: ContributorType | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("kyc.review")),
):
    rows, total = kyc_service.queue(
        db,
        status=status,
        contributor_type=contributor_type,
        offset=offset,
        limit=limit,
    )
    return {"items": [_row(db, r) for r in rows], "total": total}


@router.get("/{profile_id}")
def get_application(
    profile_id: int,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("kyc.review")),
):
    return _row(db, kyc_service.get_profile(db, profile_id), detail=True)


@router.get("/{profile_id}/documents/{document_id}/raw")
def read_document(
    profile_id: int,
    document_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("kyc.view_document")),
):
    """Stream one identity document to an authorised reviewer.

    The audit row is written **before** the bytes go out, so an open that was
    interrupted halfway is still recorded. A log that only captures successful
    reads is not a log of who looked.
    """
    document = db.get(KycDocument, document_id)
    if document is None or document.profile_id != profile_id:
        raise NotFoundError()

    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="kyc_document",
        entity_id=document.id,
        actor=p.user,
        note="identity document viewed",
        after={"kind": document.kind, "profile_id": profile_id},
        request=request,
    )
    db.flush()

    try:
        payload = secure_upload_service.read_private(document.storage_key)
    except Exception as exc:  # noqa: BLE001
        raise NotFoundError() from exc

    return Response(
        payload,
        media_type=document.mime,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": "inline",
            # Belt and braces: this route is behind auth, but a misconfigured
            # proxy that exposed it must not also get it indexed.
            "X-Robots-Tag": "noindex, noimageindex, nofollow",
        },
    )


class DecisionIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)
    internal_note: str | None = Field(default=None, max_length=2000)


class ApproveIn(DecisionIn):
    badge: bool = True
    expires_months: int = Field(
        default=kyc_service.DEFAULT_VALIDITY_MONTHS, ge=1, le=60
    )


class RequestMoreIn(DecisionIn):
    kinds: list[KycDocumentKind] = Field(default_factory=list)


def _decide(
    db: Session,
    request: Request,
    p: Principal,
    profile_id: int,
    decision: KycDecision,
    *,
    badge: bool = True,
    expires_months: int = kyc_service.DEFAULT_VALIDITY_MONTHS,
    internal_note: str | None = None,
) -> dict:
    profile = kyc_service.get_profile(db, profile_id)
    before = {"status": profile.kyc_status}
    if internal_note:
        profile.internal_note = internal_note
    kyc_service.apply_decision(
        db,
        profile,
        decision,
        actor_id=p.id,
        badge=badge,
        expires_months=expires_months,
    )
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="contributor_profile",
        entity_id=profile.id,
        actor=p.user,
        before=before,
        after={"status": profile.kyc_status, "badge": profile.verified_badge},
        request=request,
    )
    return _row(db, profile, detail=True)


@router.post("/{profile_id}/approve")
def approve(
    profile_id: int,
    payload: ApproveIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("kyc.review", min_level=60)),
):
    return _decide(
        db,
        request,
        p,
        profile_id,
        KycDecision(
            status=KycStatus.APPROVED,
            provider="manual",
            reason_te=payload.note,
        ),
        badge=payload.badge,
        expires_months=payload.expires_months,
        internal_note=payload.internal_note,
    )


@router.post("/{profile_id}/reject")
def reject(
    profile_id: int,
    payload: DecisionIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("kyc.review", min_level=60)),
):
    return _decide(
        db,
        request,
        p,
        profile_id,
        KycDecision(
            status=KycStatus.REJECTED, provider="manual", reason_te=payload.note
        ),
        internal_note=payload.internal_note,
    )


@router.post("/{profile_id}/request-more")
def request_more(
    profile_id: int,
    payload: RequestMoreIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("kyc.review")),
):
    """Ask for something specific, without rejecting.

    Not gated at level 60: telling somebody their college ID was unreadable is
    not a decision, and making a desk editor escalate to say so just means
    applications sit longer.
    """
    wanted = ", ".join(k.value for k in payload.kinds)
    note = payload.note or ""
    if wanted:
        note = f"{note} ({wanted})".strip()
    return _decide(
        db,
        request,
        p,
        profile_id,
        KycDecision(status=KycStatus.MORE_INFO, provider="manual", reason_te=note),
        internal_note=payload.internal_note,
    )
