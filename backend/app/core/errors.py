"""Uniform error shape for the whole API.

Build Instructions §13 and brief §29 fix the wire format exactly:

    {
      "error": {
        "code": "ARTICLE_NOT_APPROVED",
        "message_en": "...",
        "message_te": "...",
        "details": {}
      }
    }

Every error the client can see is declared here with both languages. A raw Python
exception must never reach a user (brief §36) — `register_exception_handlers`
guarantees that by catching the base Exception as a last resort.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

logger = get_logger(__name__)


class AppError(Exception):
    """Base class for every error the API deliberately returns.

    Subclasses set `code`, `status_code`, and the two message strings. Telugu
    messages are mandatory: this is a Telugu-first product and an English-only
    error is a broken error (§4.6, brief §49).
    """

    code: str = "INTERNAL_ERROR"
    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    message_en: str = "Something went wrong."
    message_te: str = "ఏదో పొరపాటు జరిగింది."

    def __init__(
        self,
        message_en: str | None = None,
        message_te: str | None = None,
        details: dict[str, Any] | None = None,
        *,
        status_code: int | None = None,
    ) -> None:
        self.message_en = message_en or self.message_en
        self.message_te = message_te or self.message_te
        self.details = details or {}
        if status_code is not None:
            self.status_code = status_code
        super().__init__(self.message_en)

    def to_payload(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message_en": self.message_en,
                "message_te": self.message_te,
                "details": self.details,
            }
        }


# --------------------------------------------------------------------------- #
# 4xx — client
# --------------------------------------------------------------------------- #
class ValidationError(AppError):
    code = "VALIDATION_ERROR"
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    message_en = "The submitted data is not valid."
    message_te = "సమర్పించిన సమాచారం సరైనది కాదు."


class NotFoundError(AppError):
    code = "NOT_FOUND"
    status_code = status.HTTP_404_NOT_FOUND
    message_en = "The requested resource was not found."
    message_te = "అభ్యర్థించిన సమాచారం కనిపించలేదు."


class ConflictError(AppError):
    code = "CONFLICT"
    status_code = status.HTTP_409_CONFLICT
    message_en = "The request conflicts with the current state."
    message_te = "ప్రస్తుత స్థితితో ఈ అభ్యర్థన విరుద్ధంగా ఉంది."


# --- auth (§6.2) ----------------------------------------------------------- #
class UnauthorizedError(AppError):
    code = "UNAUTHORIZED"
    status_code = status.HTTP_401_UNAUTHORIZED
    message_en = "Authentication is required."
    message_te = "లాగిన్ అవసరం."


class InvalidCredentialsError(AppError):
    code = "INVALID_CREDENTIALS"
    status_code = status.HTTP_401_UNAUTHORIZED
    message_en = "The credentials provided are incorrect."
    message_te = "ఇచ్చిన వివరాలు సరైనవి కావు."


class TokenExpiredError(AppError):
    code = "TOKEN_EXPIRED"
    status_code = status.HTTP_401_UNAUTHORIZED
    message_en = "The session has expired. Please sign in again."
    message_te = "సెషన్ ముగిసింది. మళ్లీ లాగిన్ అవ్వండి."


class SessionRevokedError(AppError):
    code = "SESSION_REVOKED"
    status_code = status.HTTP_401_UNAUTHORIZED
    message_en = "This session has been signed out."
    message_te = "ఈ సెషన్ నుంచి లాగ్ అవుట్ చేయబడింది."


class AccountInactiveError(AppError):
    code = "ACCOUNT_INACTIVE"
    status_code = status.HTTP_403_FORBIDDEN
    message_en = "This account is not active."
    message_te = "ఈ ఖాతా ప్రస్తుతం చురుకుగా లేదు."


class TwoFactorRequiredError(AppError):
    code = "TWO_FACTOR_REQUIRED"
    status_code = status.HTTP_401_UNAUTHORIZED
    message_en = "A two-factor code is required for this account."
    message_te = "ఈ ఖాతాకు రెండంచెల ధృవీకరణ కోడ్ అవసరం."


class InvalidOtpError(AppError):
    code = "INVALID_OTP"
    status_code = status.HTTP_401_UNAUTHORIZED
    message_en = "The code is incorrect or has expired."
    message_te = "కోడ్ తప్పు లేదా గడువు ముగిసింది."


class RateLimitedError(AppError):
    code = "RATE_LIMITED"
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    message_en = "Too many attempts. Please try again later."
    message_te = "చాలా ప్రయత్నాలు జరిగాయి. కొద్దిసేపటి తర్వాత ప్రయత్నించండి."


class AccountLockedError(AppError):
    code = "ACCOUNT_LOCKED"
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    message_en = "Too many failed attempts. This account is locked temporarily."
    message_te = "పలుమార్లు విఫలమయ్యారు. ఖాతా తాత్కాలికంగా లాక్ చేయబడింది."


# --- permissions (§6.1, §7 district scoping) ------------------------------- #
class PermissionDeniedError(AppError):
    code = "PERMISSION_DENIED"
    status_code = status.HTTP_403_FORBIDDEN
    message_en = "You do not have permission to perform this action."
    message_te = "ఈ చర్యకు మీకు అనుమతి లేదు."


class ScopeDeniedError(AppError):
    code = "SCOPE_DENIED"
    status_code = status.HTTP_403_FORBIDDEN
    message_en = "This content is outside your assigned area."
    message_te = "ఈ కథనం మీకు కేటాయించిన ప్రాంతం పరిధిలో లేదు."


# --- workflow (§6.3, brief §10/§11) ---------------------------------------- #
class InvalidTransitionError(AppError):
    code = "INVALID_TRANSITION"
    status_code = status.HTTP_409_CONFLICT
    message_en = "That status change is not allowed from the current state."
    message_te = "ప్రస్తుత స్థితి నుంచి ఈ మార్పు అనుమతించబడదు."


class ArticleNotApprovedError(AppError):
    """The rule that overrides everything (§0). Nothing publishes without approval."""

    code = "ARTICLE_NOT_APPROVED"
    status_code = status.HTTP_409_CONFLICT
    message_en = "Article cannot be published before approval."
    message_te = "ఆమోదం లేకుండా కథనాన్ని ప్రచురించలేరు."


class SelfApprovalDeniedError(AppError):
    """§6.3 — a second senior must approve. Blocked even for editor_in_chief."""

    code = "SELF_APPROVAL_DENIED"
    status_code = status.HTTP_403_FORBIDDEN
    message_en = (
        "You cannot approve your own article. A second senior editor must approve it."
    )
    message_te = "మీ సొంత కథనాన్ని మీరే ఆమోదించలేరు. మరో సీనియర్ ఎడిటర్ ఆమోదించాలి."


class BreakingNewsAuthorityError(AppError):
    """§6.3 — is_breaking requires role level >= 80."""

    code = "BREAKING_REQUIRES_SENIOR"
    status_code = status.HTTP_403_FORBIDDEN
    message_en = "Breaking news requires editor-in-chief level approval."
    message_te = "బ్రేకింగ్ న్యూస్‌కు ఎడిటర్-ఇన్-చీఫ్ స్థాయి ఆమోదం అవసరం."


class SourceCreditRequiredError(AppError):
    """§12.5 — agency copy cannot publish without a credit."""

    code = "SOURCE_CREDIT_REQUIRED"
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    message_en = "Agency copy cannot be published without a source credit."
    message_te = "ఏజెన్సీ కథనాన్ని మూల ప్రస్తావన లేకుండా ప్రచురించలేరు."


# --- AI (§7) --------------------------------------------------------------- #
class AiBudgetExceededError(AppError):
    code = "AI_BUDGET_EXCEEDED"
    status_code = status.HTTP_402_PAYMENT_REQUIRED
    message_en = "The monthly AI budget has been reached for non-critical tasks."
    message_te = "ఈ నెల AI బడ్జెట్ పరిమితి పూర్తయింది."


class AiQuotaExceededError(AppError):
    code = "AI_QUOTA_EXCEEDED"
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    message_en = "You have used your AI requests for today."
    message_te = "ఈ రోజుకు మీ AI వినియోగ పరిమితి పూర్తయింది."


class AiSensitiveTopicError(AppError):
    """§7.2 — caste, religion, communal, sexual assault, suicide, minors."""

    code = "AI_REQUIRES_HUMAN_ONLY"
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    message_en = "This topic must be written by a human journalist."
    message_te = "ఈ అంశాన్ని జర్నలిస్ట్ స్వయంగా రాయాలి."


class AiSimilarityBlockedError(AppError):
    """§7.2 — block submission at >85% similarity to our own last 90 days."""

    code = "AI_SIMILARITY_BLOCKED"
    status_code = status.HTTP_409_CONFLICT
    message_en = "This draft is too similar to an existing article."
    message_te = "ఈ డ్రాఫ్ట్ ఇప్పటికే ఉన్న కథనానికి చాలా దగ్గరగా ఉంది."


class AiProviderError(AppError):
    code = "AI_PROVIDER_ERROR"
    status_code = status.HTTP_502_BAD_GATEWAY
    message_en = "The AI service is unavailable right now."
    message_te = "AI సేవ ప్రస్తుతం అందుబాటులో లేదు."


# --- media / storage (§12.1) ----------------------------------------------- #
class UnsupportedMediaTypeError(AppError):
    code = "UNSUPPORTED_MEDIA_TYPE"
    status_code = status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
    message_en = "That file type is not allowed."
    message_te = "ఆ ఫైల్ రకం అనుమతించబడదు."


class FileTooLargeError(AppError):
    code = "FILE_TOO_LARGE"
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    message_en = "The file is larger than the allowed limit."
    message_te = "ఫైల్ పరిమాణం అనుమతించిన పరిమితి కంటే ఎక్కువ."


class StorageError(AppError):
    code = "STORAGE_ERROR"
    status_code = status.HTTP_502_BAD_GATEWAY
    message_en = "The file could not be stored."
    message_te = "ఫైల్‌ను భద్రపరచలేకపోయాం."


# --- e-paper (§8) ---------------------------------------------------------- #
class EditionNotReadyError(AppError):
    code = "EDITION_NOT_READY"
    status_code = status.HTTP_409_CONFLICT
    message_en = "The edition is still processing and cannot be published yet."
    message_te = "ఎడిషన్ ఇంకా ప్రాసెస్ అవుతోంది; ఇప్పుడే ప్రచురించలేరు."


class SearchUnavailableError(AppError):
    code = "SEARCH_UNAVAILABLE"
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    message_en = "Search is temporarily unavailable."
    message_te = "వెతుకులాట సేవ తాత్కాలికంగా అందుబాటులో లేదు."


# --------------------------------------------------------------------------- #
# handlers
# --------------------------------------------------------------------------- #
def _json(err: AppError) -> JSONResponse:
    return JSONResponse(status_code=err.status_code, content=err.to_payload())


def register_exception_handlers(app: FastAPI) -> None:
    """Wire every exception path to the §13 error envelope."""

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return _json(exc)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Pydantic's ctx can hold non-serialisable objects; keep only what a client needs.
        fields = [
            {
                "field": ".".join(str(p) for p in e.get("loc", ()) if p != "body"),
                "message": e.get("msg", ""),
                "type": e.get("type", ""),
            }
            for e in exc.errors()
        ]
        return _json(ValidationError(details={"fields": fields}))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        mapping: dict[int, type[AppError]] = {
            401: UnauthorizedError,
            403: PermissionDeniedError,
            404: NotFoundError,
            409: ConflictError,
            429: RateLimitedError,
        }
        cls = mapping.get(exc.status_code)
        if cls is not None:
            return _json(cls())
        err = AppError(status_code=exc.status_code)
        err.code = f"HTTP_{exc.status_code}"
        if isinstance(exc.detail, str) and exc.detail:
            err.message_en = exc.detail
        return _json(err)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Last resort: log with the request id, return the generic envelope.
        # The exception text itself is never sent to the client (§36, §12.1).
        logger.exception(
            "unhandled_exception",
            path=request.url.path,
            method=request.method,
            request_id=getattr(request.state, "request_id", None),
            error_type=type(exc).__name__,
        )
        return _json(AppError())
