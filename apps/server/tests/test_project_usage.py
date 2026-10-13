from datetime import date
from decimal import Decimal

from modules.projects.helpers.usage import usage_summary


def row(**changes):
    return dict(
        source="agent",
        provider="openai",
        model="gpt-4o-mini",
        day=date(2026, 10, 12),
        long_context=False,
        input_tokens=1_000_000,
        output_tokens=100_000,
        calls=2,
        missing_usage_calls=0,
        **changes,
    )


def test_totals_include_old_usage_and_all_evaluation_attempts():
    old = row()
    old["day"] = None
    evaluation = row()
    evaluation.update(
        source="evaluation", input_tokens=500_000, output_tokens=50_000, calls=3
    )
    summary = usage_summary([old, evaluation], date(2026, 10, 12))
    assert summary["totals"]["total_tokens"] == 1_650_000
    assert summary["totals"]["estimated_cost_usd"] == Decimal("0.315")
    assert summary["sources"]["evaluation"]["calls"] == 3
    assert len(summary["daily"]) == 14
    assert summary["daily"][-1]["total_tokens"] == 550_000
    assert summary["daily"][0]["total_tokens"] == 0


def test_unknown_models_and_missing_usage_are_not_reported_as_complete():
    unknown = row()
    unknown.update(model="custom-model", missing_usage_calls=1)
    summary = usage_summary([unknown], date(2026, 10, 12))
    assert summary["totals"]["unpriced_calls"] == 2
    assert summary["totals"]["missing_usage_calls"] == 1
    assert summary["totals"]["estimated_cost_usd"] == 0
    assert summary["totals"]["total_tokens"] == 1_100_000


def test_pinned_models_and_gemini_long_context_rate():
    pinned = row()
    pinned["model"] = "gpt-4o-mini-2024-07-18"
    pro = row()
    pro.update(provider="google", model="gemini-2.5-pro", long_context=True)
    summary = usage_summary([pinned, pro], date(2026, 10, 12))
    assert summary["totals"]["estimated_cost_usd"] == Decimal("4.21")


def test_empty_project_returns_zero_filled_days():
    summary = usage_summary([], date(2026, 10, 12))
    assert summary["totals"]["total_tokens"] == 0
    assert summary["totals"]["estimated_cost_usd"] == 0
    assert summary["daily"][0]["date"] == "2026-09-29"
