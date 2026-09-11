"""Reader profile endpoints (updated doc §11).

    GET   /users/me/preferences
    PATCH /users/me/preferences
    PATCH /users/me

Staff identity endpoints live under /auth; these routes are the reader-facing
account surface the web and the React Native app share. They require only a
valid session — a subscriber holds no permission keys at all.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, get_current_principal
from app.core.errors import ValidationError
from app.db.session import get_db
from app.models.enums import AuditAction
from app.models.geo import District, Locality, Mandal
from app.models.reader import UserPreference
from app.repositories import article_repo
from app.schemas.auth import UserOut
from app.schemas.public import DistrictOut, LocalityOut, MandalOut, StateOut
from app.schemas.reader import PreferencesOut, PreferencesPatch, ReaderProfilePatch
from app.services import audit_service

router = APIRouter(prefix="/users", tags=["users"])


def _get_or_create_prefs(db: Session, user_id: int) -> UserPreference:
    prefs = db.execute(
        select(UserPreference).where(UserPreference.user_id == user_id)
    ).scalar_one_or_none()
    if prefs is None:
        prefs = UserPreference(user_id=user_id)
        db.add(prefs)
        db.flush()
    return prefs


def _prefs_out(db: Session, prefs: UserPreference) -> PreferencesOut:
    state = (
        article_repo.get_state_by_code(db, prefs.state_code)
        if prefs.state_code
        else None
    )
    district = db.get(District, prefs.district_id) if prefs.district_id else None
    mandal = db.get(Mandal, prefs.mandal_id) if prefs.mandal_id else None
    locality = db.get(Locality, prefs.locality_id) if prefs.locality_id else None
    return PreferencesOut(
        language=prefs.language,
        state=StateOut.model_validate(state) if state else None,
        district=DistrictOut.model_validate(district) if district else None,
        mandal=MandalOut.model_validate(mandal) if mandal else None,
        locality=LocalityOut.model_validate(locality) if locality else None,
        category_slugs=list(prefs.category_slugs or []),
        notify_breaking=prefs.notify_breaking,
        notify_local=prefs.notify_local,
        notify_topics=prefs.notify_topics,
    )


@router.get(
    "/me/preferences", response_model=PreferencesOut, summary="My reading preferences"
)
def get_preferences(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> PreferencesOut:
    return _prefs_out(db, _get_or_create_prefs(db, principal.id))


@router.patch(
    "/me/preferences",
    response_model=PreferencesOut,
    summary="Update language, location and interests",
    description=(
        "Location is set by slug and validated against the hierarchy: a mandal "
        "must belong to the chosen district, a locality to the chosen mandal. "
        "Sending null for a level clears it and everything beneath it."
    ),
)
def update_preferences(
    payload: PreferencesPatch,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> PreferencesOut:
    prefs = _get_or_create_prefs(db, principal.id)
    changes = payload.model_dump(exclude_unset=True)

    if "language" in changes and changes["language"]:
        prefs.language = changes["language"]

    if "category_slugs" in changes:
        slugs = changes["category_slugs"] or []
        known = {c.slug for c in article_repo.nav_categories(db)}
        unknown = [s for s in slugs if s not in known]
        if unknown:
            raise ValidationError(details={"category_slugs": f"unknown: {unknown}"})
        prefs.category_slugs = slugs

    # --- location, top-down so each level validates against its parent -----
    if "state_code" in changes:
        if changes["state_code"] is None:
            prefs.state_code = None
            prefs.district_id = prefs.mandal_id = prefs.locality_id = None
        else:
            state = article_repo.get_state_by_code(db, changes["state_code"])
            if state is None:
                raise ValidationError(details={"state_code": "unknown state"})
            if prefs.state_code != state.code:
                prefs.district_id = prefs.mandal_id = prefs.locality_id = None
            prefs.state_code = state.code

    if "district_slug" in changes:
        if changes["district_slug"] is None:
            prefs.district_id = prefs.mandal_id = prefs.locality_id = None
        else:
            district = article_repo.get_district_by_slug(db, changes["district_slug"])
            if district is None:
                raise ValidationError(details={"district_slug": "unknown district"})
            if prefs.district_id != district.id:
                prefs.mandal_id = prefs.locality_id = None
            prefs.district_id = district.id
            prefs.state_code = district.state

    if "mandal_slug" in changes:
        if changes["mandal_slug"] is None:
            prefs.mandal_id = prefs.locality_id = None
        else:
            if prefs.district_id is None:
                raise ValidationError(details={"mandal_slug": "set a district first"})
            mandal = next(
                (
                    m
                    for m in article_repo.mandals_for_district(db, prefs.district_id)
                    if m.slug == changes["mandal_slug"]
                ),
                None,
            )
            if mandal is None:
                raise ValidationError(
                    details={"mandal_slug": "not in the chosen district"}
                )
            if prefs.mandal_id != mandal.id:
                prefs.locality_id = None
            prefs.mandal_id = mandal.id

    if "locality_slug" in changes:
        if changes["locality_slug"] is None:
            prefs.locality_id = None
        else:
            if prefs.mandal_id is None:
                raise ValidationError(details={"locality_slug": "set a mandal first"})
            locality = next(
                (
                    loc
                    for loc in article_repo.localities_for_mandal(db, prefs.mandal_id)
                    if loc.slug == changes["locality_slug"]
                ),
                None,
            )
            if locality is None:
                raise ValidationError(
                    details={"locality_slug": "not in the chosen mandal"}
                )
            prefs.locality_id = locality.id

    for flag in ("notify_breaking", "notify_local", "notify_topics"):
        if flag in changes and changes[flag] is not None:
            setattr(prefs, flag, changes[flag])

    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="user_preferences",
        entity_id=principal.id,
        actor=principal.user,
        after=changes,
        request=request,
    )
    return _prefs_out(db, prefs)


@router.patch("/me", response_model=UserOut, summary="Update my profile")
def update_profile(
    payload: ReaderProfilePatch,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> UserOut:
    from app.services import auth_service, verification_service

    changes = payload.model_dump(exclude_unset=True, exclude_none=True)

    if "email" in changes:
        address = str(changes["email"]).strip().lower()
        if principal.user.email and principal.user.email_verified_at is not None:
            # Changing a *verified* address is an account-takeover vector, so it
            # is not a profile edit — it needs the reset flow.
            raise ValidationError(
                message_en="Contact support to change a verified email address.",
                message_te="ధృవీకరించిన ఇమెయిల్ మార్చడానికి సపోర్ట్‌ను సంప్రదించండి.",
                details={"email": "already verified"},
            )
        existing = auth_service.get_user_by_email(db, address)
        if existing is not None and existing.id != principal.id:
            raise ValidationError(details={"email": "already registered"})
        changes["email"] = address
        principal.user.email_verified_at = None

    if "avatar_media_id" in changes:
        from app.models.media import Media

        media = db.get(Media, changes["avatar_media_id"])
        if media is None or media.deleted_at is not None:
            raise ValidationError(details={"avatar_media_id": "unknown image"})

    for field, value in changes.items():
        setattr(principal.user, field, value)
    if "email" in changes:
        verification_service.send_email_verification(db, principal.user)
    if changes:
        db.add(principal.user)
        audit_service.record(
            db,
            action=AuditAction.UPDATE,
            entity_type="user",
            entity_id=principal.id,
            actor=principal.user,
            after=changes,
            request=request,
        )
    return UserOut.model_validate(principal.user)


@router.post("/me/avatar", response_model=UserOut, summary="Upload my profile picture")
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> UserOut:
    """§5 profile image. Readers hold no `media.upload` permission — this is
    their own avatar, not the newsroom library, so the route is scoped to
    `/users/me` and the image is credited to them."""
    from app.core.config import settings
    from app.services import media_service

    raw = await file.read()
    media = media_service.create_image_media(
        db,
        raw=raw,
        filename=file.filename or "avatar",
        mime=file.content_type or "application/octet-stream",
        # A profile picture has no business being a 15 MB press photo.
        max_bytes=min(settings.UPLOAD_IMAGE_MAX_BYTES, 4 * 1024 * 1024),
        uploaded_by=principal.id,
        alt_te=principal.user.name_te,
        credit=principal.user.name_en,
        source_type="own",
    )
    principal.user.avatar_media_id = media.id
    audit_service.record(
        db,
        action=AuditAction.MEDIA_UPLOAD,
        entity_type="user",
        entity_id=principal.id,
        actor=principal.user,
        after={"avatar_media_id": media.id},
        request=request,
    )
    return UserOut.model_validate(principal.user)
