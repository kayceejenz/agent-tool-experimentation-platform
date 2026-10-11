import hashlib
import json
from collections import Counter
from dataclasses import dataclass

from core.serialization import compact

from modules.evaluations.dtos.evaluation_dto import Report


def evidence_package(run, spans, expectations):
    return {
        "execution": {
            key: run.get(key)
            for key in ("id", "input", "status", "termination_reason", "final_answer")
        },
        "agent_snapshot": run["snapshot"],
        "steps": spans,
        "expectations": expectations,
    }


def code_checks(run, spans, expectations=None):
    tools = [s for s in spans if s["kind"] == "tool"]
    models = [s for s in spans if s["kind"] == "model"]
    signatures = {}
    repeats = []
    for span in tools:
        signature = compact([span.get("tool_id"), span.get("name"), span.get("inputs")])
        if signature in signatures:
            repeats.append([signatures[signature], str(span["id"])])
        else:
            signatures[signature] = str(span["id"])
    usage = {"input_count": 0, "output_count": 0, "missing_usage_turns": 0}
    for span in models:
        outputs = span.get("outputs")
        counters = (
            [o.get("usage", {}) for o in outputs if isinstance(o, dict)]
            if isinstance(outputs, list)
            else []
        )
        if not counters or any(
            u.get("input_count") is None or u.get("output_count") is None
            for u in counters
        ):
            usage["missing_usage_turns"] += 1
        for u in counters:
            for key in ("input_count", "output_count"):
                usage[key] += u.get(key) or 0
    assertions = []
    called = {str(s.get("tool_id")) for s in tools}
    for key in ("required_tools", "forbidden_tools"):
        for identifier in (expectations or {}).get(key, []):
            matches = [
                str(s["id"]) for s in tools if str(s.get("tool_id")) == str(identifier)
            ]
            passed = (
                str(identifier) in called
                if key == "required_tools"
                else str(identifier) not in called
            )
            assertions.append(
                {
                    "name": key,
                    "value": str(identifier),
                    "status": "pass" if passed else "fail",
                    "evidence_refs": matches or ["request"],
                }
            )
    for text in (expectations or {}).get("final_answer_contains", []):
        assertions.append(
            {
                "name": "final_answer_contains",
                "value": text,
                "status": "pass" if text in (run.get("final_answer") or "") else "fail",
                "evidence_refs": ["final_answer"],
            }
        )
    started, finished = run.get("started_at"), run.get("finished_at")
    return {
        "model_turns": len(models),
        "tool_calls": len(tools),
        "tool_statuses": dict(Counter(s["status"] for s in tools)),
        "invalid_argument_spans": [
            str(s["id"]) for s in tools if s.get("error_code") == "invalid_arguments"
        ],
        "unresolved_spans": [
            str(s["id"]) for s in spans if s["status"] in ("running", "unknown")
        ],
        "missing_observation_spans": [
            str(s["id"]) for s in tools if s.get("model_visible_output") is None
        ],
        "repeated_call_candidates": repeats,
        "elapsed_ms": max(0, int((finished - started).total_seconds() * 1000))
        if started and finished
        else None,
        "usage_counts": usage,
        "assertions": assertions,
    }


def report_schema(spans):
    schema = Report.model_json_schema()
    allowed_refs = sorted(
        {str(span["id"]) for span in spans} | {"request", "final_answer"}
    )
    for definition in ("Finding", "CheckFinding", "CriticalFailure"):
        references = schema["$defs"][definition]["properties"]["evidence_refs"]
        references["items"]["enum"] = allowed_refs
    return schema


@dataclass(frozen=True)
class EvaluationInput:
    metrics: dict
    evidence_hash: str
    payload: str
    schema: dict
    character_count: int


def prepare_evaluation(
    run: dict, spans: list[dict], expectations: dict | None, profile: dict
) -> EvaluationInput:
    metrics = code_checks(run, spans, expectations)
    evidence = compact(evidence_package(run, spans, expectations))
    payload = compact({"evidence": json.loads(evidence), "code_checks": metrics})
    schema = report_schema(spans)
    character_count = (
        len(payload) + len(profile["instructions"]) + len(compact(schema)) + 300
    )
    return EvaluationInput(
        metrics,
        hashlib.sha256(evidence.encode()).hexdigest(),
        payload,
        schema,
        character_count,
    )
