"""Per-endpoint rate limiting for public write paths (updated doc §27).

Counters live in Redis via `incr_with_ttl`. The failure mode is deliberate
and matches the platform's caching policy: when Redis is unavailable the
counter returns 0 and the limit does not bite — a cache outage must degrade
the guard, not take reader writes down with it. Login/OTP endpoints keep
their own stricter lockout machinery in auth_service; this module covers the
engagement surface (beacons, comments, reports, follows, submissions, ad
clicks).

Keying: the signed-in user id when the request carries one (set on
`request.state` by `get_current_principal`), else the client IP. That means
the dependency must be listed AFTER the auth dependency in a route signature
so the user id is already resolved.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Request

from app.core.errors import RateLimitedError
from app.core.redis_client import incr_with_ttl

WINDOW_SECONDS = 60


def _client_key(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if user_id is not None:
        return f"u:{user_id}"
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (
        request.client.host if request.client else "unknown"
    )
    return f"ip:{ip[:45]}"


def rate_limit(action: str, per_minute: int) -> Callable[[Request], None]:
    """Dependency factory: at most `per_minute` calls per user/IP per minute."""

    def dependency(request: Request) -> None:
        key = f"rl:{action}:{_client_key(request)}"
        count = incr_with_ttl(key, WINDOW_SECONDS)
        if count > per_minute:
            raise RateLimitedError(
                details={"action": action, "limit_per_minute": per_minute}
            )

    dependency.__doc__ = f"Rate limit: {per_minute}/min for `{action}`"
    return dependency
