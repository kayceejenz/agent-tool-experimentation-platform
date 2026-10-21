"""Tool-use metrics for a reference with exactly one expected call."""


def same_json(expected, actual):
    # JSON numbers can use different representations; booleans are not numbers.
    if isinstance(expected, bool) or isinstance(actual, bool):
        return type(expected) is type(actual) and expected == actual
    if isinstance(expected, dict) and isinstance(actual, dict):
        return expected.keys() == actual.keys() and all(
            same_json(value, actual[key]) for key, value in expected.items()
        )
    if isinstance(expected, list) and isinstance(actual, list):
        return len(expected) == len(actual) and all(
            same_json(a, b) for a, b in zip(expected, actual, strict=True)
        )
    return expected == actual


def argument_score(expected, actual, schema):
    defaults = {
        key: value["default"]
        for key, value in schema.get("properties", {}).items()
        if "default" in value
    }
    # Only supplied fields count; unrelated defaults cannot inflate the score.
    keys = expected.keys() | {
        key
        for key, value in actual.items()
        if key in expected or key not in defaults or not same_json(value, defaults[key])
    }
    matched = sum(
        (key in expected or key in defaults)
        and (key in actual or key in defaults)
        and same_json(
            expected.get(key, defaults.get(key)), actual.get(key, defaults.get(key))
        )
        for key in keys
    )
    return {
        "matched": matched,
        "total": len(keys),
        "accuracy": 100 * matched / len(keys) if keys else 100.0,
    }


def score_call(reference, calls):
    selected = [c for c in calls if str(c.get("tool_id")) == str(reference["tool_id"])]
    best = max(
        (
            argument_score(
                reference["arguments"], c["inputs"], reference.get("input_schema") or {}
            )
            for c in selected
        ),
        key=lambda result: result["accuracy"],
        default=None,
    )
    return {
        "actual_count": len(calls),
        "matched_count": int(bool(selected)),
        "arguments_correct": best["accuracy"] == 100 if best else None,
        "argument_accuracy": best["accuracy"] if best else None,
        "matched_arguments": best["matched"] if best else None,
        "total_arguments": best["total"] if best else None,
    }


def percentage(numerator, denominator):
    return 100 * numerator / denominator if denominator else None


def totals(scores):
    matched = sum(s["matched_count"] for s in scores)
    actual = sum(s["actual_count"] for s in scores)
    accuracy = sum(s["argument_accuracy"] or 0 for s in scores)
    return {
        "scored": len(scores),
        "precision": percentage(matched, actual),
        "recall": percentage(matched, len(scores)),
        "arguments": accuracy / matched if matched else None,
    }


def model_performance(runs):
    """Aggregate finished benchmark runs by agent, including retries."""
    groups = {}
    for run in runs:
        key = run["agent_id"]
        groups.setdefault(key, []).append(run)
    items = []
    for agent_id, rows in groups.items():
        metrics = totals([score_call(row, row["calls"]) for row in rows])
        latencies = [row["latency_ms"] for row in rows if row["latency_ms"] is not None]
        items.append(
            {
                "agent_id": str(agent_id),
                "agent_name": rows[-1]["agent_name"],
                "runs": len(rows),
                "questions": len({row["benchmark_id"] for row in rows}),
                "completed": sum(row["status"] == "completed" for row in rows),
                "completion_rate": percentage(
                    sum(row["status"] == "completed" for row in rows), len(rows)
                ),
                "precision": metrics["precision"],
                "recall": metrics["recall"],
                "argument_accuracy": metrics["arguments"],
                "latency_ms": sum(latencies) / len(latencies) if latencies else None,
            }
        )
    return sorted(
        items,
        key=lambda row: (
            -(row["recall"] or 0),
            -(row["argument_accuracy"] or 0),
            -row["completion_rate"],
            row["latency_ms"] if row["latency_ms"] is not None else float("inf"),
            row["agent_name"],
            row["agent_id"],
        ),
    )
