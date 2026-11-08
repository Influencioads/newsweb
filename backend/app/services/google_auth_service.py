"""Sign in with Google — one flow for the CMS, the website and the app.

    /auth/google/start?target=cms|web|app&next=/path
        -> Google's consent screen
    /auth/google/callback?code=...&state=...
        -> the code is exchanged for Google's id_token (server to server, with
           the client secret), the account is found or made, and the browser is
           sent back with a one-minute, one-use ticket
    POST /auth/google/exchange {ticket}
        -> the usual token pair, exactly like a password login

The ticket, not the tokens, travels in the URL: tokens never appear in a
browser history or an app deep link.

Who gets in:
  * target=cms — only an ACTIVE account that already holds a staff role and
    whose email is the Google address. The super admin adds staff in CMS →
    Users; nobody can make themselves staff by signing in.
  * target=web / app — readers. An unknown Google address gets a new reader
    (subscriber) account, as the phone OTP did before.
  * A disabled or suspended account never gets in.
"""

from __future__ import annotations

import secrets
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.models.enums import RoleKey, ScopeType, SessionPlatform, UserStatus
from app.models.user import Role, User, UserRole

logger = get_logger(__name__)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")

TARGETS = ("cms", "web", "app")
#: Roles that are readers, not newsroom staff.
READER_ROLES = frozenset(
    {RoleKey.SUBSCRIBER.value, RoleKey.CONTRIBUTOR.value, RoleKey.PANCHAYAT_SECRETARY.value}
)
#: Where the app is sent back to (mobile/app.json "scheme").
APP_RETURN = "wowindian://auth"

STATE_TTL = 600
TICKET_TTL = 60


class GoogleLoginError(AppError):
    """Sent back to the sign-in page as ?error=<reason>, never as a 500."""

    code = "GOOGLE_LOGIN_FAILED"
    status_code = 400
    message_en = "Google sign-in did not work. Please try again."
    message_te = "గూగుల్ సైన్-ఇన్ పూర్తి కాలేదు. మళ్లీ ప్రయత్నించండి."

    def __init__(self, reason: str) -> None:
        super().__init__(details={"reason": reason})
        self.reason = reason


# Every reason above, for the sign-in pages' messages:
# not_configured, expired, google_unreachable, google_refused,
# email_not_verified, account_disabled, not_staff


def redirect_uri() -> str:
    return f"{settings.API_URL.rstrip('/')}/api/v1/auth/google/callback"


def _safe_next(target: str, next_path: str | None) -> str:
    default = "/admin/dashboard" if target == "cms" else "/"
    # Only paths on this site: no //host, no scheme.
    if not next_path or not next_path.startswith("/") or next_path.startswith("//"):
        return default
    return next_path[:300]


def _sign(payload: dict[str, Any], ttl: int) -> str:
    now = int(time.time())
    return jwt.encode(
        {**payload, "iat": now, "exp": now + ttl}, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM
    )


def _read(token: str, typ: str) -> dict[str, Any]:
    try:
        data: dict[str, Any] = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError as err:
        raise GoogleLoginError("expired") from err
    if data.get("typ") != typ:
        raise GoogleLoginError("expired")
    return data


# --------------------------------------------------------------------------- #
# start
# --------------------------------------------------------------------------- #
def start(target: str, next_path: str | None) -> tuple[str, str]:
    """Return (Google URL, nonce). The nonce also goes in a cookie, so the
    callback only completes in the browser that started it."""
    if not settings.google_login_enabled:
        raise GoogleLoginError("not_configured")
    if target not in TARGETS:
        target = "web"
    nonce = secrets.token_urlsafe(16)
    state = _sign({"typ": "g_state", "t": target, "n": _safe_next(target, next_path), "nonce": nonce}, STATE_TTL)
    query = {
        "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "prompt": "select_account",
    }
    return f"{AUTH_URL}?{urlencode(query)}", nonce


def read_state(state: str) -> dict[str, Any]:
    return _read(state, "g_state")


# --------------------------------------------------------------------------- #
# callback
# --------------------------------------------------------------------------- #
def exchange_code(code: str, nonce: str) -> dict[str, Any]:
    """Swap the code for Google's id_token and return its verified claims.

    The id_token comes straight from Google's token endpoint over TLS in
    answer to our client secret, so (as Google's OpenID guide allows) its
    claims are checked here rather than its signature.
    """
    try:
        r = httpx.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                "redirect_uri": redirect_uri(),
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
    except httpx.HTTPError as err:
        raise GoogleLoginError("google_unreachable") from err
    if r.status_code != 200 or "id_token" not in r.json():
        logger.warning("google_token_exchange_failed", status=r.status_code, body=r.text[:200])
        raise GoogleLoginError("google_refused")
    claims: dict[str, Any] = jwt.decode(r.json()["id_token"], options={"verify_signature": False})
    if claims.get("aud") != settings.GOOGLE_OAUTH_CLIENT_ID or claims.get("iss") not in ISSUERS:
        raise GoogleLoginError("google_refused")
    if int(claims.get("exp", 0)) < time.time() or claims.get("nonce") != nonce:
        raise GoogleLoginError("expired")
    if not claims.get("email") or claims.get("email_verified") is not True:
        raise GoogleLoginError("email_not_verified")
    return claims


def _is_staff(user: User) -> bool:
    return any(ur.role is not None and ur.role.key not in READER_ROLES for ur in user.roles)


def find_or_create_user(db: Session, target: str, claims: dict[str, Any]) -> tuple[User, bool]:
    """(user, is_new) for this Google account, under the rules at the top."""
    email = str(claims["email"]).strip().lower()
    user = db.execute(
        select(User).where(User.email == email, User.deleted_at.is_(None))
    ).scalar_one_or_none()

    if user is not None and user.status != UserStatus.ACTIVE:
        raise GoogleLoginError("account_disabled")
    if target == "cms":
        if user is None or not _is_staff(user):
            raise GoogleLoginError("not_staff")
        return user, False
    if user is not None:
        if user.email_verified_at is None:
            user.email_verified_at = utcnow()
        return user, False

    role = db.execute(select(Role).where(Role.key == RoleKey.SUBSCRIBER.value)).scalar_one()
    name = str(claims.get("name") or email.split("@")[0])[:120]
    user = User(
        email=email,
        name_te=name,
        name_en=name,
        status=UserStatus.ACTIVE,
        email_verified_at=utcnow(),
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=role.id, scope_type=ScopeType.SELF, scope_id=None))
    db.flush()
    db.refresh(user)
    logger.info("reader_registered_google", user_id=user.id)
    return user, True


# --------------------------------------------------------------------------- #
# ticket
# --------------------------------------------------------------------------- #
_spent: dict[str, float] = {}


def make_ticket(user: User, target: str, is_new: bool) -> str:
    return _sign({"typ": "g_ticket", "sub": str(user.id), "t": target, "new": is_new, "jti": secrets.token_urlsafe(12)}, TICKET_TTL)


def redeem_ticket(ticket: str) -> tuple[int, str, bool]:
    """(user id, target, is_new) — each ticket works once."""
    data = _read(ticket, "g_ticket")
    jti = str(data.get("jti"))
    from app.core.redis_client import incr_with_ttl

    count = incr_with_ttl(f"g_ticket:{jti}", TICKET_TTL * 2)
    if count == 0:  # Redis unreachable: this process's memory instead.
        now = time.time()
        for key, until in list(_spent.items()):
            if until < now:
                _spent.pop(key, None)
        count = 2 if jti in _spent else 1
        _spent[jti] = now + TICKET_TTL * 2
    if count != 1:
        raise GoogleLoginError("expired")
    return int(data["sub"]), str(data.get("t", "web")), bool(data.get("new"))


def platform_for(target: str) -> SessionPlatform:
    return {"cms": SessionPlatform.CMS, "app": SessionPlatform.ANDROID}.get(target, SessionPlatform.WEB)


def return_url(target: str, next_path: str, *, ticket: str | None = None, error: str | None = None) -> str:
    """Where the browser goes after Google: the site's finishing page, or the app."""
    query = urlencode({k: v for k, v in {"ticket": ticket, "error": error, "next": next_path}.items() if v})
    if target == "app":
        return f"{APP_RETURN}?{query}"
    return f"{settings.APP_URL.rstrip('/')}/auth/google/done?{query}"
