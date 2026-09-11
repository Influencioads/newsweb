"""Auth routes (§13).

POST /auth/otp/request   POST /auth/otp/verify   POST /auth/login
POST /auth/refresh       POST /auth/logout       POST /auth/2fa/*
GET  /auth/me            GET  /auth/sessions     DELETE /auth/sessions/{id}
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import security
from app.core.deps import Principal, get_current_principal
from app.core.errors import NotFoundError, ValidationError
from app.db.session import get_db
from app.models.enums import AuditAction
from app.models.user import UserSession
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    MeOut,
    OtpRequestRequest,
    OtpRequestResponse,
    OtpVerifyRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequestRequest,
    RefreshRequest,
    RegisterRequest,
    RoleAssignmentOut,
    SessionOut,
    SimpleMessage,
    TokenPair,
    TwoFactorSetupConfirmRequest,
    TwoFactorSetupOut,
    UserOut,
    VerifyEmailRequest,
)
from app.schemas.reader import ReaderLoginResponse
from app.services import audit_service, auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _me_payload(principal: Principal) -> MeOut:
    return MeOut(
        user=UserOut.model_validate(principal.user),
        roles=[
            RoleAssignmentOut(
                role_key=a.role.key,
                role_label_te=a.role.label_te,
                role_label_en=a.role.label_en,
                level=a.role.level,
                scope_type=a.scope_type,
                scope_id=a.scope_id,
            )
            for a in principal.user.roles
            if a.role is not None
        ],
        permissions=sorted(principal.permissions),
        level=principal.level,
        is_global_scope=principal.is_global,
        district_ids=sorted(principal.district_ids),
        mandal_ids=sorted(principal.mandal_ids),
    )


# --------------------------------------------------------------------------- #
# Password login
# --------------------------------------------------------------------------- #
@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Sign in with email and password",
    description=(
        "Desk staff, editors and admins (§6.2). When the account has 2FA enabled, "
        "`totp_code` is mandatory and its absence returns `TWO_FACTOR_REQUIRED`.\n\n"
        "Rate limited to 5 attempts per 15 minutes per IP + identifier, followed by "
        "a 30-minute lockout. Every login — successful or not — is written to the "
        "audit log."
    ),
    responses={
        401: {"description": "INVALID_CREDENTIALS or TWO_FACTOR_REQUIRED"},
        403: {"description": "ACCOUNT_INACTIVE"},
        429: {"description": "ACCOUNT_LOCKED — too many failed attempts"},
    },
)
def login(
    payload: LoginRequest, request: Request, db: Session = Depends(get_db)
) -> LoginResponse:
    user = auth_service.authenticate_password(
        db, payload.email, payload.password, payload.totp_code, request
    )
    session, access, refresh, expires = auth_service.create_session(
        db,
        user,
        platform=payload.platform,
        device_id=payload.device_id,
        device_label=payload.device_label,
        request=request,
    )
    audit_service.record_auth_event(
        db,
        action=AuditAction.LOGIN,
        user=user,
        identifier=payload.email,
        note=f"password login, session {session.session_key[:8]}",
        request=request,
    )
    from app.core.deps import build_principal

    principal = build_principal(user, session.session_key)
    return LoginResponse(
        tokens=TokenPair(
            access_token=access, refresh_token=refresh, expires_at=expires
        ),
        me=_me_payload(principal),
    )


# --------------------------------------------------------------------------- #
# OTP login
# --------------------------------------------------------------------------- #
@router.post(
    "/otp/request",
    response_model=OtpRequestResponse,
    summary="Request a login OTP by phone",
    description=(
        "Reporters and stringers sign in by phone (§6.2) — many work from "
        "feature-phone-era habits and shared passwords are a real risk.\n\n"
        "The response is identical whether or not the number is registered, so this "
        "endpoint cannot be used to enumerate staff phone numbers."
    ),
    responses={429: {"description": "Too many requests"}},
)
def request_otp(
    payload: OtpRequestRequest, request: Request, db: Session = Depends(get_db)
) -> OtpRequestResponse:
    otp, ttl = auth_service.request_otp(db, payload.phone, request)
    return OtpRequestResponse(sent=True, expires_in_seconds=ttl, dev_otp=otp or None)


@router.post(
    "/otp/verify",
    response_model=LoginResponse,
    summary="Verify an OTP and sign in",
    description="Single-use. A verified code is deleted immediately.",
    responses={
        401: {"description": "INVALID_OTP"},
        429: {"description": "ACCOUNT_LOCKED"},
    },
)
def verify_otp(
    payload: OtpVerifyRequest, request: Request, db: Session = Depends(get_db)
) -> LoginResponse:
    user = auth_service.verify_otp_login(db, payload.phone, payload.otp, request)
    session, access, refresh, expires = auth_service.create_session(
        db,
        user,
        platform=payload.platform,
        device_id=payload.device_id,
        device_label=payload.device_label,
        request=request,
    )
    audit_service.record_auth_event(
        db,
        action=AuditAction.LOGIN,
        user=user,
        identifier=payload.phone,
        note=f"otp login, session {session.session_key[:8]}",
        request=request,
    )
    from app.core.deps import build_principal

    principal = build_principal(user, session.session_key)
    return LoginResponse(
        tokens=TokenPair(
            access_token=access, refresh_token=refresh, expires_at=expires
        ),
        me=_me_payload(principal),
    )


@router.post(
    "/reader/otp/verify",
    response_model=ReaderLoginResponse,
    summary="Reader sign-in: verify an OTP, registering on first use",
    description=(
        "The reader flow of the updated doc §11: request an OTP via "
        "`/auth/otp/request`, then verify here. A valid OTP for an unknown "
        "number **creates** a subscriber account — there is no separate signup "
        "form. Staff accounts sign in exactly as before via `/auth/otp/verify`."
    ),
    responses={
        401: {"description": "INVALID_OTP"},
        429: {"description": "ACCOUNT_LOCKED"},
    },
)
def verify_reader_otp(
    payload: OtpVerifyRequest, request: Request, db: Session = Depends(get_db)
) -> ReaderLoginResponse:
    user, is_new = auth_service.verify_otp_reader(
        db, payload.phone, payload.otp, request
    )
    session, access, refresh_token, expires = auth_service.create_session(
        db,
        user,
        platform=payload.platform,
        device_id=payload.device_id,
        device_label=payload.device_label,
        request=request,
    )
    audit_service.record_auth_event(
        db,
        action=AuditAction.LOGIN,
        user=user,
        identifier=payload.phone,
        note=f"reader otp login{' (registered)' if is_new else ''}, "
        f"session {session.session_key[:8]}",
        request=request,
    )
    from app.core.deps import build_principal

    principal = build_principal(user, session.session_key)
    return ReaderLoginResponse(
        tokens=TokenPair(
            access_token=access, refresh_token=refresh_token, expires_at=expires
        ),
        me=_me_payload(principal),
        is_new_account=is_new,
    )


# --------------------------------------------------------------------------- #
# Reader registration with email + password (updated doc §4)
# --------------------------------------------------------------------------- #
@router.post(
    "/register",
    response_model=ReaderLoginResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Reader signup with email and password",
    description=(
        "Creates a subscriber account and signs it in. Coexists with OTP "
        "sign-in: an account created here can add a phone later, and accounts "
        "created by OTP are untouched. A verification email is sent, but the "
        "account is usable immediately — verification gates submitting an "
        "article (§6), not reading."
    ),
    responses={
        400: {"description": "VALIDATION_ERROR — email or phone already registered"}
    },
)
def register(
    payload: RegisterRequest, request: Request, db: Session = Depends(get_db)
) -> ReaderLoginResponse:
    from app.services import verification_service

    user = auth_service.register_reader(
        db,
        email=payload.email,
        password=payload.password,
        name=payload.name,
        phone=payload.phone,
        request=request,
    )
    verification_service.send_email_verification(db, user)

    session, access, refresh_token, expires = auth_service.create_session(
        db,
        user,
        platform=payload.platform,
        device_id=payload.device_id,
        device_label=payload.device_label,
        request=request,
    )
    audit_service.record_auth_event(
        db,
        action=AuditAction.LOGIN,
        user=user,
        identifier=payload.email,
        note=f"reader registration, session {session.session_key[:8]}",
        request=request,
    )
    from app.core.deps import build_principal

    principal = build_principal(user, session.session_key)
    return ReaderLoginResponse(
        tokens=TokenPair(
            access_token=access, refresh_token=refresh_token, expires_at=expires
        ),
        me=_me_payload(principal),
        is_new_account=True,
    )


@router.post(
    "/verify-email",
    response_model=SimpleMessage,
    summary="Confirm an email address",
    responses={401: {"description": "UNAUTHORIZED — link invalid or expired"}},
)
def verify_email(
    payload: VerifyEmailRequest, db: Session = Depends(get_db)
) -> SimpleMessage:
    from app.services import verification_service

    verification_service.confirm_email(db, payload.token)
    return SimpleMessage(message="Email verified.")


@router.post(
    "/verify-email/resend",
    response_model=SimpleMessage,
    summary="Send the verification email again",
)
def resend_verification(
    db: Session = Depends(get_db), principal: Principal = Depends(get_current_principal)
) -> SimpleMessage:
    from app.services import verification_service

    verification_service.send_email_verification(db, principal.user)
    # Always the same answer, verified or not — this endpoint must not report
    # account state to anyone holding a stolen token.
    return SimpleMessage(
        message="If the address needs verifying, a link is on its way."
    )


@router.post(
    "/verify-phone",
    response_model=SimpleMessage,
    summary="Confirm the signed-in reader's phone number with an OTP",
    responses={401: {"description": "INVALID_OTP"}},
)
def verify_phone(
    payload: OtpVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> SimpleMessage:
    from app.services import verification_service

    # Reuses the OTP challenge rather than inventing a second one, so there is
    # a single code path for "prove you hold this number".
    user, _ = auth_service.verify_otp_reader(db, payload.phone, payload.otp, request)
    if user.id != principal.id:
        raise ValidationError(
            message_en="That number belongs to another account.",
            message_te="ఆ నంబర్ మరో ఖాతాకు చెందినది.",
        )
    verification_service.mark_phone_verified(user)
    return SimpleMessage(message="Phone verified.")


# --------------------------------------------------------------------------- #
# Refresh / logout
# --------------------------------------------------------------------------- #
@router.post(
    "/refresh",
    response_model=TokenPair,
    summary="Rotate the refresh token",
    description=(
        "Exchanges a refresh token for a new pair and **rotates** the stored token "
        "(§1). Replaying an already-rotated token is treated as theft: every "
        "session for that account is revoked and `SESSION_REVOKED` is returned."
    ),
    responses={401: {"description": "UNAUTHORIZED or SESSION_REVOKED"}},
)
def refresh(
    payload: RefreshRequest, request: Request, db: Session = Depends(get_db)
) -> TokenPair:
    _, access, new_refresh, expires = auth_service.rotate_refresh_token(
        db, payload.refresh_token, request
    )
    return TokenPair(access_token=access, refresh_token=new_refresh, expires_at=expires)


@router.post(
    "/logout",
    response_model=SimpleMessage,
    summary="Sign out",
    description="Revokes the current session, or every session when `all_devices` is true.",
)
def logout(
    payload: LogoutRequest,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> SimpleMessage:
    if payload.all_devices:
        count = auth_service.revoke_all_user_sessions(
            db, principal.id, reason="logout_all"
        )
        note = f"logout all devices ({count})"
    else:
        stmt = select(UserSession).where(
            UserSession.session_key == principal.session_key
        )
        session = db.execute(stmt).scalar_one_or_none()
        if session is not None:
            auth_service.revoke_one_session(db, session, reason="logout")
        note = "logout"

    audit_service.record_auth_event(
        db, action=AuditAction.LOGOUT, user=principal.user, note=note, request=request
    )
    return SimpleMessage(
        message_en="Signed out.",
        message_te="లాగ్ అవుట్ అయ్యారు.",
    )


# --------------------------------------------------------------------------- #
# Identity
# --------------------------------------------------------------------------- #
@router.get(
    "/me",
    response_model=MeOut,
    summary="Current user, roles, permissions and scope",
    description=(
        "The frontend uses `permissions` to decide which controls to render. The "
        "backend re-checks every one of them on the actual request — hiding a "
        "button is convenience, not security."
    ),
)
def me(principal: Principal = Depends(get_current_principal)) -> MeOut:
    return _me_payload(principal)


@router.get(
    "/sessions",
    response_model=list[SessionOut],
    summary="List active sessions for the current user",
    description="§6.2 — the profile lists every device with a 'log out this device' action.",
)
def list_sessions(
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> list[SessionOut]:
    sessions = auth_service.list_sessions(db, principal.id)
    out: list[SessionOut] = []
    for s in sessions:
        item = SessionOut.model_validate(s)
        item.is_current = s.session_key == principal.session_key
        out.append(item)
    return out


@router.delete(
    "/sessions/{session_id}",
    response_model=SimpleMessage,
    summary="Sign out one device",
    responses={404: {"description": "NOT_FOUND"}},
)
def revoke_session(
    session_id: int,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> SimpleMessage:
    session = db.get(UserSession, session_id)
    # Scoped to the caller's own sessions: revoking someone else's device requires
    # `user.revoke_session` on the users router, not this endpoint.
    if session is None or session.user_id != principal.id:
        raise NotFoundError()

    auth_service.revoke_one_session(db, session, reason="user_revoked")
    audit_service.record(
        db,
        action=AuditAction.SESSION_REVOKED,
        entity_type="session",
        entity_id=session.id,
        actor=principal.user,
        note="user revoked their own device",
        request=request,
    )
    return SimpleMessage(
        message_en="That device has been signed out.",
        message_te="ఆ పరికరం నుంచి లాగ్ అవుట్ చేయబడింది.",
    )


# --------------------------------------------------------------------------- #
# Password reset
# --------------------------------------------------------------------------- #
@router.post(
    "/password/reset-request",
    response_model=SimpleMessage,
    summary="Request a password reset link",
    description=(
        "Always answers success, whether or not the address is registered — the "
        "response must not reveal which emails exist. The link is single-use and "
        "expires in 15 minutes (§6.2)."
    ),
)
def request_password_reset(
    payload: PasswordResetRequestRequest, db: Session = Depends(get_db)
) -> SimpleMessage:
    token = auth_service.issue_password_reset(db, payload.email)
    if token:
        from app.core.config import settings as app_settings
        from app.integrations.messaging import email as email_sender

        link = f"{app_settings.APP_URL.rstrip('/')}/reset-password?token={token}"
        email_sender.send(
            payload.email,
            subject="పాస్‌వర్డ్ రీసెట్ · Reset your password",
            body_text=(
                f"పాస్‌వర్డ్ మార్చడానికి ఈ లింక్‌ను తెరవండి:\n{link}\n\n"
                "ఈ లింక్ 15 నిమిషాల్లో గడువు ముగుస్తుంది. మీరు అడగకపోతే "
                "ఈ సందేశాన్ని విస్మరించండి.\n\n"
                f"Reset your password: {link}\nThis link expires in 15 minutes."
            ),
        )
    return SimpleMessage(
        message_en="If that address is registered, a reset link has been sent.",
        message_te="ఆ చిరునామా నమోదై ఉంటే, రీసెట్ లింక్ పంపబడింది.",
    )


@router.post(
    "/password/reset",
    response_model=SimpleMessage,
    summary="Set a new password using a reset token",
    description="Consumes the token and signs the account out of every device.",
    responses={401: {"description": "Invalid or expired token"}},
)
def confirm_password_reset(
    payload: PasswordResetConfirmRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> SimpleMessage:
    user = auth_service.consume_password_reset(db, payload.token, payload.new_password)
    audit_service.record_auth_event(
        db,
        action=AuditAction.PASSWORD_CHANGED,
        user=user,
        note="via reset link",
        request=request,
    )
    return SimpleMessage(
        message_en="Password updated. Please sign in again.",
        message_te="పాస్‌వర్డ్ మార్చబడింది. మళ్లీ లాగిన్ అవ్వండి.",
    )


# --------------------------------------------------------------------------- #
# Two-factor
# --------------------------------------------------------------------------- #
@router.post(
    "/2fa/setup",
    response_model=TwoFactorSetupOut,
    summary="Begin TOTP enrolment",
    description=(
        "Returns the secret and an `otpauth://` URI for the QR code. 2FA is not "
        "active until `/2fa/verify` confirms a code, so a failed enrolment cannot "
        "lock the user out."
    ),
)
def setup_two_factor(
    principal: Principal = Depends(get_current_principal), db: Session = Depends(get_db)
) -> TwoFactorSetupOut:
    secret = security.generate_totp_secret()
    principal.user.two_factor_secret = security.encrypt_secret(secret)
    principal.user.two_factor_enabled = False
    account = principal.user.email or principal.user.phone or f"user-{principal.id}"
    return TwoFactorSetupOut(
        secret=secret, provisioning_uri=security.totp_provisioning_uri(secret, account)
    )


@router.post(
    "/2fa/verify",
    response_model=SimpleMessage,
    summary="Confirm TOTP enrolment",
    status_code=status.HTTP_200_OK,
    responses={422: {"description": "The code did not verify"}},
)
def verify_two_factor(
    payload: TwoFactorSetupConfirmRequest,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> SimpleMessage:
    if not principal.user.two_factor_secret:
        raise ValidationError(
            message_en="Start two-factor setup first.",
            message_te="ముందుగా రెండంచెల ధృవీకరణ సెటప్ ప్రారంభించండి.",
        )
    secret = security.decrypt_secret(principal.user.two_factor_secret)
    if not security.verify_totp(secret, payload.totp_code):
        raise ValidationError(
            message_en="That code is not valid. Check your authenticator app.",
            message_te="ఆ కోడ్ చెల్లదు. మీ ఆథెంటికేటర్ యాప్ చూడండి.",
        )

    principal.user.two_factor_enabled = True
    audit_service.record(
        db,
        action=AuditAction.TWO_FACTOR_ENABLED,
        entity_type="user",
        entity_id=principal.id,
        actor=principal.user,
        request=request,
    )
    return SimpleMessage(
        message_en="Two-factor authentication is now enabled.",
        message_te="రెండంచెల ధృవీకరణ ఇప్పుడు అమల్లోకి వచ్చింది.",
    )
