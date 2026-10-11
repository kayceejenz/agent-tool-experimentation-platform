from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from modules.agents.dtos.agent_dto import EvaluationProfile


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Finding(Strict):
    name: str = Field(min_length=1, max_length=240)
    status: Literal["pass", "partial", "fail", "unknown", "not_applicable"]
    reason: str = Field(min_length=1, max_length=2000)
    evidence_refs: list[str] = Field(max_length=200)


class CriticalFailure(Strict):
    name: str = Field(min_length=1, max_length=240)
    reason: str = Field(min_length=1, max_length=2000)
    evidence_refs: list[str] = Field(min_length=1, max_length=200)


class CheckFinding(Finding):
    name: Literal[
        "task_completion",
        "tool_selection",
        "tool_inputs",
        "output_use",
        "answer_quality",
        "efficiency",
        "write_handling",
    ]


class Report(Strict):
    task_outcome: Literal["completed", "partial", "blocked", "failed", "unknown"]
    overall_verdict: Literal["pass", "partial", "fail", "unknown"]
    requirements: list[Finding] = Field(max_length=100)
    checks: list[CheckFinding] = Field(min_length=7, max_length=7)
    critical_failures: list[CriticalFailure] = Field(max_length=100)
    limitations: list[str] = Field(max_length=100)


ExpectationText = Annotated[str, Field(min_length=1, max_length=2000)]


class Expectations(Strict):
    required_outcomes: list[ExpectationText] = Field(
        default_factory=list, max_length=30
    )
    constraints: list[ExpectationText] = Field(default_factory=list, max_length=30)
    required_tools: list[UUID] = Field(default_factory=list, max_length=100)
    forbidden_tools: list[UUID] = Field(default_factory=list, max_length=100)
    final_answer_contains: list[ExpectationText] = Field(
        default_factory=list, max_length=30
    )


class Reevaluate(Strict):
    request_id: UUID
    expectations: Expectations | None = None
    profile: EvaluationProfile | None = None
