"""Estimate text-token costs from aggregated recorded usage, without model calls."""

import re
from datetime import date, timedelta
from decimal import Decimal

# Standard paid USD per million text tokens. Verified against provider pricing.
# https://developers.openai.com/api/docs/models/gpt-4o-mini (and GPT-4.1 models)
# https://ai.google.dev/gemini-api/docs/pricing
# https://platform.claude.com/docs/en/models/haiku-5-5/overview
# Cached-input discounts, free tiers and billing adjustments are not recorded.
PRICING_DATE = "2026-10-12"
RATES = {
    ("google", "gemini-3.5-flash-lite"): ("0.30", "2.50"),
    # Introductory standard rates through 2026-12-31.
    ("google", "gemini-3.8-flash"): ("0.75", "3.75"),
    ("openai", "gpt-4.1-nano"): ("0.10", "0.40"),
    ("anthropic", "claude-haiku-5-5"): ("0.10", "0.50"),
    ("anthropic", "claude-haiku-4-5-20251001"): ("1", "5"),
    ("anthropic", "claude-haiku-4-5"): ("1", "5"),
    ("openai", "gpt-4o-mini"): ("0.15", "0.60"),
    ("openai", "gpt-4.1-mini"): ("0.40", "1.60"),
    ("openai", "gpt-4.1"): ("2", "8"),
    ("google", "gemini-2.5-flash-lite"): ("0.10", "0.40"),
    ("google", "gemini-2.5-flash"): ("0.30", "2.50"),
    ("google", "gemini-2.5-pro"): ("1.25", "10"),
}


def empty_totals():
    return dict(
        input_tokens=0,
        output_tokens=0,
        total_tokens=0,
        estimated_cost_usd=Decimal(0),
        calls=0,
        missing_usage_calls=0,
        unpriced_calls=0,
    )


def usage_summary(rows, today: date):
    total = empty_totals()
    sources = {name: empty_totals() for name in ("agent", "evaluation")}
    daily = {
        (today - timedelta(days=i)).isoformat(): empty_totals()
        for i in range(13, -1, -1)
    }
    for row in rows:
        # Support pinned OpenAI model versions while leaving unknown models unpriced.
        model = re.sub(r"-\d{4}-\d{2}-\d{2}$", "", row["model"] or "")
        rates = RATES.get((row["provider"], model))
        if (
            rates
            and row["provider"] == "google"
            and model == "gemini-2.5-pro"
            and row["long_context"]
        ):
            rates = ("2.50", "15")
        if (
            rates
            and row["provider"] == "anthropic"
            and model == "claude-haiku-5-5"
            and row["long_context"]
        ):
            rates = ("0.50", "2.50")
        inputs, outputs = int(row["input_tokens"]), int(row["output_tokens"])
        cost = (
            (inputs * Decimal(rates[0]) + outputs * Decimal(rates[1])) / 1_000_000
            if rates
            else Decimal(0)
        )
        values = dict(
            input_tokens=inputs,
            output_tokens=outputs,
            total_tokens=inputs + outputs,
            estimated_cost_usd=cost,
            calls=int(row["calls"]),
            missing_usage_calls=int(row["missing_usage_calls"]),
            unpriced_calls=0 if rates else int(row["calls"]),
        )
        buckets = [total, sources[row["source"]]]
        if row["day"] is not None and row["day"].isoformat() in daily:
            buckets.append(daily[row["day"].isoformat()])
        for bucket in buckets:
            for key, value in values.items():
                bucket[key] += value
    return {
        "currency": "USD",
        "pricing_date": PRICING_DATE,
        "timezone": "Europe/London",
        "totals": total,
        "sources": sources,
        "daily": [{"date": day, **values} for day, values in daily.items()],
    }
