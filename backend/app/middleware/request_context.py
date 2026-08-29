"""Request-scoped middleware: request id, access logging, security headers.

§12.3 requires request ids and structured access logs.
§12.1 requires CSP, HSTS, X-Frame-Options and a CORS allowlist.
"""

from __future__ import annotations

import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("api.access")

REQUEST_ID_HEADER = "X-Request-ID"


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assign a request id and emit one structured access line per request."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Honour an upstream id (nginx / load balancer) so a trace survives the hop.
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex[:16]
        request.state.request_id = request_id

        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            # The exception handler renders the body; we only record timing here
            # and re-raise so the handler still runs.
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            logger.error(
                "request_failed",
                request_id=request_id,
                method=request.method,
                route=request.url.path,
                duration_ms=duration_ms,
                user_id=getattr(request.state, "user_id", None),
            )
            raise

        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers[REQUEST_ID_HEADER] = request_id

        if request.url.path not in ("/health", "/health/live"):
            logger.info(
                "request",
                request_id=request_id,
                method=request.method,
                route=request.url.path,
                status=response.status_code,
                duration_ms=duration_ms,
                user_id=getattr(request.state, "user_id", None),
            )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Security headers (§12.1)."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        # §12.1: allow only our own e-paper iframes.
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(self), camera=()"
        )

        if settings.CSP_ENABLED:
            # The API serves JSON plus the OpenAPI docs page. `unsafe-inline`/CDN
            # allowances are scoped to the docs routes only; every other response
            # gets the strict policy.
            if request.url.path in ("/docs", "/redoc", f"{settings.API_V1_PREFIX}/openapi.json"):
                csp = (
                    "default-src 'self'; "
                    "img-src 'self' data: https://fastapi.tiangolo.com; "
                    "script-src 'self' https://cdn.jsdelivr.net; "
                    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                    "worker-src 'self' blob:"
                )
            else:
                csp = (
                    "default-src 'none'; frame-ancestors 'self'; "
                    "base-uri 'none'; form-action 'none'"
                )
            response.headers.setdefault("Content-Security-Policy", csp)

        if settings.HSTS_ENABLED:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response
