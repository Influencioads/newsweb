"""Spend accounting for the AI features (§7.1).

The limits this enforces were declared in config from the beginning and read by
nothing. That is a specific kind of dangerous: an operator reads
`AI_MONTHLY_BUDGET_INR=15000` in their env file and reasonably concludes there
is a ceiling, when in fact a stuck crawl loop could bill without limit.

Three rules, in the order they are checked:

  * **Budget** — the newsroom's monthly ceiling, across every surface that
    spends. One budget, one number, exactly as §21 does for voice: two counters
    would let each half quietly spend the whole allowance.
  * **Quota** — a per-user daily call count, so one contributor cannot consume
    the month in an afternoon. Scheduled tasks have no actor and are exempt
    from the quota, but *not* from the budget.
  * **Record** — one row per call, success or failure. An outage that still
    consumed quota must not turn into free retries in a loop.

Money is handled in integer paise throughout. See `AiUsage`.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings as env_settings
from app.core.errors import AiBudgetExceededError, AiQuotaExceededError
from app.core.logging import get_logger
from app.models.ai import AiUsage

logger = get_logger(__name__)

#: Providers quote in USD; the budget is in INR. A precise rate needs a feed
#: nobody wants to run for a spend guard, so this is deliberately a round,
#: slightly pessimistic constant — erring high means the ceiling binds a little
#: early, which is the safe direction for a budget.
# ponytail: fixed FX rate, swap for a rates feed if the budget needs to be exact
_USD_TO_PAISE = 9000  # 1 USD ~= 90 INR


def month_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def day_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def usd_to_paise(usd: float | None) -> int:
    if not usd:
        return 0
    return max(0, round(float(usd) * _USD_TO_PAISE))


def month_spend_paise(db: Session) -> int:
    return int(
        db.scalar(
            select(func.coalesce(func.sum(AiUsage.cost_paise), 0)).where(
                AiUsage.created_at >= month_start()
            )
        )
        or 0
    )


def calls_today(db: Session, actor_id: int) -> int:
    return int(
        db.scalar(
            select(func.count(AiUsage.id)).where(
                AiUsage.actor_id == actor_id, AiUsage.created_at >= day_start()
            )
        )
        or 0
    )


def budget_paise() -> int:
    return max(0, round(float(env_settings.AI_MONTHLY_BUDGET_INR or 0) * 100))


#: Seniority at or above which a user is not rate-limited. A desk head blocked
#: mid-edit is a worse failure than the spend it would have saved, and §6.1
#: already uses `level` for rules of exactly this shape.
_UNLIMITED_LEVEL = 60
#: Below this is a stringer; at or above it, a reporter.
_REPORTER_LEVEL = 40


def _max_role_level(db: Session, actor_id: int) -> int:
    """Highest seniority the user holds, 0 if they hold no role."""
    from app.models.user import Role, UserRole

    return int(
        db.scalar(
            select(func.coalesce(func.max(Role.level), 0))
            .select_from(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .where(UserRole.user_id == actor_id)
        )
        or 0
    )


def _quota_for(level: int) -> int:
    """The per-day call ceiling for a seniority level. 0 means no ceiling."""
    if level >= _UNLIMITED_LEVEL:
        return 0
    if level >= _REPORTER_LEVEL:
        return env_settings.AI_QUOTA_REPORTER_PER_DAY
    return env_settings.AI_QUOTA_STRINGER_PER_DAY


def check_budget(db: Session) -> None:
    """Raise if the newsroom has spent its month. Called before every request."""
    budget = budget_paise()
    if not budget:
        return  # 0 / unset means "no ceiling", the documented default
    spent = month_spend_paise(db)
    if spent >= budget:
        logger.warning("ai_budget_exceeded", spent_paise=spent, budget_paise=budget)
        raise AiBudgetExceededError(
            details={
                "spent_inr": round(spent / 100, 2),
                "budget_inr": round(budget / 100, 2),
            }
        )


def check_quota(db: Session, actor_id: int | None) -> None:
    """Raise if this user has used their day. Scheduled tasks pass actor_id=None."""
    if actor_id is None:
        return
    ceiling = _quota_for(_max_role_level(db, actor_id))
    if not ceiling:
        return
    used = calls_today(db, actor_id)
    if used >= ceiling:
        logger.info("ai_quota_exceeded", actor_id=actor_id, used=used, ceiling=ceiling)
        raise AiQuotaExceededError(details={"used": used, "limit": ceiling})


def guard(db: Session, actor_id: int | None) -> None:
    """Budget first, then quota — a newsroom that is out of money should say so
    rather than telling one user they personally ran out."""
    check_budget(db)
    check_quota(db, actor_id)


def record(
    db: Session,
    *,
    operation: str,
    provider: str,
    model: str | None = None,
    actor_id: int | None = None,
    usage: dict | None = None,
    ok: bool = True,
    error: str | None = None,
) -> AiUsage:
    """Write one ledger row. `usage` is the provider's own usage envelope."""
    usage = usage or {}
    row = AiUsage(
        operation=operation[:40],
        provider=(provider or "unknown")[:60],
        model=(model or None) and str(model)[:120],
        actor_id=actor_id,
        prompt_tokens=int(usage.get("prompt_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
        cost_paise=usd_to_paise(usage.get("usd_spent")),
        ok=ok,
        error=(error or None) and str(error)[:300],
    )
    db.add(row)
    db.flush()
    return row


def usage_summary(db: Session) -> dict[str, float | int]:
    """What the settings screen shows, mirroring the voice meter next to it."""
    budget = budget_paise()
    spent = month_spend_paise(db)
    calls = int(
        db.scalar(
            select(func.count(AiUsage.id)).where(AiUsage.created_at >= month_start())
        )
        or 0
    )
    failed = int(
        db.scalar(
            select(func.count(AiUsage.id)).where(
                AiUsage.created_at >= month_start(), AiUsage.ok.is_(False)
            )
        )
        or 0
    )
    return {
        "spent_inr": round(spent / 100, 2),
        "budget_inr": round(budget / 100, 2),
        "percent_used": round(spent * 100 / budget) if budget else 0,
        "alert_percent": env_settings.AI_BUDGET_ALERT_PERCENT,
        "calls_this_month": calls,
        "calls_failed": failed,
    }
