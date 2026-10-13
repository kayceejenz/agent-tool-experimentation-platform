from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel


class UsageTotals(BaseModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int
    estimated_cost_usd: Decimal
    calls: int
    missing_usage_calls: int
    unpriced_calls: int


class DailyUsage(UsageTotals):
    date: date


class ProjectUsageResponse(BaseModel):
    currency: Literal["USD"]
    pricing_date: date
    timezone: str
    totals: UsageTotals
    sources: dict[str, UsageTotals]
    daily: list[DailyUsage]
