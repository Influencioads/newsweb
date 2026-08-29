"""Redis client and the cache helpers used by the public read paths (§10.1, §33).

Redis backs four things in this system:
  1. public response cache (home, breaking, article, e-paper)
  2. the session registry, so a reporter who leaves can be force-logged-out (§1)
  3. rate limits and login-attempt counters (§6.2, §12.1)
  4. OTP storage

A Redis outage must degrade, not break: `cache_get` returns None and the caller
falls through to the database. Only the session registry treats Redis as
authoritative, and that is deliberate — a revoked session must never be honoured
because the cache was unavailable.
"""

from __future__ import annotations

import json
from typing import Any

import redis

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_pool = redis.ConnectionPool.from_url(
    settings.REDIS_URL,
    decode_responses=True,
    socket_connect_timeout=2,
    socket_timeout=2,
    health_check_interval=30,
)


def get_redis() -> redis.Redis:
    return redis.Redis(connection_pool=_pool)


def ping() -> bool:
    try:
        return bool(get_redis().ping())
    except redis.RedisError:
        return False


# --------------------------------------------------------------------------- #
# cache helpers — never used for private user data (brief §33)
# --------------------------------------------------------------------------- #
CACHE_PREFIX = "cache:"


def cache_get(key: str) -> Any | None:
    try:
        raw = get_redis().get(CACHE_PREFIX + key)
    except redis.RedisError as exc:
        logger.warning("cache_unavailable", op="get", key=key, error=str(exc))
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def cache_set(key: str, value: Any, ttl_seconds: int) -> None:
    try:
        get_redis().setex(CACHE_PREFIX + key, ttl_seconds, json.dumps(value, default=str))
    except redis.RedisError as exc:
        logger.warning("cache_unavailable", op="set", key=key, error=str(exc))


def cache_delete_prefix(prefix: str) -> int:
    """Invalidate a cache namespace after a publish (§10.1 revalidate equivalent).

    SCAN, never KEYS: KEYS blocks the Redis event loop and a publish during a
    breaking-news spike is exactly when that would hurt most.
    """
    deleted = 0
    try:
        client = get_redis()
        for key in client.scan_iter(match=f"{CACHE_PREFIX}{prefix}*", count=500):
            client.delete(key)
            deleted += 1
    except redis.RedisError as exc:
        logger.warning("cache_unavailable", op="invalidate", prefix=prefix, error=str(exc))
    return deleted


# --------------------------------------------------------------------------- #
# counters — rate limiting and login attempts
# --------------------------------------------------------------------------- #
def incr_with_ttl(key: str, ttl_seconds: int) -> int:
    """Atomically increment a counter, setting the TTL on first write."""
    client = get_redis()
    pipe = client.pipeline()
    pipe.incr(key)
    pipe.expire(key, ttl_seconds, nx=True)
    result = pipe.execute()
    return int(result[0])


def get_int(key: str) -> int:
    try:
        raw = get_redis().get(key)
        return int(raw) if raw is not None else 0
    except (redis.RedisError, ValueError):
        return 0


def delete(*keys: str) -> None:
    if not keys:
        return
    try:
        get_redis().delete(*keys)
    except redis.RedisError:
        pass
