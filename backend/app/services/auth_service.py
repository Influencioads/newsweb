"""Authentication: password login, phone OTP, TOTP 2FA, refresh rotation, sessions.

Every rule in §6.2 is implemented here, in the service layer:

  * bcrypt(12) / argon2id — never MD5/SHA
  * 5 login attempts / 15 min / IP+identifier, then a 30-minute lockout
  * max 3 concurrent staff sessions; a new login evicts the oldest
  * refresh tokens rotate on every use, and reuse of a rotated token is treated
    as theft and kills the session
  * every staff login writes to audit_log
  * password reset links single-use, 15-minute expiry
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.errors import (
    AccountInactiveError,
    AccountLockedError,
    InvalidCredentialsError,
    InvalidOtpError,
    RateLimitedError,
    SessionRevokedError,
    TwoFactorRequiredError,
    UnauthorizedError,
)
from app.core.logging import get_logger
from app.core.redis_client import delete as redis_delete
from app.core.redis_client import get_int, get_redis, incr_with_ttl
from app.db.base import utcnow
from app.models.enums import AuditAction, SessionPlatform, UserStatus
from app.models.user import User, UserSession
from app.services import audit_service
from app.services.session_registry import (
    active_session_keys,
    find_retired_session,
    register_session,
    retire_refresh_hash,
    revoke_all_for_user,
    revoke_session,
)

logger = get_logger(__name__)

_OTP_PREFIX = "otp:"
_ATTEMPT_PREFIX = "login-attempt:"
_RESET_PREFIX = "pwreset:"


# --------------------------------------------------------------------------- #
# Rate limiting / lockout (§6.2)
# --------------------------------------------------------------------------- #
def _attempt_key(identifier: str, ip: str | None) -> str:
    return f"{_ATTEMPT_PREFIX}{identifier.lower()}:{ip or 'unknown'}"


def check_login_allowed(identifier: str, ip: str | None) -> None:
    attempts = get_int(_attempt_key(identifier, ip))
    if attempts >= settings.LOGIN_MAX_ATTEMPTS:
        raise AccountLockedError(
            details={
                "attempts": attempts,
                "lockout_minutes": settings.LOGIN_LOCKOUT_MINUTES,
            }
        )


def register_failed_attempt(identifier: str, ip: str | None) -> int:
    key = _attempt_key(identifier, ip)
    count = incr_with_ttl(key, settings.LOGIN_ATTEMPT_WINDOW_MINUTES * 60)
    if count >= settings.LOGIN_MAX_ATTEMPTS:
        # Escalate the TTL from the 15-minute window to the 30-minute lockout.
        try:
            get_redis().expire(key, settings.LOGIN_LOCKOUT_MINUTES * 60)
        except Exception:  # noqa: BLE001 - lockout must not break the login path
            pass
    return count


def clear_failed_attempts(identifier: str, ip: str | None) -> None:
    redis_delete(_attempt_key(identifier, ip))


# --------------------------------------------------------------------------- #
# Lookup
# --------------------------------------------------------------------------- #
def get_user_by_email(db: Session, email: str) -> User | None:
    stmt = select(User).where(User.email == email.strip().lower(), User.deleted_at.is_(None))
    return db.execute(stmt).scalar_one_or_none()


def get_user_by_phone(db: Session, phone: str) -> User | None:
    stmt = select(User).where(User.phone == normalise_phone(phone), User.deleted_at.is_(None))
    return db.execute(stmt).scalar_one_or_none()


def normalise_phone(phone: str) -> str:
    """Store phones as digits only, with the Indian country code.

    Field staff type '9848012345', '09848012345', '+91 98480 12345' — all three
    must resolve to one account.
    """
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) == 10:
        return f"91{digits}"
    if len(digits) == 11 and digits.startswith("0"):
        return f"91{digits[1:]}"
    return digits


# --------------------------------------------------------------------------- #
# Sessions
# --------------------------------------------------------------------------- #
def _enforce_session_limit(db: Session, user: User) -> None:
    """§6.2: max 3 concurrent sessions for staff; a new login evicts the oldest."""
    if not any(ur.role and ur.role.is_staff for ur in user.roles):
        return

    # MySQL has no NULLS FIRST/LAST. `col IS NOT NULL` as a leading key sorts
    # NULLs first explicitly, rather than relying on engine default ordering.
    stmt = (
        select(UserSession)
        .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
        .order_by(
            UserSession.last_used_at.is_not(None),
            UserSession.last_used_at.asc(),
            UserSession.created_at.asc(),
        )
    )
    active = list(db.execute(stmt).scalars())
    excess = len(active) - (settings.MAX_CONCURRENT_STAFF_SESSIONS - 1)
    for session in active[: max(excess, 0)]:
        session.revoked_at = utcnow()
        session.revoked_reason = "session_limit"
        revoke_session(session.session_key, user.id)


def create_session(
    db: Session,
    user: User,
    *,
    platform: SessionPlatform = SessionPlatform.WEB,
    device_id: str | None = None,
    device_label: str | None = None,
    request: Request | None = None,
) -> tuple[UserSession, str, str, datetime]:
    """Create a session and mint its token pair.

    Returns (session, access_token, refresh_token_raw, access_expiry).
    """
    _enforce_session_limit(db, user)

    session_key = secrets.token_urlsafe(24)
    raw_refresh, refresh_hash, refresh_expires = security.create_refresh_token(
        user_id=user.id, session_key=session_key
    )

    ip = None
    user_agent = None
    if request is not None:
        forwarded = request.headers.get("x-forwarded-for")
        ip = (forwarded.split(",")[0].strip() if forwarded else
              (request.client.host if request.client else None))
        ip = ip[:45] if ip else None
        user_agent = request.headers.get("user-agent", "")[:400] or None

    session = UserSession(
        session_key=session_key,
        user_id=user.id,
        device_id=device_id,
        device_label=device_label,
        platform=platform,
        refresh_hash=refresh_hash,
        ip=ip,
        user_agent=user_agent,
        expires_at=refresh_expires,
        last_used_at=utcnow(),
    )
    db.add(session)
    db.flush()

    from app.core.deps import build_principal

    principal = build_principal(user, session_key)
    access_token, access_expires = security.create_access_token(
        user_id=user.id,
        session_key=session_key,
        permissions=sorted(principal.permissions),
        level=principal.level,
    )
    register_session(session_key, user.id, refresh_expires)

    user.last_login_at = utcnow()
    return session, access_token, raw_refresh, access_expires


def rotate_refresh_token(
    db: Session, raw_refresh: str, request: Request | None = None
) -> tuple[UserSession, str, str, datetime]:
    """Exchange a refresh token for a new pair, rotating the stored hash (§1).

    Reuse detection: the incoming token is looked up by hash. If it matches a
    session that is already revoked, the token was replayed after rotation —
    which means it leaked. Every session for that user is killed.
    """
    token_hash = security.hash_token(raw_refresh)
    stmt = select(UserSession).where(UserSession.refresh_hash == token_hash)
    session = db.execute(stmt).scalar_one_or_none()

    if session is None:
        # No live session holds this hash. Before calling it merely invalid,
        # check whether it is a *retired* hash — that means a real token was
        # rotated and is now being replayed, i.e. it leaked.
        retired_session_key = find_retired_session(token_hash)
        if retired_session_key:
            replayed = db.execute(
                select(UserSession).where(UserSession.session_key == retired_session_key)
            ).scalar_one_or_none()
            if replayed is not None:
                logger.error(
                    "refresh_token_reuse_detected",
                    user_id=replayed.user_id,
                    session_key=retired_session_key[:8],
                    reason="retired_hash_replayed",
                )
                revoke_all_user_sessions(db, replayed.user_id, reason="token_reuse")
                # Commit before raising. The request-scoped session rolls back on
                # exception, which would otherwise silently undo the revocation we
                # just made — leaving the stolen family alive. Security state must
                # survive the error it caused.
                db.commit()
                raise SessionRevokedError()
        raise UnauthorizedError()

    if session.revoked_at is not None:
        logger.error(
            "refresh_token_reuse_detected",
            user_id=session.user_id,
            session_key=session.session_key[:8],
            reason="revoked_session_replayed",
        )
        revoke_all_user_sessions(db, session.user_id, reason="token_reuse")
        db.commit()  # see the retired-hash branch above
        raise SessionRevokedError()

    if session.expires_at <= datetime.now(timezone.utc):
        session.revoked_at = utcnow()
        session.revoked_reason = "expired"
        revoke_session(session.session_key, session.user_id)
        db.commit()  # persist the revocation despite the raise
        raise SessionRevokedError()

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise AccountInactiveError()

    new_raw, new_hash, new_expires = security.create_refresh_token(
        user_id=user.id, session_key=session.session_key
    )
    # Retire the outgoing hash before overwriting it, so a replay is detectable.
    retire_refresh_hash(
        token_hash,
        session.session_key,
        settings.JWT_REFRESH_TTL_DAYS * 24 * 3600,
    )
    session.refresh_hash = new_hash
    session.expires_at = new_expires
    session.last_used_at = utcnow()

    from app.core.deps import build_principal

    principal = build_principal(user, session.session_key)
    access_token, access_expires = security.create_access_token(
        user_id=user.id,
        session_key=session.session_key,
        permissions=sorted(principal.permissions),
        level=principal.level,
    )
    # Re-register (not merely touch): the refresh token in hand proves this
    # session's validity from the durable MySQL row, so a registry that lost the
    # key — a Redis flush, or a dev-server restart on the local fallback — heals
    # here instead of force-logging-out every reader.
    register_session(session.session_key, user.id, new_expires)
    return session, access_token, new_raw, access_expires


def revoke_one_session(db: Session, session: UserSession, reason: str = "logout") -> None:
    session.revoked_at = utcnow()
    session.revoked_reason = reason
    revoke_session(session.session_key, session.user_id)


def revoke_all_user_sessions(db: Session, user_id: int, reason: str = "forced") -> int:
    stmt = select(UserSession).where(
        UserSession.user_id == user_id, UserSession.revoked_at.is_(None)
    )
    sessions = list(db.execute(stmt).scalars())
    now = utcnow()
    for s in sessions:
        s.revoked_at = now
        s.revoked_reason = reason
    revoke_all_for_user(user_id)
    return len(sessions)


def list_sessions(db: Session, user_id: int) -> list[UserSession]:
    stmt = (
        select(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        # NULLS LAST, spelled portably (see _enforce_session_limit).
        .order_by(UserSession.last_used_at.is_(None), UserSession.last_used_at.desc())
    )
    live = set(active_session_keys(user_id))
    return [s for s in db.execute(stmt).scalars() if not live or s.session_key in live]


# --------------------------------------------------------------------------- #
# Password login (desk staff, editors, admins)
# --------------------------------------------------------------------------- #
def authenticate_password(
    db: Session,
    email: str,
    password: str,
    totp_code: str | None,
    request: Request | None = None,
) -> User:
    """§6.2 — email + password + mandatory TOTP for desk staff and admins."""
    ip = _request_ip(request)
    identifier = email.strip().lower()
    check_login_allowed(identifier, ip)

    user = get_user_by_email(db, identifier)
    password_ok = security.verify_password(password, user.password_hash if user else None)

    if user is None or not password_ok:
        register_failed_attempt(identifier, ip)
        audit_service.record_auth_event(
            db,
            action=AuditAction.LOGIN_FAILED,
            user=user,
            identifier=identifier,
            note="bad_password",
            request=request,
        )
        # Same error whether the account exists or not — do not leak enumeration.
        raise InvalidCredentialsError()

    if user.status != UserStatus.ACTIVE:
        raise AccountInactiveError()
    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
        raise AccountLockedError()

    if user.two_factor_enabled:
        if not totp_code:
            raise TwoFactorRequiredError()
        secret = security.decrypt_secret(user.two_factor_secret) if user.two_factor_secret else ""
        if not security.verify_totp(secret, totp_code):
            register_failed_attempt(identifier, ip)
            audit_service.record_auth_event(
                db,
                action=AuditAction.LOGIN_FAILED,
                user=user,
                identifier=identifier,
                note="bad_totp",
                request=request,
            )
            raise InvalidCredentialsError(
                message_en="The two-factor code is incorrect.",
                message_te="రెండంచెల ధృవీకరణ కోడ్ తప్పు.",
            )

    # Upgrade a legacy/weaker hash transparently on successful login.
    if user.password_hash and security.needs_rehash(user.password_hash):
        user.password_hash = security.hash_password(password)

    clear_failed_attempts(identifier, ip)
    return user


# --------------------------------------------------------------------------- #
# OTP login (reporters, stringers, readers)
# --------------------------------------------------------------------------- #
# Redis holds OTPs. In development/test only, an in-process dict stands in when
# Redis is down — the same trade the session registry makes, so `docker compose`
# is not a prerequisite for local reader-login work. Never in production: the
# fallback neither survives a restart nor spans workers.
_local_otps: dict[str, tuple[str, datetime]] = {}


def _otp_fallback_allowed() -> bool:
    return settings.APP_ENV in {"development", "test"}


def _otp_store(normalised: str, otp: str) -> None:
    hashed = security.hash_otp(otp, normalised)
    try:
        get_redis().setex(f"{_OTP_PREFIX}{normalised}", settings.OTP_TTL_SECONDS, hashed)
    except Exception as exc:  # noqa: BLE001
        if not _otp_fallback_allowed():
            logger.error("otp_store_failed", error=str(exc))
            raise RateLimitedError() from exc
        logger.warning("otp_local_fallback", op="store", error=str(exc))
        _local_otps[normalised] = (
            hashed,
            datetime.now(timezone.utc) + timedelta(seconds=settings.OTP_TTL_SECONDS),
        )


def _otp_read(normalised: str) -> str | None:
    try:
        stored = get_redis().get(f"{_OTP_PREFIX}{normalised}")
        if stored:
            return stored
    except Exception as exc:  # noqa: BLE001
        if not _otp_fallback_allowed():
            logger.error("otp_read_failed", error=str(exc))
            raise InvalidOtpError() from exc
    if _otp_fallback_allowed():
        item = _local_otps.get(normalised)
        if item and item[1] > datetime.now(timezone.utc):
            return item[0]
    return None


def _otp_clear(normalised: str) -> None:
    _local_otps.pop(normalised, None)
    redis_delete(f"{_OTP_PREFIX}{normalised}")


def request_otp(db: Session, phone: str, request: Request | None = None) -> tuple[str, int]:
    """Issue an OTP. Returns (otp_or_empty, ttl_seconds).

    The OTP is only returned when OTP_DEV_ECHO is on, which `assert_production_safe`
    forbids in production.
    """
    ip = _request_ip(request)
    normalised = normalise_phone(phone)
    check_login_allowed(normalised, ip)

    user = get_user_by_phone(db, normalised)
    otp = security.generate_otp()

    # Always store and always answer identically, whether or not the number is
    # registered — otherwise this endpoint enumerates our reporters' numbers.
    _otp_store(normalised, otp)

    audit_service.record_auth_event(
        db,
        action=AuditAction.OTP_REQUESTED,
        user=user,
        identifier=normalised,
        request=request,
    )

    if user is not None:
        # TODO(phase-10): dispatch through the MSG91 adapter. Until then the code
        # is only available via OTP_DEV_ECHO in development.
        logger.info("otp_issued", phone_suffix=normalised[-4:], registered=True)
    else:
        logger.info("otp_requested_unknown_number", phone_suffix=normalised[-4:])

    return (otp if settings.OTP_DEV_ECHO else ""), settings.OTP_TTL_SECONDS


def _consume_valid_otp(
    db: Session, phone: str, otp: str, request: Request | None = None
) -> str:
    """Validate and burn an OTP; returns the normalised phone. Raises on failure."""
    ip = _request_ip(request)
    normalised = normalise_phone(phone)
    check_login_allowed(normalised, ip)

    stored = _otp_read(normalised)
    if not stored or not security.verify_otp(otp, normalised, stored):
        register_failed_attempt(normalised, ip)
        audit_service.record_auth_event(
            db,
            action=AuditAction.LOGIN_FAILED,
            user=get_user_by_phone(db, normalised),
            identifier=normalised,
            note="bad_otp",
            request=request,
        )
        raise InvalidOtpError()

    # Single use.
    _otp_clear(normalised)
    clear_failed_attempts(normalised, ip)
    return normalised


def verify_otp_login(
    db: Session, phone: str, otp: str, request: Request | None = None
) -> User:
    normalised = _consume_valid_otp(db, phone, otp, request)

    user = get_user_by_phone(db, normalised)
    if user is None:
        raise InvalidOtpError()
    if user.status != UserStatus.ACTIVE:
        raise AccountInactiveError()
    return user


def verify_otp_reader(
    db: Session, phone: str, otp: str, request: Request | None = None
) -> tuple[User, bool]:
    """Reader sign-in (updated doc §11): a valid OTP both authenticates an
    existing account and registers a new one — there is no separate signup form.

    Returns (user, is_new_account). A suspended reader still cannot enter.
    """
    normalised = _consume_valid_otp(db, phone, otp, request)

    user = get_user_by_phone(db, normalised)
    if user is not None:
        if user.status != UserStatus.ACTIVE:
            raise AccountInactiveError()
        return user, False

    from app.models.enums import RoleKey, ScopeType
    from app.models.user import Role, UserRole

    role = db.execute(
        select(Role).where(Role.key == RoleKey.SUBSCRIBER.value)
    ).scalar_one_or_none()
    if role is None:  # pragma: no cover — seeds always create it
        raise AccountInactiveError()

    display = f"రీడర్ {normalised[-4:]}"
    user = User(
        phone=normalised,
        name_te=display,
        name_en=f"Reader {normalised[-4:]}",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    db.flush()
    db.add(
        UserRole(
            user_id=user.id, role_id=role.id, scope_type=ScopeType.SELF, scope_id=None
        )
    )
    db.flush()
    # Reload so user.roles is populated for the principal build.
    db.refresh(user)
    logger.info("reader_registered", user_id=user.id, phone_suffix=normalised[-4:])
    return user, True


# --------------------------------------------------------------------------- #
# Password reset (§6.2 — single use, 15-minute expiry)
# --------------------------------------------------------------------------- #
def issue_password_reset(db: Session, email: str) -> str | None:
    user = get_user_by_email(db, email)
    if user is None:
        return None
    token = security.generate_token(32)
    try:
        get_redis().setex(
            f"{_RESET_PREFIX}{security.hash_token(token)}",
            settings.PASSWORD_RESET_TTL_MINUTES * 60,
            str(user.id),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("reset_token_store_failed", error=str(exc))
        return None
    return token


def consume_password_reset(db: Session, token: str, new_password: str) -> User:
    key = f"{_RESET_PREFIX}{security.hash_token(token)}"
    try:
        client = get_redis()
        raw = client.get(key)
        if raw:
            client.delete(key)  # single use
    except Exception as exc:  # noqa: BLE001
        raise UnauthorizedError() from exc

    if not raw:
        raise UnauthorizedError(
            message_en="This reset link is invalid or has expired.",
            message_te="ఈ లింక్ చెల్లదు లేదా గడువు ముగిసింది.",
        )

    user = db.get(User, int(raw))
    if user is None or not user.is_active:
        raise AccountInactiveError()

    user.password_hash = security.hash_password(new_password)
    user.password_changed_at = utcnow()
    # A password change signs out every other device.
    revoke_all_user_sessions(db, user.id, reason="password_changed")
    return user


def _request_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def otp_expiry() -> datetime:
    return utcnow() + timedelta(seconds=settings.OTP_TTL_SECONDS)
