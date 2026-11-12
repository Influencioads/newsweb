"""Sign in with Google (app/services/google_auth_service).

    GET  /auth/google/start?target=cms|web|app&next=/path   -> Google
    GET  /auth/google/callback                              -> back to the site / app
    POST /auth/google/exchange {ticket}                     -> token pair
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.enums import AuditAction
from app.models.user import User
from app.schemas.auth import TokenPair
from app.schemas.reader import ReaderLoginResponse
from app.services import audit_service, auth_service
from app.services import google_auth_service as google
from app.services.google_auth_service import GoogleLoginError

router = APIRouter(prefix="/auth/google", tags=["auth"])

NONCE_COOKIE = "g_nonce"
COOKIE_PATH = "/api/v1/auth/google"


@router.get("/start", summary="Begin Google sign-in")
def start(
    target: str = Query("web", pattern="^(cms|web|app)$"),
    next: str | None = Query(None, max_length=300),
) -> RedirectResponse:
    try:
        url, nonce = google.start(target, next)
    except GoogleLoginError as err:
        return RedirectResponse(google.return_url(target, google._safe_next(target, next), error=err.reason), 302)
    response = RedirectResponse(url, 302)
    response.set_cookie(
        NONCE_COOKIE,
        nonce,
        max_age=google.STATE_TTL,
        httponly=True,
        secure=settings.SECURE_COOKIES,
        samesite="lax",
        path=COOKIE_PATH,
    )
    return response


@router.get("/callback", summary="Google sends the browser back here")
def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    target, next_path = "web", "/"
    try:
        if not state:
            raise GoogleLoginError("expired")
        data = google.read_state(state)
        target, next_path = str(data["t"]), str(data["n"])
        if error or not code:
            raise GoogleLoginError("cancelled")
        nonce = request.cookies.get(NONCE_COOKIE)
        if not nonce or nonce != data.get("nonce"):
            raise GoogleLoginError("expired")
        claims = google.exchange_code(code, nonce)
        user, is_new = google.find_or_create_user(db, target, claims)
        ticket = google.make_ticket(user, target, is_new)
        url = google.return_url(target, next_path, ticket=ticket)
    except GoogleLoginError as err:
        audit_service.record_auth_event(
            db,
            action=AuditAction.LOGIN_FAILED,
            user=None,
            identifier="google",
            note=f"google sign-in refused ({err.reason}), target {target}",
            request=request,
        )
        url = google.return_url(target, next_path, error=err.reason)
    response = RedirectResponse(url, 302)
    response.delete_cookie(NONCE_COOKIE, path=COOKIE_PATH)
    return response


@router.post("/exchange", response_model=ReaderLoginResponse, summary="Swap a Google sign-in ticket for tokens")
def exchange(
    request: Request,
    ticket: str = Body(..., embed=True, max_length=2000),
    device_label: str | None = Body(None, embed=True, max_length=120),
    db: Session = Depends(get_db),
) -> ReaderLoginResponse:
    user_id, target, is_new = google.redeem_ticket(ticket)
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise GoogleLoginError("account_disabled")
    # Checked again: the account may have been switched off in the last minute.
    google.find_or_create_user(db, target, {"email": user.email})
    session, access, refresh, expires = auth_service.create_session(
        db, user, platform=google.platform_for(target), device_label=device_label, request=request
    )
    audit_service.record_auth_event(
        db,
        action=AuditAction.LOGIN,
        user=user,
        identifier=user.email,
        note=f"google login ({target}){' (registered)' if is_new else ''}, session {session.session_key[:8]}",
        request=request,
    )
    from app.api.v1.auth import _me_payload
    from app.core.deps import build_principal

    return ReaderLoginResponse(
        tokens=TokenPair(access_token=access, refresh_token=refresh, expires_at=expires),
        me=_me_payload(build_principal(user, session.session_key)),
        is_new_account=is_new,
    )
