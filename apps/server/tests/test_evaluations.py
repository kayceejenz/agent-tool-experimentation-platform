import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from core.settings import Settings
from modules.evaluations.dtos.evaluation_dto import Expectations
from langchain_core.messages import AIMessage
from modules.evaluations.services.evaluation_service import (
    DIMENSIONS,
    Evaluator,
    code_checks,
    evidence_package,
    profile_snapshot,
    unknown_report,
    validate_report,
)
from pydantic import ValidationError


def fixture():
    identifier, tool_id = uuid4(), uuid4()
    start = datetime.now(timezone.utc)
    run = {
        "id": uuid4(),
        "input": "Find sales",
        "status": "completed",
        "termination_reason": "final_answer",
        "final_answer": "Sales are 42",
        "snapshot": {
            "tools": [{"id": str(tool_id), "definition": {"input_schema": {}}}]
        },
        "started_at": start,
        "finished_at": start + timedelta(seconds=2),
    }
    spans = [
        {
            "id": identifier,
            "kind": "tool",
            "name": "sales",
            "tool_id": tool_id,
            "inputs": {"month": 10},
            "outputs": {"sales": 42},
            "status": "success",
            "model_visible_output": '{"sales":42}',
        },
        {
            "id": uuid4(),
            "kind": "model",
            "status": "success",
            "outputs": [{"usage": {"input_count": 10, "output_count": 5}}],
        },
    ]
    return run, spans


def good_report(spans):
    return {
        "task_outcome": "completed",
        "overall_verdict": "pass",
        "requirements": [
            {
                "name": "Find sales",
                "status": "pass",
                "reason": "Answered from tool evidence",
                "evidence_refs": [str(spans[0]["id"]), "final_answer"],
            }
        ],
        "checks": [
            {
                "name": name,
                "status": "pass",
                "reason": "Supported",
                "evidence_refs": [str(spans[0]["id"])],
            }
            for name in DIMENSIONS
        ],
        "critical_failures": [],
        "limitations": [],
    }


def test_metrics_do_not_treat_retries_as_failures_and_keep_missing_usage_visible():
    run, spans = fixture()
    spans.append(
        {
            **spans[0],
            "id": uuid4(),
            "status": "invalid",
            "error_code": "invalid_arguments",
        }
    )
    spans.append({"id": uuid4(), "kind": "model", "status": "error", "outputs": None})
    metrics = code_checks(run, spans)
    assert metrics["tool_statuses"] == {"success": 1, "invalid": 1}
    assert metrics["usage_counts"] == {
        "input_count": 10,
        "output_count": 5,
        "missing_usage_turns": 1,
    }
    assert metrics["repeated_call_candidates"] == [
        [str(spans[0]["id"]), str(spans[2]["id"])]
    ]
    assert metrics["elapsed_ms"] == 2000


@pytest.mark.parametrize(
    "mutation",
    [
        "unknown_reference",
        "missing_dimension",
        "unsupported_failure",
        "duplicate_dimension",
    ],
)
def test_rejects_unverifiable_judge_reports(mutation):
    run, spans = fixture()
    report = good_report(spans)
    if mutation == "unknown_reference":
        report["checks"][0]["evidence_refs"] = [str(uuid4())]
    if mutation == "missing_dimension":
        report["checks"].pop()
    if mutation == "duplicate_dimension":
        report["checks"][0]["name"] = report["checks"][1]["name"]
    if mutation == "unsupported_failure":
        report["checks"][0].update(status="fail", evidence_refs=[])
    with pytest.raises(ValueError):
        validate_report(report, spans, code_checks(run, spans))


def test_critical_and_benchmark_failures_override_judge_pass():
    run, spans = fixture()
    metrics = code_checks(run, spans, {"forbidden_tools": [str(spans[0]["tool_id"])]})
    result = validate_report(good_report(spans), spans, metrics)
    assert result["overall_verdict"] == "fail"
    assert result["critical_failures"][0]["name"] == "forbidden_tool"
    report = good_report(spans)
    report["critical_failures"] = [
        {
            "name": "fabricated_write",
            "reason": "Claimed unsupported success",
            "evidence_refs": ["final_answer"],
        }
    ]
    assert (
        validate_report(report, spans, code_checks(run, spans))["overall_verdict"]
        == "fail"
    )


def test_unknown_dimensions_cannot_be_presented_as_pass():
    run, spans = fixture()
    report = good_report(spans)
    report["checks"][0]["status"] = "unknown"
    assert (
        validate_report(report, spans, code_checks(run, spans))["overall_verdict"]
        == "unknown"
    )


def test_profile_pins_prompt_model_and_evidence_contains_uncalled_tools():
    profile = profile_snapshot(
        {
            "evaluation_profile": {
                "enabled": True,
                "model": "judge",
                "prompt": {"id": "p", "revision": 2},
            },
            "evaluation_prompt": {"content": "Check GBP"},
            "model_settings": {"model": "agent"},
        }
    )
    assert profile["model"] == "judge" and profile["prompt"]["revision"] == 2
    assert "Check GBP" in profile["instructions"]
    run, spans = fixture()
    run["snapshot"]["tools"].append({"id": str(uuid4())})
    assert len(evidence_package(run, spans, None)["agent_snapshot"]["tools"]) == 2
    with pytest.raises(ValidationError):
        Expectations(constraints=["x" * 2001])


class Repository:
    def __init__(self, run, spans):
        self.run, self.spans, self.result = run, spans, None

    async def evidence(self, job):
        return self.run, self.spans

    async def finish(self, *args, **kwargs):
        self.result = (args, kwargs)


class Judge:
    def __init__(self, report):
        self.report = report

    def with_structured_output(self, schema, **kwargs):
        return self

    async def ainvoke(self, messages):
        assert len(messages) == 2
        return {
            "parsed": self.report,
            "raw": AIMessage(
                content="",
                usage_metadata={
                    "input_tokens": 15,
                    "output_tokens": 7,
                    "total_tokens": 22,
                },
            ),
            "parsing_error": None,
        }


@pytest.mark.parametrize("mode", ["valid", "invalid", "oversized", "unconfigured"])
def test_evaluation_is_bounded_and_independent_of_execution(mode):
    run, spans = fixture()
    repo = Repository(run, spans)
    report = good_report(spans)
    if mode == "invalid":
        report["checks"][0]["evidence_refs"] = ["invented-span"]
    profile = profile_snapshot({"model_settings": {"model": "fixture"}})
    if mode == "oversized":
        profile["max_evidence_chars"] = 1
    evaluator = Evaluator(
        repo,
        Settings(_env_file=None),
        None if mode == "unconfigured" else lambda _: Judge(report),
    )
    asyncio.run(evaluator.execute({"profile": profile, "expectations": None}))
    args, kwargs = repo.result
    assert run["status"] == "completed" and run["final_answer"] == "Sales are 42"
    assert len(args[4]) == 64
    if mode in ("valid", "oversized"):
        assert args[1] == "completed"
        assert args[3]["overall_verdict"] == ("pass" if mode == "valid" else "unknown")
    else:
        assert args[1] == "failed" and args[3] is None
        assert kwargs["error_code"] == (
            "invalid_evaluation_report"
            if mode == "invalid"
            else "provider_not_configured"
        )


@pytest.mark.parametrize("provider", ["openai", "google"])
@pytest.mark.parametrize("mode", ["valid", "truncated", "refused", "wrong_name"])
def test_real_sdk_structured_output_with_synthetic_transport(mode, provider):
    import json

    import httpx
    from langchain_openai import ChatOpenAI

    run, spans = fixture()
    report = good_report(spans)
    if mode == "wrong_name":
        report["checks"][0]["name"] = "Task completion"
    captured = []

    def respond(request):
        assert request.url.host == ("generativelanguage.googleapis.com" if provider == "google" else "api.openai.com")
        body = json.loads(request.content)
        captured.append(body)
        message = {"role": "assistant", "content": json.dumps(report)}
        if mode == "truncated":
            message["content"] = '{"task_outcome":'
        if mode == "refused":
            message.update(content=None, refusal="Synthetic refusal")
        return httpx.Response(
            200,
            json={
                "id": "synthetic-completion",
                "object": "chat.completion",
                "created": 1,
                "model": "gpt-4.1-mini",
                "choices": [
                    {
                        "index": 0,
                        "message": message,
                        "finish_reason": "length" if mode == "truncated" else "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 15,
                    "completion_tokens": 7,
                    "total_tokens": 22,
                },
            },
        )

    async def execute():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            model = ChatOpenAI(
                model="gemini-2.5-flash" if provider == "google" else "gpt-4.1-mini",
                api_key="synthetic-key",
                max_retries=0,
                use_responses_api=False,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/" if provider == "google" else "https://api.openai.com/v1",
                http_async_client=client,
            )
            repo = Repository(run, spans)
            profile = profile_snapshot({"model_settings": {"model": "gpt-4.1-mini"}})
            await Evaluator(repo, Settings(_env_file=None), lambda _: model).execute(
                {"profile": profile, "expectations": None}
            )
            return repo.result

    args, kwargs = asyncio.run(execute())
    schema = captured[0]["response_format"]["json_schema"]
    assert schema["strict"] is True
    assert schema["schema"]["$defs"]["CheckFinding"]["properties"]["name"][
        "enum"
    ] == list(DIMENSIONS)
    assert (
        str(spans[0]["id"])
        in schema["schema"]["$defs"]["Finding"]["properties"]["evidence_refs"]["items"][
            "enum"
        ]
    )
    if mode == "valid":
        assert args[1] == "completed"
    else:
        assert args[1] == "failed"
        assert (
            kwargs["error_code"]
            == {
                "truncated": "evaluation_output_limit",
                "refused": "evaluation_refused",
                "wrong_name": "invalid_evaluation_report",
            }[mode]
        )
        if mode == "wrong_name":
            assert args[2]["evaluation_diagnostic"] == "schema_mismatch"
