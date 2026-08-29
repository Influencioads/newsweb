"""Structured logging (§12.3, brief §37).

Every log line carries: request id, user id, route, method, status, duration, error.

Secrets are never logged. `_redact` strips password / OTP / JWT / API-key fields
before rendering, so an accidental `logger.info("login", **payload)` cannot leak a
credential (brief §37).
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

_SENSITIVE_KEYS = frozenset(
    {
        "password",
        "password_hash",
        "new_password",
        "current_password",
        "otp",
        "otp_code",
        "code",
        "token",
        "access_token",
        "refresh_token",
        "refresh_hash",
        "jwt",
        "authorization",
        "api_key",
        "secret",
        "secret_key",
        "access_key",
        "two_factor_secret",
        "totp",
        "totp_code",
        "encryption_key",
        "cookie",
        "set-cookie",
    }
)

_REDACTED = "[redacted]"


def _redact(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    for key in list(event_dict.keys()):
        if key.lower() in _SENSITIVE_KEYS:
            event_dict[key] = _REDACTED
    return event_dict


_configured = False


def configure_logging(level: str = "INFO", json_output: bool = False) -> None:
    """Idempotent logging setup. Call once at startup."""
    global _configured
    if _configured:
        return

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
    )
    # uvicorn duplicates access lines that our middleware already emits.
    logging.getLogger("uvicorn.access").handlers.clear()
    logging.getLogger("uvicorn.access").propagate = False

    processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        _redact,
    ]
    processors.append(
        structlog.processors.JSONRenderer()
        if json_output
        else structlog.dev.ConsoleRenderer(colors=False)
    )

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
    _configured = True


def get_logger(name: str | None = None) -> Any:
    if not _configured:
        configure_logging()
    return structlog.get_logger(name)
