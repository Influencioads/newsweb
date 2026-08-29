"""FastAPI application entrypoint.

Wiring order matters and is fixed here:
  settings -> logging -> Sentry -> app -> middleware -> exception handlers -> routers
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1 import health
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.middleware.request_context import (
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)

configure_logging(level=settings.LOG_LEVEL, json_output=settings.LOG_JSON)
logger = get_logger(__name__)

if settings.SENTRY_DSN:  # pragma: no cover - requires a real DSN
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.APP_ENV,
        traces_sample_rate=0.1,
        send_default_pii=False,  # never ship reader PII to Sentry (DPDP Act, §12.5)
    )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    problems = settings.assert_production_safe()
    if problems:
        # Refuse to boot rather than run production with a dev-only setting.
        for p in problems:
            logger.error("unsafe_production_setting", problem=p)
        raise RuntimeError(
            "Refusing to start in production with unsafe settings: " + "; ".join(problems)
        )

    logger.info(
        "startup",
        app=settings.APP_NAME,
        env=settings.APP_ENV,
        api_prefix=settings.API_V1_PREFIX,
    )
    yield
    logger.info("shutdown")


DESCRIPTION = """
REST API for the Telugu News Platform — public reader surfaces, the newsroom CMS,
the AI gateway, the e-paper pipeline, and video.

**The rule that overrides everything:** nothing reaches a reader without a human
editor pressing Approve. There is no auto-publish flag in this API — not for AI
drafts, not for scheduled posts, not for imports.

Conventions
* `/api/v1`, JSON, `snake_case` fields, ISO-8601 UTC timestamps.
* Errors always use the envelope
  `{"error": {"code", "message_en", "message_te", "details"}}`.
* Every mutating CMS endpoint runs: permission guard -> scope check -> validation
  -> service -> audit log, in that order.
"""

app = FastAPI(
    title=settings.APP_NAME,
    description=DESCRIPTION,
    version="1.0.0",
    lifespan=lifespan,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    contact={"name": "Tech Lead", "url": settings.APP_URL},
    license_info={"name": "Proprietary"},
    openapi_tags=[
        {"name": "health", "description": "Liveness and readiness probes."},
        {"name": "auth", "description": "Login, OTP, 2FA, refresh rotation, sessions."},
        {"name": "public", "description": "Cached, unauthenticated reader endpoints."},
        {"name": "cms", "description": "Newsroom CMS. Permission-guarded on every route."},
        {"name": "users", "description": "Users, roles, permissions, scopes."},
        {"name": "articles", "description": "Article CRUD, versions, workflow transitions."},
        {"name": "media", "description": "Media library and presigned uploads."},
        {"name": "epaper", "description": "Editions, pages, hotspots."},
        {"name": "videos", "description": "Provider-agnostic video ingest and playback."},
        {"name": "ai", "description": "AI gateway: tasks, jobs, prompts, cost ledger."},
        {"name": "search", "description": "Meilisearch-backed search."},
        {"name": "notifications", "description": "Push campaigns, compose/approve/send."},
        {"name": "audit", "description": "Append-only audit log (read-only)."},
    ],
)

# Middleware runs bottom-up: CORS outermost, then security headers, then context.
app.add_middleware(RequestContextMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,   # allowlist, never "*" (§12.1)
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"],
    expose_headers=["X-Request-ID"],
    max_age=600,
)

register_exception_handlers(app)

# Local-disk media is served by the app in development only. In staging and
# production `STORAGE_PROVIDER` points at Zata/Bunny and readers hit the CDN,
# so this mount is inert (§1, §10.1).
if settings.STORAGE_PROVIDER == "local":
    import mimetypes
    from pathlib import Path

    # Windows has no registry entry for these, so `mimetypes.guess_type` returns
    # text/plain and the browser refuses to paint the image. Register them
    # explicitly rather than depending on the host OS.
    for _mime, _ext in (
        ("image/webp", ".webp"),
        ("image/avif", ".avif"),
        ("font/woff2", ".woff2"),
    ):
        mimetypes.add_type(_mime, _ext)

    _media_root = Path(settings.STORAGE_LOCAL_PATH).resolve()
    _media_root.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=str(_media_root)), name="media")

# Health probes live at the root: §12.3 monitors /health, and a load balancer
# should not have to know the API version prefix to check liveness.
app.include_router(health.router)
app.include_router(api_router, prefix=settings.API_V1_PREFIX)
