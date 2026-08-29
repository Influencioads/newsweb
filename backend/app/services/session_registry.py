"""Redis session registry (§1: "Redis session registry ... Needed for force-logout
of a reporter who leaves").

Why Redis and not just MySQL: the access-token check runs on every authenticated
request. A database round trip there would eat the §12.2 p95 < 300 ms budget.
MySQL `sessions` stays the durable record; Redis is the fast revocation index.

Fail-closed: if Redis is unreachable, `is_session_active` returns **False**.
Treating an unknown session as valid would mean a revoked reporter keeps access
during an outage, which is exactly the risk this registry exists to remove.
"""

from __future__ import annotations

from datetime import datetime, timezone
from threading import RLock

import redis

from app.core.config import settings
from app.core.logging import get_logger
from app.core.redis_client import get_redis

logger = get_logger(__name__)

_PREFIX = "session:"
_USER_INDEX = "user-sessions:"
_local_sessions: dict[str, tuple[int, datetime]] = {}
_local_lock = RLock()


def _allow_local_fallback() -> bool:
    return settings.APP_ENV in {"development", "test"}


def _local_register(session_key: str, user_id: int, expires_at: datetime) -> None:
    with _local_lock:
        _local_sessions[session_key] = (user_id, expires_at)


def _local_active(session_key: str) -> bool:
    with _local_lock:
        item = _local_sessions.get(session_key)
        if not item:
            return False
        if item[1] <= datetime.now(timezone.utc):
            _local_sessions.pop(session_key, None)
            return False
        return True


def _key(session_key: str) -> str:
    return f"{_PREFIX}{session_key}"


def _user_key(user_id: int) -> str:
    return f"{_USER_INDEX}{user_id}"


def register_session(session_key: str, user_id: int, expires_at: datetime) -> None:
    ttl = max(int((expires_at - datetime.now(timezone.utc)).total_seconds()), 60)
    client = get_redis()
    pipe = client.pipeline()
    pipe.setex(_key(session_key), ttl, str(user_id))
    pipe.sadd(_user_key(user_id), session_key)
    pipe.expire(_user_key(user_id), ttl)
    try:
        pipe.execute()
    except redis.RedisError as exc:
        if not _allow_local_fallback():
            raise
        logger.warning("session_registry_local_fallback", operation="register", error=str(exc))
        _local_register(session_key, user_id, expires_at)


def touch_session(session_key: str, expires_at: datetime) -> None:
    """Extend a session's TTL after a successful refresh rotation."""
    ttl = max(int((expires_at - datetime.now(timezone.utc)).total_seconds()), 60)
    try:
        get_redis().expire(_key(session_key), ttl)
    except redis.RedisError:
        pass


def is_session_active(session_key: str) -> bool:
    try:
        return get_redis().exists(_key(session_key)) == 1
    except redis.RedisError as exc:
        if _allow_local_fallback() and _local_active(session_key):
            return True
        # Fail closed. See the module docstring.
        logger.error("session_registry_unavailable", error=str(exc))
        return False


def revoke_session(session_key: str, user_id: int | None = None) -> None:
    if _allow_local_fallback():
        with _local_lock:
            _local_sessions.pop(session_key, None)
    client = get_redis()
    try:
        if user_id is None:
            raw = client.get(_key(session_key))
            user_id = int(raw) if raw else None
        pipe = client.pipeline()
        pipe.delete(_key(session_key))
        if user_id is not None:
            pipe.srem(_user_key(user_id), session_key)
        pipe.execute()
    except (redis.RedisError, ValueError) as exc:
        logger.error("session_revoke_failed", session_key=session_key[:8], error=str(exc))


def revoke_all_for_user(user_id: int) -> list[str]:
    """Force-logout every device for a user. Returns the revoked session keys."""
    try:
        client = get_redis()
        keys = list(client.smembers(_user_key(user_id)))
        if keys:
            pipe = client.pipeline()
            for k in keys:
                pipe.delete(_key(k))
            pipe.delete(_user_key(user_id))
            pipe.execute()
        return keys
    except redis.RedisError as exc:
        if _allow_local_fallback():
            with _local_lock:
                keys = [key for key, item in _local_sessions.items() if item[0] == user_id]
                for key in keys:
                    _local_sessions.pop(key, None)
            return keys
        logger.error("session_revoke_all_failed", user_id=user_id, error=str(exc))
        return []


# --------------------------------------------------------------------------- #
# Retired refresh-token hashes — reuse detection (§1 "rotating refresh")
# --------------------------------------------------------------------------- #
# Rotation overwrites `sessions.refresh_hash`, so a replayed old token matches no
# row at all and would look merely "invalid". That is indistinguishable from a
# typo, and would let a thief probe silently. Retired hashes are therefore kept
# for the remainder of the refresh lifetime: a hit here means the token was
# genuinely issued and has already been spent, which is theft, not a typo.
_RETIRED = "refresh-retired:"


def retire_refresh_hash(token_hash: str, session_key: str, ttl_seconds: int) -> None:
    try:
        get_redis().setex(f"{_RETIRED}{token_hash}", max(ttl_seconds, 60), session_key)
    except redis.RedisError as exc:
        logger.error("retire_refresh_failed", error=str(exc))


def find_retired_session(token_hash: str) -> str | None:
    """Return the session key a retired refresh-token hash belonged to."""
    try:
        return get_redis().get(f"{_RETIRED}{token_hash}")
    except redis.RedisError:
        return None


def clear_retired_for_session(session_key: str) -> None:
    """Drop retired hashes once their session is gone, so the keyspace does not
    grow without bound for long-lived accounts."""
    try:
        client = get_redis()
        for key in client.scan_iter(match=f"{_RETIRED}*", count=500):
            if client.get(key) == session_key:
                client.delete(key)
    except redis.RedisError:
        pass


def active_session_keys(user_id: int) -> list[str]:
    try:
        return sorted(get_redis().smembers(_user_key(user_id)))
    except redis.RedisError:
        if not _allow_local_fallback():
            return []
        with _local_lock:
            return sorted(key for key, item in _local_sessions.items()
                          if item[0] == user_id and item[1] > datetime.now(timezone.utc))
