from modules.evaluations.dtos.evaluation_dto import (
    CheckFinding,
    CriticalFailure,
    Report,
)
from modules.evaluations.helpers.rubric import DIMENSIONS


def validate_report(value, spans, metrics):
    report = Report.model_validate(value)
    if {c.name for c in report.checks} != set(DIMENSIONS):
        raise ValueError("Missing or duplicate evaluation dimensions")
    if report.task_outcome != "unknown" and not report.requirements:
        raise ValueError("Missing requirement assessment")
    allowed = {str(s["id"]) for s in spans} | {"request", "final_answer"}
    for finding in [*report.requirements, *report.checks, *report.critical_failures]:
        if any(ref not in allowed for ref in finding.evidence_refs):
            raise ValueError("Unknown evidence reference")
        if (
            getattr(finding, "status", "fail") in ("fail", "partial")
            and not finding.evidence_refs
        ):
            raise ValueError("Unsupported finding")
    for assertion in metrics["assertions"]:
        if assertion["name"] == "forbidden_tools" and assertion["status"] == "fail":
            report.critical_failures.append(
                CriticalFailure(
                    name="forbidden_tool",
                    reason="The execution called a tool forbidden by the benchmark constraints.",
                    evidence_refs=assertion["evidence_refs"],
                )
            )
    # Derive a consistent overall verdict; never let a judge hide a failed check.
    statuses = {c.status for c in [*report.requirements, *report.checks]}
    failed_assertions = [a for a in metrics["assertions"] if a["status"] == "fail"]
    if (
        report.critical_failures
        or failed_assertions
        or "fail" in statuses
        or report.task_outcome == "failed"
    ):
        report.overall_verdict = "fail"
    elif "partial" in statuses or report.task_outcome in ("partial", "blocked"):
        report.overall_verdict = "partial"
    elif "unknown" in statuses or report.task_outcome == "unknown":
        report.overall_verdict = "unknown"
    else:
        report.overall_verdict = "pass"
    return report.model_dump(mode="json")


def unknown_report(reason):
    return Report(
        task_outcome="unknown",
        overall_verdict="unknown",
        requirements=[],
        checks=[
            CheckFinding(name=name, status="unknown", reason=reason, evidence_refs=[])
            for name in DIMENSIONS
        ],
        critical_failures=[],
        limitations=[reason],
    ).model_dump()
