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


def test_partial_credit_and_default_equivalence():
    reference = {
        "tool_id": "products",
        "arguments": {"max_price": 50, "in_stock": True, "limit": 5},
        "input_schema": {
            "properties": {
                "in_stock": {"default": True},
                "offset": {"default": 0},
                "region": {"default": None},
                "query": {"default": ""},
            }
        },
    }

    def score(inputs):
        return score_call(reference, [{"tool_id": "products", "inputs": inputs}])

    partial = score({"max_price": 50, "in_stock": True, "limit": 10})
    assert partial["argument_accuracy"] == 200 / 3
    assert (
        score({"max_price": 50, "in_stock": True, "limit": 10, "offset": 0})[
            "argument_accuracy"
        ]
        == 200 / 3
    )
    assert partial["matched_arguments"] == 2
    assert partial["total_arguments"] == 3
    assert totals([partial])["arguments"] == 200 / 3
    assert score({"max_price": 50, "limit": 5})["argument_accuracy"] == 100
    assert (
        score({"max_price": 50, "limit": 5, "region": None, "offset": 0})[
            "argument_accuracy"
        ]
        == 100
    )
    assert (
        score({"max_price": 50, "limit": 5, "unknown": None})["argument_accuracy"] == 75
    )
    assert (
        score({"max_price": 50, "limit": 5, "query": "shoes"})["argument_accuracy"]
        == 75
    )
    assert score({"max_price": 100, "limit": 5})["argument_accuracy"] == 200 / 3


def test_missing_fields_nested_values_and_empty_arguments():
    reference = {
        "tool_id": "sales",
        "arguments": {"month": 10, "filters": {"regions": ["London", "Wales"]}},
    }
    result = score_call(reference, [{"tool_id": "sales", "inputs": {"month": 10}}])
    assert result["argument_accuracy"] == 50
    assert (
        score_call(
            {"tool_id": "sales", "arguments": {}}, [{"tool_id": "sales", "inputs": {}}]
        )["argument_accuracy"]
        == 100
    )
    assert score_call(reference, [call("other")])["argument_accuracy"] is None
    assert (
        score_call(
            reference, [call(), {"tool_id": "sales", "inputs": reference["arguments"]}]
        )["argument_accuracy"]
        == 100
    )


def test_model_performance_includes_failures_and_partial_accuracy():
    from modules.benchmarks.helpers.scoring import model_performance

    base = {
        "agent_id": "agent-one",
        "agent_name": "Baseline",
        "benchmark_id": "one",
        "tool_id": "sales",
        "arguments": {"month": 10, "limit": 5},
        "input_schema": {},
    }
    rows = [
        base
        | {
            "status": "completed",
            "latency_ms": 1000,
            "calls": [{"tool_id": "sales", "inputs": {"month": 10, "limit": 10}}],
        },
        base | {"status": "failed", "latency_ms": 3000, "calls": []},
    ]
    result = model_performance(rows)[0]
    assert result["runs"] == 2
    assert result["questions"] == 1
    assert result["precision"] == 100
    assert result["recall"] == 50
    assert result["argument_accuracy"] == 50
    assert result["completion_rate"] == 50
    assert result["latency_ms"] == 2000
    assert model_performance([]) == []


def test_performance_keeps_agents_using_same_model_separate():
    from modules.benchmarks.helpers.scoring import model_performance

    row = {
        "agent_id": "one",
        "agent_name": "First agent",
        "benchmark_id": "question",
        "tool_id": "sales",
        "arguments": {},
        "status": "completed",
        "latency_ms": 1000,
        "calls": [],
        "model": "mini",
    }
    items = model_performance(
        [row, row | {"agent_id": "two", "agent_name": "Second agent"}]
    )
    assert len(items) == 2
    assert {item["agent_name"] for item in items} == {"First agent", "Second agent"}
