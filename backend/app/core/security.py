"""Cryptographic primitives: password hashing, JWTs, OTP, TOTP, at-rest encryption.

§6.2: argon2id or bcrypt(12). Never MD5/SHA.
§1:   JWT access 15 min + rotating refresh 30 d, with a Redis session registry so
      a reporter who leaves can be force-logged-out.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings
from app.core.errors import TokenExpiredError, UnauthorizedError

# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #
# argon2id with OWASP-recommended parameters. bcrypt stays supported so an
# imported legacy hash still verifies and can be re-hashed on next login.
_argon2 = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4, hash_len=32, salt_len=16)


def hash_password(password: str) -> str:
    if settings.PASSWORD_HASH_SCHEME == "bcrypt":
        import bcrypt

        return bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)
        ).decode("utf-8")
    return _argon2.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """Constant-time-ish verification that never raises on a malformed hash."""
    if not password_hash:
        # Still burn comparable time so a missing-password account is not
        # distinguishable by response latency.
        _argon2.hash(password)
        return False
    try:
        if password_hash.startswith("$argon2"):
            _argon2.verify(password_hash, password)
            return True
        if password_hash.startswith(("$2a$", "$2b$", "$2y$")):
            import bcrypt

            return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (VerifyMismatchError, VerificationError, InvalidHashError, ValueError):
        return False
    return False


def needs_rehash(password_hash: str) -> bool:
    if settings.PASSWORD_HASH_SCHEME != "argon2":
        return False
    if not password_hash.startswith("$argon2"):
        return True
    try:
        return _argon2.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


# --------------------------------------------------------------------------- #
# Opaque tokens (refresh tokens, reset links)
# --------------------------------------------------------------------------- #
def generate_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    """Hash an opaque token for storage.

    SHA-256 with a secret pepper rather than argon2: refresh tokens are verified
    on every token refresh and are already 256 bits of entropy, so a slow KDF
    buys nothing and costs latency on a hot path. The pepper means a leaked
    database alone does not allow token lookup.
    """
    return hmac.new(
        settings.JWT_REFRESH_SECRET.encode("utf-8"), token.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def verify_token_hash(token: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_token(token), stored_hash)


# --------------------------------------------------------------------------- #
# JWT
# --------------------------------------------------------------------------- #
TokenType = Literal["access", "refresh"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(
    *,
    user_id: int,
    session_key: str,
    permissions: list[str],
    level: int,
    extra: dict[str, Any] | None = None,
) -> tuple[str, datetime]:
    """Mint a short-lived access token.

    Permissions are embedded to avoid a database round trip per request, which is
    what keeps the API inside the §12.2 p95 < 300 ms budget. The trade-off is that
    a permission change takes up to `JWT_ACCESS_TTL_MINUTES` to propagate — 15
    minutes — while *revocation* is immediate because `sid` is checked against
    the Redis session registry on every request.
    """
    expires = _now() + timedelta(minutes=settings.JWT_ACCESS_TTL_MINUTES)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "sid": session_key,
        "typ": "access",
        "perms": permissions,
        "lvl": level,
        "iat": int(_now().timestamp()),
        "exp": int(expires.timestamp()),
        # `iat`/`exp` are whole seconds, so two tokens minted for the same session
        # inside one second would otherwise be byte-identical. `jti` guarantees
        # every issued token is distinct and gives us a handle for denylisting.
        "jti": secrets.token_urlsafe(8),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM), expires


def create_refresh_token(*, user_id: int, session_key: str) -> tuple[str, str, datetime]:
    """Return (raw_token, storage_hash, expiry).

    The raw token goes to the client exactly once; only the hash is persisted.
    """
    raw = generate_token(32)
    expires = _now() + timedelta(days=settings.JWT_REFRESH_TTL_DAYS)
    return raw, hash_token(raw), expires


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            options={"require": ["exp", "sub", "sid"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpiredError() from exc
    except jwt.InvalidTokenError as exc:
        raise UnauthorizedError() from exc

    if payload.get("typ") != "access":
        # A refresh token must never be usable as an access token.
        raise UnauthorizedError()
    return payload


# --------------------------------------------------------------------------- #
# OTP (§6.2 — phone login for field staff)
# --------------------------------------------------------------------------- #
def generate_otp(length: int | None = None) -> str:
    n = length or settings.OTP_LENGTH
    return "".join(secrets.choice("0123456789") for _ in range(n))


def hash_otp(otp: str, identifier: str) -> str:
    """Bind the OTP hash to the identifier so a code issued for one phone cannot
    be replayed against another."""
    return hmac.new(
        settings.JWT_SECRET.encode("utf-8"), f"{identifier}:{otp}".encode(), hashlib.sha256
    ).hexdigest()


def verify_otp(otp: str, identifier: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_otp(otp, identifier), stored_hash)


# --------------------------------------------------------------------------- #
# TOTP 2FA (§6.2 — mandatory for desk staff and admins)
# --------------------------------------------------------------------------- #
def generate_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, account: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account, issuer_name=settings.APP_NAME)


def verify_totp(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    # valid_window=1 tolerates one 30 s step of clock drift on the operator's phone.
    return pyotp.TOTP(secret).verify(code.strip().replace(" ", ""), valid_window=1)


# --------------------------------------------------------------------------- #
# At-rest encryption (§7.1 — AI provider keys, TOTP secrets)
# --------------------------------------------------------------------------- #
def _fernet() -> Fernet:
    key = settings.ENCRYPTION_KEY
    if not key:
        raise RuntimeError("ENCRYPTION_KEY is not set; cannot encrypt secrets at rest")
    # Accept either a Fernet key or any 32-byte secret, normalising to urlsafe b64.
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except (ValueError, TypeError):
        digest = hashlib.sha256(key.encode("utf-8")).digest()
        return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Could not decrypt secret — has ENCRYPTION_KEY changed?") from exc
