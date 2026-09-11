"""Email and phone verification (updated doc §4).

Tokens live in Redis, hashed, single-use — the same shape as the existing
password-reset flow, for the same reasons: nothing verifiable is stored in the
database, and a leaked backup contains no usable link.

Verification is deliberately *not* a gate on reading. An unverified reader can
browse, follow and bookmark; verification is what unlocks submitting an article
(§6) and receiving email. Blocking the whole product on an SMTP round-trip
would be a worse failure than an unverified email address.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.errors import UnauthorizedError, ValidationError
from app.core.logging import get_logger
from app.core.redis_client import delete as redis_delete
from app.core.redis_client import get_redis
from app.db.base import utcnow
from app.integrations.messaging import email as email_sender
from app.models.user import User

logger = get_logger(__name__)

_EMAIL_PREFIX = "verify:email:"
_TTL_SECONDS = 24 * 60 * 60


def _store(token: str, user_id: int) -> bool:
    try:
        get_redis().setex(
            f"{_EMAIL_PREFIX}{security.hash_token(token)}", _TTL_SECONDS, str(user_id)
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("verification_store_failed", error=str(exc)[:200])
        return False


def send_email_verification(db: Session, user: User) -> str | None:
    """Issue and deliver a verification link. Returns the raw token only in
    development, mirroring OTP_DEV_ECHO, so tests and local work do not need a
    mailbox."""
    if not user.email:
        raise ValidationError(details={"email": "no email address on this account"})
    if user.email_verified_at is not None:
        return None

    token = security.generate_token(32)
    if not _store(token, user.id):
        return None

    link = f"{settings.APP_URL.rstrip('/')}/verify-email?token={token}"
    email_sender.send(
        user.email,
        subject="మీ ఖాతాను ధృవీకరించండి · Verify your account",
        body_text=(
            f"నమస్కారం {user.name_te},\n\n"
            f"మీ ఖాతాను ధృవీకరించడానికి ఈ లింక్‌ను తెరవండి:\n{link}\n\n"
            "ఈ లింక్ 24 గంటల్లో గడువు ముగుస్తుంది.\n\n"
            f"Hello {user.name_en},\n\nVerify your account: {link}\n"
            "This link expires in 24 hours."
        ),
    )
    logger.info("email_verification_sent", user_id=user.id)
    return token if settings.OTP_DEV_ECHO else None


def confirm_email(db: Session, token: str) -> User:
    key = f"{_EMAIL_PREFIX}{security.hash_token(token)}"
    try:
        client = get_redis()
        raw = client.get(key)
        if raw:
            client.delete(key)  # single use
    except Exception as exc:  # noqa: BLE001
        raise UnauthorizedError() from exc

    if not raw:
        raise UnauthorizedError(
            message_en="This verification link is invalid or has expired.",
            message_te="ఈ ధృవీకరణ లింక్ చెల్లదు లేదా గడువు ముగిసింది.",
        )

    user = db.get(User, int(raw))
    if user is None:
        raise UnauthorizedError()
    if user.email_verified_at is None:
        user.email_verified_at = utcnow()
        logger.info("email_verified", user_id=user.id)
    return user


def mark_phone_verified(user: User) -> None:
    """Completing an OTP *is* proof of the number — there is nothing further to
    ask, so the successful challenge records it."""
    if user.phone and user.phone_verified_at is None:
        user.phone_verified_at = utcnow()


def clear_pending(token: str) -> None:
    redis_delete(f"{_EMAIL_PREFIX}{security.hash_token(token)}")
