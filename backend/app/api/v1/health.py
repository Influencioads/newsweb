"""Liveness and readiness probes (§12.3 uptime monitoring)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.config import settings
from app.core.logging import get_logger
from app.core.redis_client import ping as redis_ping
from app.db.session import engine

logger = get_logger(__name__)
router = APIRouter(tags=["health"])


class DependencyStatus(BaseModel):
    mysql: bool = Field(description="MySQL reachable and answering SELECT 1")
    redis: bool = Field(description="Redis reachable and answering PING")


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"] = Field(description="Overall readiness")
    app: str
    env: str
    version: str
    dependencies: DependencyStatus


@router.get(
    "/health/live",
    summary="Liveness probe",
    description="Returns 200 as long as the process is running. Checks no dependency.",
    response_model=dict,
)
def live() -> dict[str, str]:
    return {"status": "alive"}


@router.get(
    "/health",
    summary="Readiness probe",
    description=(
        "Reports whether MySQL and Redis are reachable. Returns 503 when any "
        "dependency is down so a load balancer stops routing to this instance."
    ),
    response_model=HealthResponse,
    responses={503: {"description": "One or more dependencies are unavailable"}},
)
def health(response: Response) -> HealthResponse:
    mysql_ok = False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        mysql_ok = True
    except Exception as exc:  # noqa: BLE001 - probe must never raise
        logger.warning("health_mysql_down", error=str(exc))

    redis_ok = redis_ping()
    healthy = mysql_ok and redis_ok
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return HealthResponse(
        status="ok" if healthy else "degraded",
        app=settings.APP_NAME,
        env=settings.APP_ENV,
        version="1.0.0",
        dependencies=DependencyStatus(mysql=mysql_ok, redis=redis_ok),
    )
