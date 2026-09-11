"""Contributor verification: applying, deciding, and what approval unlocks.

The shape that matters: **`apply_decision` is the only place a verdict is
written.** The Approve button in the admin queue and a future vendor webhook
both land there, which is what keeps swapping providers a configuration change
rather than a second review pipeline.

What approval grants is deliberately modest — a higher submission quota, the
right to attach photographs, and a verified badge. It grants no CMS access, and
it grants nothing that lets a contributor publish. Their story still becomes a
`CreatorSubmission`, still needs a moderator to convert it, and still lands in
the editorial queue as SUBMITTED for a different person to approve.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core import security
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.integrations.kyc import KycDocumentRef, KycSubmission, get_kyc
from app.integrations.kyc.base import KycDecision
from app.models.enums import ContributorType, KycDocumentKind, KycStatus, RoleKey
from app.models.kyc import ContributorProfile, KycDocument
from app.models.user import Role, User, UserRole
from app.services import secure_upload_service, settings_service

logger = get_logger(__name__)

#: A government photo ID, whichever kind.
PHOTO_ID: frozenset[KycDocumentKind] = frozenset(
    {
        KycDocumentKind.PAN,
        KycDocumentKind.VOTER_ID,
        KycDocumentKind.DRIVING_LICENCE,
        KycDocumentKind.PASSPORT,
    }
)

#: What each kind of applicant must show. Everyone proves who they are; the
#: difference is what else they must show to claim the description they chose.
REQUIRED_DOCS: dict[ContributorType, tuple[frozenset[KycDocumentKind], ...]] = {
    ContributorType.CITIZEN: (PHOTO_ID, frozenset({KycDocumentKind.SELFIE})),
    ContributorType.FREELANCE: (
        PHOTO_ID,
        frozenset({KycDocumentKind.SELFIE}),
        frozenset({KycDocumentKind.PRESS_ACCREDITATION}),
    ),
    ContributorType.STUDENT: (
        PHOTO_ID,
        frozenset({KycDocumentKind.SELFIE}),
        frozenset({KycDocumentKind.STUDENT_ID, KycDocumentKind.COLLEGE_BONAFIDE}),
    ),
}

#: How long an approval lasts before the contributor checks in again.
DEFAULT_VALIDITY_MONTHS = 24

#: Pending submissions allowed at once, by standing. The unverified number is
#: unchanged; verification is what raises it.
PENDING_LIMITS: dict[str, int] = {
    "unverified": 5,
    ContributorType.CITIZEN.value: 15,
    ContributorType.FREELANCE.value: 25,
    ContributorType.STUDENT.value: 25,
}


# --------------------------------------------------------------------------- #
# Reading
# --------------------------------------------------------------------------- #
def enabled(db: Session) -> bool:
    return settings_service.get_bool(db, "kyc.enabled")


def profile_for(db: Session, user_id: int) -> ContributorProfile | None:
    return db.scalar(
        select(ContributorProfile)
        .options(selectinload(ContributorProfile.documents))
        .where(ContributorProfile.user_id == user_id)
    )


def is_approved(db: Session, user_id: int) -> bool:
    profile = profile_for(db, user_id)
    if profile is None or not profile.is_approved:
        return False
    if profile.expires_at is not None and profile.expires_at <= utcnow():
        return False
    return True


def pending_limit(db: Session, user_id: int) -> int:
    """How many submissions this person may have awaiting review."""
    profile = profile_for(db, user_id)
    if profile is None or not is_approved(db, user_id):
        return PENDING_LIMITS["unverified"]
    return PENDING_LIMITS.get(
        profile.contributor_type.value, PENDING_LIMITS["unverified"]
    )


def may_attach_images(db: Session, user_id: int) -> bool:
    """Photographs are the clearest reason to complete verification, and the
    thing citizen journalists ask for most."""
    return is_approved(db, user_id)


def badge_for(db: Session, user_id: int) -> str | None:
    profile = profile_for(db, user_id)
    if profile is None or not profile.verified_badge or not is_approved(db, user_id):
        return None
    return profile.contributor_type.value


# --------------------------------------------------------------------------- #
# Applying
# --------------------------------------------------------------------------- #
_EDITABLE = {KycStatus.NOT_STARTED, KycStatus.DRAFT, KycStatus.MORE_INFO}


def start_or_update(
    db: Session,
    *,
    user: User,
    contributor_type: ContributorType,
    display_name_te: str,
    bio_te: str | None = None,
    district_id: int | None = None,
    mandal_id: int | None = None,
    organisation: str | None = None,
    portfolio_url: str | None = None,
    course_year: int | None = None,
) -> ContributorProfile:
    if not enabled(db):
        raise ConflictError(
            message_en="Contributor applications are closed right now.",
            message_te="ప్రస్తుతం విలేకరి దరఖాస్తులు స్వీకరించడం లేదు.",
        )

    profile = profile_for(db, user.id)
    if profile is None:
        profile = ContributorProfile(user_id=user.id, display_name_te=display_name_te)
        db.add(profile)
        db.flush()
    elif profile.kyc_status not in _EDITABLE:
        raise ConflictError(
            message_en="Your application is already being reviewed.",
            message_te="మీ దరఖాస్తు ఇప్పటికే సమీక్షలో ఉంది.",
        )

    profile.contributor_type = contributor_type
    profile.display_name_te = display_name_te.strip()[:120]
    profile.bio_te = (bio_te or "").strip() or None
    profile.district_id = district_id
    profile.mandal_id = mandal_id
    profile.organisation = (organisation or "").strip() or None
    profile.portfolio_url = (portfolio_url or "").strip() or None
    profile.course_year = course_year
    if profile.kyc_status == KycStatus.NOT_STARTED:
        profile.kyc_status = KycStatus.DRAFT
    db.flush()
    return profile


def add_document(
    db: Session,
    *,
    profile: ContributorProfile,
    kind: KycDocumentKind,
    raw: bytes,
    declared_mime: str | None,
    number: str | None = None,
) -> KycDocument:
    if profile.kyc_status not in _EDITABLE:
        raise ConflictError(
            message_en="Documents cannot be changed while the application is under review.",
            message_te="సమీక్షలో ఉన్నప్పుడు పత్రాలు మార్చలేరు.",
        )

    # A full Aadhaar number must never reach this table. The enum has no
    # AADHAAR member, and this catches somebody typing one into another field.
    digits = "".join(ch for ch in (number or "") if ch.isdigit())
    if len(digits) == 12:
        raise ValidationError(
            message_en=(
                "Do not enter an Aadhaar number. Use PAN, Voter ID, Driving "
                "Licence or Passport."
            ),
            message_te=(
                "ఆధార్ నంబర్ ఇవ్వొద్దు. పాన్, ఓటరు ID, డ్రైవింగ్ లైసెన్స్ లేదా "
                "పాస్‌పోర్ట్ వాడండి."
            ),
            details={"number": "aadhaar is not accepted"},
        )

    key, size, digest, mime = secure_upload_service.store_private(
        raw, key_prefix=f"kyc/{profile.id}/{kind.value}", declared_mime=declared_mime
    )

    existing = db.scalar(
        select(KycDocument).where(
            KycDocument.profile_id == profile.id, KycDocument.kind == kind
        )
    )
    document = existing or KycDocument(profile_id=profile.id, kind=kind)
    document.storage_key = key
    document.mime = mime
    document.bytes = size
    document.sha256 = digest
    document.number_masked = secure_upload_service.mask_number(number)
    document.number_encrypted = (
        security.encrypt_secret(number) if number else None
    )
    document.uploaded_at = utcnow()
    if existing is None:
        db.add(document)
    db.flush()
    logger.info("kyc_document_added", profile_id=profile.id, kind=kind.value)
    return document


def missing_documents(
    db: Session, profile: ContributorProfile
) -> list[list[str]]:
    """Which required groups are still unsatisfied, as lists of alternatives."""
    have = {d.kind for d in profile.documents}
    groups = REQUIRED_DOCS.get(profile.contributor_type, ())
    return [sorted(k.value for k in group) for group in groups if not (group & have)]


def submit(db: Session, *, profile: ContributorProfile, user: User) -> ContributorProfile:
    """Hand the application to whoever decides it."""
    if profile.kyc_status not in _EDITABLE:
        raise ConflictError(
            message_en="This application has already been submitted.",
            message_te="ఈ దరఖాస్తు ఇప్పటికే సమర్పించబడింది.",
        )

    # Phone is the identity anchor in India, the OTP flow already exists, and
    # an application from an unverifiable number is not worth a reviewer's time.
    if user.phone_verified_at is None:
        raise ValidationError(
            message_en="Verify your phone number before applying.",
            message_te="దరఖాస్తు చేసే ముందు మీ ఫోన్ నంబర్‌ను ధృవీకరించండి.",
            details={"phone": "not verified"},
        )

    missing = missing_documents(db, profile)
    if missing:
        raise ValidationError(
            message_en="Some required documents are missing.",
            message_te="కొన్ని అవసరమైన పత్రాలు లేవు.",
            details={"documents": "; ".join(" or ".join(g) for g in missing)},
        )
    if profile.contributor_type == ContributorType.FREELANCE and not (
        profile.portfolio_url
        or any(d.kind == KycDocumentKind.PRESS_ACCREDITATION for d in profile.documents)
    ):
        raise ValidationError(
            details={"portfolio_url": "accreditation or a portfolio link is required"}
        )
    if profile.contributor_type == ContributorType.STUDENT and not profile.organisation:
        raise ValidationError(details={"organisation": "name your college"})

    provider = get_kyc(str(settings_service.get(db, "kyc.provider") or "manual"))
    submission = KycSubmission(
        profile_id=profile.id,
        contributor_type=profile.contributor_type.value,
        full_name=user.name_te or user.name_en or "",
        phone=user.phone,
        email=user.email,
        documents=[
            KycDocumentRef(
                kind=d.kind.value,
                mime=d.mime,
                sha256=d.sha256,
                storage_key=d.storage_key,
            )
            for d in profile.documents
        ],
        declared={
            "organisation": profile.organisation or "",
            "course_year": str(profile.course_year or ""),
            **{f"{d.kind.value}_masked": d.number_masked or "" for d in profile.documents},
        },
    )

    try:
        decision = provider.submit(submission)
    except Exception as exc:  # noqa: BLE001 — a vendor outage must not lose the application
        logger.error("kyc_provider_failed", profile_id=profile.id, error=str(exc)[:200])
        decision = KycDecision(status=KycStatus.SUBMITTED, provider=provider.key)

    profile.submitted_at = utcnow()
    return apply_decision(db, profile, decision, actor_id=None)


# --------------------------------------------------------------------------- #
# Deciding — one write path
# --------------------------------------------------------------------------- #
def apply_decision(
    db: Session,
    profile: ContributorProfile,
    decision: KycDecision,
    *,
    actor_id: int | None,
    badge: bool = True,
    expires_months: int = DEFAULT_VALIDITY_MONTHS,
) -> ContributorProfile:
    """Write a verdict, whoever reached it.

    The manual Approve button and a vendor webhook both come through here, so
    granting the role, stamping the expiry and recording the reviewer happen in
    exactly one place and cannot drift apart.
    """
    profile.kyc_status = decision.status
    profile.provider = decision.provider
    profile.provider_ref = decision.provider_ref or profile.provider_ref
    if decision.reason_te or decision.reason_en:
        profile.review_note = (decision.reason_te or decision.reason_en or "")[:500]

    if decision.status in (KycStatus.APPROVED, KycStatus.REJECTED, KycStatus.MORE_INFO):
        profile.reviewed_at = utcnow()
        profile.reviewed_by = actor_id

    if decision.status == KycStatus.APPROVED:
        profile.verified_badge = badge
        profile.expires_at = utcnow() + timedelta(days=30 * max(1, expires_months))
        _grant_contributor_role(db, profile.user_id, granted_by=actor_id)
    else:
        profile.verified_badge = False

    db.flush()
    logger.info(
        "kyc_decision",
        profile_id=profile.id,
        status=decision.status.value,
        provider=decision.provider,
        automated=decision.automated,
    )
    return profile


def _grant_contributor_role(db: Session, user_id: int, *, granted_by: int | None) -> None:
    """Give this reader the contributor role, and nothing else.

    There is no general role-assignment API in this codebase — roles come from
    seeds. This is deliberately the narrowest possible exception: one role, one
    scope, one trigger. It is not a foothold for a role editor.
    """
    role = db.scalar(select(Role).where(Role.key == RoleKey.CONTRIBUTOR.value))
    if role is None:
        logger.error("contributor_role_missing")
        return
    existing = db.scalar(
        select(UserRole).where(
            UserRole.user_id == user_id, UserRole.role_id == role.id
        )
    )
    if existing is not None:
        return
    from app.models.enums import ScopeType

    db.add(
        UserRole(
            user_id=user_id,
            role_id=role.id,
            scope_type=ScopeType.SELF,
            granted_by=granted_by,
        )
    )
    db.flush()


def get_profile(db: Session, profile_id: int) -> ContributorProfile:
    profile = db.scalar(
        select(ContributorProfile)
        .options(selectinload(ContributorProfile.documents))
        .where(ContributorProfile.id == profile_id)
    )
    if profile is None:
        raise NotFoundError()
    return profile


def queue(
    db: Session,
    *,
    status: KycStatus | None = None,
    contributor_type: ContributorType | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[ContributorProfile], int]:
    from sqlalchemy import func

    stmt = select(ContributorProfile).options(
        selectinload(ContributorProfile.documents)
    )
    if status is not None:
        stmt = stmt.where(ContributorProfile.kyc_status == status)
    if contributor_type is not None:
        stmt = stmt.where(ContributorProfile.contributor_type == contributor_type)
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = list(
        db.scalars(
            stmt.order_by(ContributorProfile.submitted_at.desc().nullslast())
            .offset(offset)
            .limit(limit)
        ).all()
    )
    return rows, total


def purge_expired(db: Session) -> int:
    """Delete document files whose retention window has passed.

    Rejected applications after 90 days, approved ones after their validity
    expires. Keeping somebody's passport scan forever because nobody wrote this
    function is the failure it exists to prevent.
    """
    from app.integrations.storage import get_private_storage

    cutoff = utcnow() - timedelta(days=90)
    profiles = db.scalars(
        select(ContributorProfile)
        .options(selectinload(ContributorProfile.documents))
        .where(
            (
                (ContributorProfile.kyc_status == KycStatus.REJECTED)
                & (ContributorProfile.reviewed_at < cutoff)
            )
            | (
                (ContributorProfile.kyc_status == KycStatus.APPROVED)
                & (ContributorProfile.expires_at < utcnow())
            )
        )
    ).all()

    storage = get_private_storage()
    purged = 0
    for profile in profiles:
        for document in list(profile.documents):
            if not document.storage_key:
                continue
            try:
                storage.delete(document.storage_key)
            except Exception as exc:  # noqa: BLE001 — a stuck object must not stop the sweep
                logger.warning("kyc_purge_failed", key=document.storage_key, error=str(exc)[:120])
            db.delete(document)
            purged += 1
        if profile.kyc_status == KycStatus.APPROVED:
            profile.kyc_status = KycStatus.EXPIRED
            profile.verified_badge = False
    db.flush()
    if purged:
        logger.info("kyc_documents_purged", count=purged)
    return purged
