"""The AI spend guard (§7.1).

`AI_MONTHLY_BUDGET_INR` and the per-role daily quotas were declared in config
from the beginning and read by no code, so `AiBudgetExceededError` and
`AiQuotaExceededError` could never be raised. These tests exist because a
ceiling that silently does nothing is worse than no ceiling: an operator reads
the env file and believes they are protected.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.errors import AiBudgetExceededError, AiQuotaExceededError
from app.db.base import Base
from app.models.ai import AiUsage  # noqa: F401 — registers the table
from app.services import ai_usage_service as usage

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, future=True
)


@pytest.fixture
def db() -> Iterator[Session]:
    """A fresh ledger per test — these assertions are all about totals, so a
    row leaking between them would make failures depend on ordering."""
    Base.metadata.create_all(engine)
    session = TestSession()
    yield session
    session.rollback()
    session.close()
    Base.metadata.drop_all(engine)


# ------------------------------------------------------------------- money
def test_money_is_stored_as_integer_paise():
    """Floating-point money accumulates rounding error, and a budget that
    drifts is worse than none because it still looks enforced."""
    assert usage.usd_to_paise(1.0) == 9000
    assert usage.usd_to_paise(0.000004) == 0  # a fraction of a paisa floors
    assert usage.usd_to_paise(None) == 0
    assert usage.usd_to_paise(0) == 0
    assert isinstance(usage.usd_to_paise(0.5), int)


def test_spend_accumulates_across_operations(db):
    for op in ("suggest", "draft", "rewrite"):
        usage.record(
            db,
            operation=op,
            provider="aimlapi",
            model="openai/gpt-4o-mini",
            usage={"usd_spent": 1.0},
        )
    assert usage.month_spend_paise(db) == 27000


def test_budget_blocks_once_reached(monkeypatch, db):
    monkeypatch.setattr("app.core.config.settings.AI_MONTHLY_BUDGET_INR", 100.0)
    usage.check_budget(db)  # nothing spent yet

    usage.record(db, operation="draft", provider="aimlapi", usage={"usd_spent": 1.0})
    usage.check_budget(db)  # 90 INR of a 100 INR budget

    usage.record(db, operation="draft", provider="aimlapi", usage={"usd_spent": 1.0})
    with pytest.raises(AiBudgetExceededError):
        usage.check_budget(db)  # 180 INR — over


def test_zero_budget_means_no_ceiling(monkeypatch, db):
    """0 / unset is the documented default and must not mean "spend nothing"."""
    monkeypatch.setattr("app.core.config.settings.AI_MONTHLY_BUDGET_INR", 0)
    usage.record(db, operation="draft", provider="aimlapi", usage={"usd_spent": 999.0})
    usage.check_budget(db)


def test_a_failed_call_still_costs(db):
    """A provider that errors after consuming tokens must not make retries free."""
    usage.record(
        db,
        operation="rewrite",
        provider="aimlapi",
        usage={"usd_spent": 1.0},
        ok=False,
        error="timeout",
    )
    assert usage.month_spend_paise(db) == 9000
    assert usage.usage_summary(db)["calls_failed"] == 1


# ------------------------------------------------------------------- quota
def test_quota_scales_with_seniority(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.AI_QUOTA_STRINGER_PER_DAY", 20)
    monkeypatch.setattr("app.core.config.settings.AI_QUOTA_REPORTER_PER_DAY", 50)
    assert usage._quota_for(0) == 20  # stringer
    assert usage._quota_for(40) == 50  # reporter
    # A desk head blocked mid-edit is a worse failure than the spend saved.
    assert usage._quota_for(80) == 0  # no ceiling


def test_scheduled_tasks_are_exempt_from_quota_but_not_budget(monkeypatch, db):
    """The crawl and the nightly discovery pass have no user to bill."""
    monkeypatch.setattr("app.core.config.settings.AI_MONTHLY_BUDGET_INR", 100.0)
    usage.check_quota(db, None)  # never raises

    usage.record(db, operation="rewrite", provider="aimlapi", usage={"usd_spent": 2.0})
    with pytest.raises(AiBudgetExceededError):
        usage.guard(db, None)  # budget still applies


def test_quota_counts_only_todays_calls_for_that_user(monkeypatch, db):
    monkeypatch.setattr("app.core.config.settings.AI_QUOTA_STRINGER_PER_DAY", 2)
    assert usage.calls_today(db, 999) == 0
    usage.record(db, operation="draft", provider="aimlapi", actor_id=999)
    usage.record(db, operation="draft", provider="aimlapi", actor_id=999)
    # A different user's spend must not exhaust this one's allowance.
    usage.record(db, operation="draft", provider="aimlapi", actor_id=1000)
    assert usage.calls_today(db, 999) == 2
    assert usage.calls_today(db, 1000) == 1


def test_budget_is_checked_before_quota(monkeypatch, db):
    """A newsroom out of money should say so, rather than telling one user they
    personally ran out — the fix for each is different."""
    monkeypatch.setattr("app.core.config.settings.AI_MONTHLY_BUDGET_INR", 1.0)
    monkeypatch.setattr("app.core.config.settings.AI_QUOTA_STRINGER_PER_DAY", 1)
    usage.record(db, operation="draft", provider="aimlapi", actor_id=999,
                 usage={"usd_spent": 5.0})
    with pytest.raises(AiBudgetExceededError):
        usage.guard(db, 999)


def test_quota_raises_when_over_and_user_has_no_roles(monkeypatch, db):
    monkeypatch.setattr("app.core.config.settings.AI_MONTHLY_BUDGET_INR", 0)
    monkeypatch.setattr("app.core.config.settings.AI_QUOTA_STRINGER_PER_DAY", 1)
    usage.record(db, operation="draft", provider="aimlapi", actor_id=999)
    with pytest.raises(AiQuotaExceededError):
        usage.guard(db, 999)


# ----------------------------------------------------------------- reporting
def test_usage_summary_shape_matches_the_settings_screen(db):
    out = usage.usage_summary(db)
    for key in (
        "spent_inr",
        "budget_inr",
        "percent_used",
        "alert_percent",
        "calls_this_month",
        "calls_failed",
    ):
        assert key in out, key
