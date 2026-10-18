from modules.benchmarks.helpers.scoring import same_json, score_call, totals


REFERENCE = {"tool_id": "sales", "arguments": {"month": 10}}


def call(tool="sales", month=10):
    return {"tool_id": tool, "inputs": {"month": month}}


def test_exact_call_and_aggregate_percentages():
    exact = score_call(REFERENCE, [call()])
    wrong_args = score_call(REFERENCE, [call(month=9)])
    wrong_tool = score_call(REFERENCE, [call("customers")])
    result = totals([exact, wrong_args, wrong_tool])
    assert result == {
        "scored": 3,
        "precision": 200 / 3,
        "recall": 200 / 3,
        "arguments": 50,
    }


def test_duplicates_and_unnecessary_calls_reduce_precision():
    score = score_call(REFERENCE, [call(), call(), call("customers")])
    assert score["matched_count"] == 1
    assert score["arguments_correct"] is True
    assert totals([score])["precision"] == 100 / 3
    assert totals([score])["recall"] == 100


def test_no_tool_call_has_zero_recall_and_undefined_other_metrics():
    assert totals([score_call(REFERENCE, [])]) == {
        "scored": 1,
        "precision": None,
        "recall": 0,
        "arguments": None,
    }
    assert totals([]) == {
        "scored": 0,
        "precision": None,
        "recall": None,
        "arguments": None,
    }


def test_exact_json_values_ignore_key_order_but_preserve_types_and_list_order():
    assert same_json({"a": 1, "b": [2, 3]}, {"b": [2.0, 3], "a": 1})
    assert not same_json({"a": 1}, {"a": True})
    assert not same_json({"a": 1}, {"a": "1"})
    assert not same_json({"a": 1}, {"a": 1, "b": None})
    assert not same_json([1, 2], [2, 1])
    assert not same_json([1], [1, 2])
