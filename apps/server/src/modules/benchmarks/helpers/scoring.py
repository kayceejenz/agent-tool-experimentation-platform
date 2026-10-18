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


def score_call(reference, calls):
    selected = [c for c in calls if str(c.get("tool_id")) == str(reference["tool_id"])]
    correct = any(same_json(reference["arguments"], c["inputs"]) for c in selected)
    return {
        "actual_count": len(calls),
        "matched_count": int(bool(selected)),
        "arguments_correct": correct if selected else None,
    }


def percentage(numerator, denominator):
    return 100 * numerator / denominator if denominator else None


def totals(scores):
    matched = sum(s["matched_count"] for s in scores)
    actual = sum(s["actual_count"] for s in scores)
    correct = sum(s["arguments_correct"] is True for s in scores)
    return {
        "scored": len(scores),
        "precision": percentage(matched, actual),
        "recall": percentage(matched, len(scores)),
        "arguments": percentage(correct, matched),
    }
