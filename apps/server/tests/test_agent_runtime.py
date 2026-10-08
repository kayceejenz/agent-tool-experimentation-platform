import asyncio
from uuid import uuid4

import pytest
from core.settings import Settings
from integrations.agents.langchain_runtime import LangChainRuntime
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from modules.mcp_servers.models.error_model import McpConnectionError


class ScriptedModel(BaseChatModel):
    responses: list[AIMessage]
    index: int = 0
    observed: list = []

    @property
    def _llm_type(self):
        return "scripted-test"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.observed.append(messages)
        response = self.responses[self.index]
        self.index += 1
        return ChatResult(generations=[ChatGeneration(message=response)])


class MemoryRepository:
    def __init__(self):
        self.spans, self.result, self.cancelled = [], None, False

    async def check(self, run):
        return self.cancelled

    async def begin_span(self, run_id, **fields):
        identifier = uuid4()
        self.spans.append(dict(id=identifier, **fields))
        return identifier

    async def end_span(
        self, identifier, status, outputs=None, error_code=None, tool_execution_id=None
    ):
        span = next(s for s in self.spans if s["id"] == identifier)
        span.update(
            status=status,
            outputs=outputs,
            error_code=error_code,
            tool_execution_id=tool_execution_id,
        )

    async def finish(self, run_id, status, reason, answer=None):
        self.result = dict(status=status, reason=reason, answer=answer)


class Executor:
    def __init__(self, outcomes=None):
        self.calls, self.outcomes = [], list(outcomes or [])

    async def execute(self, user, project, tool, body):
        self.calls.append((tool, body))
        if self.outcomes:
            outcome = self.outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return dict(id=uuid4(), **outcome)
        return dict(id=uuid4(), status="success", result={"price": 29}, error_code=None)


def fixture(responses, limits=None, outcomes=None, tools=2):
    definitions = [
        dict(
            id=str(uuid4()),
            revision=1,
            name="lookup",
            server_name=f"Server {i}",
            alias=f"tool_{i}",
            definition={
                "description": "Look up product",
                "input_schema": {
                    "type": "object",
                    "properties": {"sku": {"type": "string"}},
                    "required": ["sku"],
                },
            },
        )
        for i in range(tools)
    ]
    run = dict(
        id=uuid4(),
        user_id=uuid4(),
        project_id=uuid4(),
        agent_id=uuid4(),
        agent_revision=1,
        input="Find price",
        snapshot=dict(
            model_settings={"provider": "openai", "model": "test"},
            limits={
                "max_turns": 8,
                "max_tool_calls": 10,
                "timeout_seconds": 2,
                "max_output_tokens": 100,
            }
            | (limits or {}),
            system_prompt={"content": "Use tools"},
            agent_prompt={"content": "Return prices"},
            tools=definitions,
        ),
    )
    model, repo, executor = (
        ScriptedModel(responses=responses),
        MemoryRepository(),
        Executor(outcomes),
    )
    runtime = LangChainRuntime(
        repo, executor, Settings(_env_file=None), lambda _: model
    )
    return run, model, repo, executor, runtime


def call(alias="tool_0", identifier="c1"):
    return AIMessage(
        content="",
        tool_calls=[
            {
                "name": alias,
                "id": identifier,
                "args": {"sku": "ABC"},
                "type": "tool_call",
            }
        ],
    )


def execute(responses, **kwargs):
    run, model, repo, executor, runtime = fixture(responses, **kwargs)
    asyncio.run(runtime.execute(run))
    return run, model, repo, executor


def test_no_tool_final_answer_and_reasoning_excluded():
    _, _, repo, executor = execute(
        [
            AIMessage(
                content=[
                    {"type": "reasoning", "reasoning": "private"},
                    {"type": "text", "text": "Hello"},
                ]
            )
        ],
        tools=0,
    )
    assert repo.result == dict(
        status="completed", reason="final_answer", answer="Hello"
    )
    assert not executor.calls
    assert "private" not in str(repo.spans)


def test_dependent_cross_server_calls_have_parents_and_observed_context():
    _, model, repo, executor = execute(
        [call(), call("tool_1", "c2"), AIMessage(content="£29")]
    )
    turns = [s for s in repo.spans if s["kind"] == "model"]
    calls = [s for s in repo.spans if s["kind"] == "tool"]
    assert [s["parent_id"] for s in calls] == [t["id"] for t in turns[:2]]
    assert turns[0]["context_span_ids"] == []
    assert turns[1]["context_span_ids"] == [calls[0]["id"]]
    assert turns[2]["context_span_ids"] == [s["id"] for s in calls]
    assert calls[1]["context_span_ids"] == [calls[0]["id"]]
    assert all(s["tool_execution_id"] for s in calls)
    assert executor.calls[0][0] != executor.calls[1][0]
    assert executor.calls[0][1].request_id != executor.calls[1][1].request_id
    assert model.observed[1][-1].tool_call_id == "c1"
    assert repo.result["status"] == "completed"


@pytest.mark.parametrize(
    "budget, reason, dispatched",
    [({"max_turns": 1}, "max_turns", 1), ({"max_tool_calls": 0}, "max_tool_calls", 0)],
)
def test_limits_stop_before_extra_dispatch(budget, reason, dispatched):
    _, model, repo, executor = execute(
        [call(), AIMessage(content="Done")], limits=budget
    )
    assert repo.result["reason"] == reason
    assert len(executor.calls) == dispatched and model.index == 1


def test_invalid_inputs_recover_and_keep_failed_evidence():
    _, _, repo, _ = execute(
        [call(), call(identifier="c2"), AIMessage(content="Done")],
        outcomes=[McpConnectionError(422, "bad arguments")],
    )
    calls = [s for s in repo.spans if s["kind"] == "tool"]
    assert [s["status"] for s in calls] == ["invalid", "success"]
    assert calls[0]["error_code"] == "invalid_arguments"
    assert repo.result["status"] == "completed"


def test_unknown_remote_outcome_stops_without_retry():
    _, model, repo, executor = execute(
        [call(), AIMessage(content="Should not run")],
        outcomes=[dict(status="unknown", result=None, error_code="timeout")],
    )
    assert repo.result["reason"] == "unknown_tool_outcome"
    assert len(executor.calls) == model.index == 1
    assert repo.spans[-1]["status"] == "unknown"


def test_unavailable_tool_blocks_run():
    _, _, repo, _ = execute([call()], outcomes=[McpConnectionError(409, "disabled")])
    assert repo.result["reason"] == "tool_unavailable"
    assert repo.spans[-1]["status"] == "blocked"


def test_duplicate_call_ids_cannot_dispatch_twice():
    _, _, repo, executor = execute([call(), call()])
    assert repo.result["reason"] == "duplicate_call_id" and len(executor.calls) == 1


def test_cancel_before_model_dispatch():
    run, model, repo, executor, runtime = fixture([AIMessage(content="No")])
    repo.cancelled = True
    asyncio.run(runtime.execute(run))
    assert model.index == 0 and not executor.calls
    assert repo.result["status"] == "cancelled"


def test_unknown_tool_never_reaches_executor():
    _, _, repo, executor = execute(
        [call("forbidden"), AIMessage(content="Cannot access it")]
    )
    assert not executor.calls
    assert repo.spans[1]["error_code"] == "tool_not_allowed"
    assert repo.result["status"] == "completed"


def test_unknown_outcome_prevents_other_calls_in_same_batch():
    batch = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "tool_0",
                "id": "batch-1",
                "args": {"sku": "ABC"},
                "type": "tool_call",
            },
            {
                "name": "tool_1",
                "id": "batch-2",
                "args": {"sku": "ABC"},
                "type": "tool_call",
            },
        ],
    )
    _, _, repo, executor = execute(
        [batch], outcomes=[dict(status="unknown", result=None, error_code="timeout")]
    )
    assert repo.result["reason"] == "unknown_tool_outcome"
    assert len(executor.calls) == 1


def test_model_failure_records_safe_error_without_provider_exception_text():
    class BrokenModel(ScriptedModel):
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            raise ValueError("provider exception containing secret-value")

    run, _, repo, executor, _ = fixture([])
    runtime = LangChainRuntime(
        repo, executor, Settings(_env_file=None), lambda _: BrokenModel(responses=[])
    )
    asyncio.run(runtime.execute(run))
    assert repo.result["reason"] == "model_error"
    assert repo.spans[0]["status"] == "error"
    assert "secret-value" not in str(repo.spans) and "secret-value" not in str(
        repo.result
    )


@pytest.mark.parametrize(
    "http_status,body,expected",
    [
        (401, {"message": "secret-value"}, "provider_authentication"),
        (400, {"error": {"message": "secret-value"}}, "invalid_model_request"),
        (
            429,
            {"code": "insufficient_quota", "message": "secret-value"},
            "provider_quota",
        ),
        (503, {"message": "secret-value"}, "provider_unavailable"),
    ],
)
def test_provider_failures_are_actionable_and_do_not_expose_payloads(
    http_status, body, expected
):
    class ProviderError(Exception):
        status_code = http_status

    error = ProviderError("private provider error")
    error.body = body

    class BrokenModel(ScriptedModel):
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            raise error

    run, _, repo, executor, _ = fixture([])
    runtime = LangChainRuntime(
        repo, executor, Settings(_env_file=None), lambda _: BrokenModel(responses=[])
    )
    asyncio.run(runtime.execute(run))
    assert repo.result["reason"] == expected
    assert repo.spans[0]["outputs"]["http_status"] == http_status
    assert "secret-value" not in str(repo.spans)
    assert not executor.calls


def test_tool_payload_compacts_duplicate_mcp_data_and_excludes_metadata():
    import json

    from integrations.agents.langchain_runtime import model_tool_result

    value = dict(
        status="success",
        error_code=None,
        result={
            "structuredContent": {"price": 29},
            "content": [
                {"type": "text", "text": '{"price": 29}'},
                {"type": "text", "text": "Price includes tax"},
            ],
            "_meta": {"internal": "private"},
            "isError": False,
        },
    )
    compact = model_tool_result(value)
    parsed = json.loads(compact)
    assert parsed["result"]["structuredContent"] == {"price": 29}
    assert parsed["result"]["content"] == [
        {"type": "text", "text": "Price includes tax"}
    ]
    assert "_meta" not in compact and "error_code" not in compact
    assert len(compact) < len(json.dumps(value))
    assert "_meta" in value["result"]


def test_tool_result_redacts_provider_key_before_model_dispatch():
    from integrations.agents.langchain_runtime import model_tool_result

    compact = model_tool_result(
        dict(
            status="success",
            result={
                "text": "accidental provider-key-value",
                "api_key": "another-secret",
            },
        ),
        "provider-key-value",
    )
    assert "provider-key-value" not in compact and "another-secret" not in compact


def test_large_tool_result_stops_before_another_model_call_and_preserves_trace():
    _, model, repo, executor = execute(
        [call(), AIMessage(content="Should not run")],
        outcomes=[
            dict(status="success", result={"data": "x" * 25_000}, error_code=None)
        ],
    )
    assert repo.result["reason"] == "tool_result_too_large"
    assert model.index == len(executor.calls) == 1
    assert len(repo.spans[-1]["outputs"]["result"]["data"]) == 25_000
    assert repo.spans[-1]["status"] == "success"


def test_context_guard_prevents_initial_provider_dispatch():
    run, model, repo, executor, runtime = fixture([AIMessage(content="Should not run")])
    run["input"] = "x" * 101_000
    asyncio.run(runtime.execute(run))
    assert repo.result["reason"] == "context_limit"
    assert model.index == 0 and not executor.calls


def test_tool_schema_size_counts_toward_context_guard():
    run, model, repo, executor, runtime = fixture([AIMessage(content="Should not run")])
    run["snapshot"]["tools"][0]["definition"]["description"] = "x" * 101_000
    asyncio.run(runtime.execute(run))
    assert repo.result["reason"] == "context_limit"
    assert model.index == 0 and not executor.calls


def test_react_ten_sequential_actions_observe_results_and_preserve_lineage():
    from modules.agents.dtos.agent_dto import Limits
    responses = [call(f'tool_{i % 3}', f'step-{i}') for i in range(10)]
    run, model, repo, executor = execute(
        [*responses, AIMessage(content='Verified all three products.')],
        tools=3, limits=Limits().model_dump(),
    )
    assert repo.result['status'] == 'completed'
    assert len(executor.calls) == 10 and model.index == 11
    turns = [span for span in repo.spans if span['kind'] == 'model']
    tools = [span for span in repo.spans if span['kind'] == 'tool']
    for i, span in enumerate(tools):
        assert span['parent_id'] == turns[i]['id']
        assert turns[i + 1]['context_span_ids'] == [s['id'] for s in tools[:i + 1]]
        assert model.observed[i + 1][-1].tool_call_id == f'step-{i}'
    system = model.observed[0][0].content
    assert 'Execution policy:' in system
    assert 'Call one tool at a time' in system
    assert '16 model turns' in system and '20 tool calls' in system
    assert run['snapshot']['system_prompt']['content'] in system
    assert run['snapshot']['agent_prompt']['content'] in system
    assert turns[-1]['inputs']['strategy'] == 'react'
    assert turns[-1]['inputs']['remaining_tool_calls'] == 10


def test_existing_saved_limits_are_used_by_react_policy():
    from integrations.agents.langchain_runtime import runtime_instructions
    run, _, _, _, _ = fixture([])
    assert '8 model turns' in runtime_instructions(run['snapshot'])
    assert '10 tool calls' in runtime_instructions(run['snapshot'])


def test_react_dependent_action_uses_observed_tool_result():
    import json

    class ObservationDrivenModel(ScriptedModel):
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            self.observed.append(messages)
            if self.index == 0:
                response = call()
            elif self.index == 1:
                observation = json.loads(messages[-1].content)
                response = AIMessage(content='', tool_calls=[{
                    'name': 'tool_1', 'id': 'dependent-call', 'type': 'tool_call',
                    'args': {'sku': observation['result']['sku']},
                }])
            else:
                observation = json.loads(messages[-1].content)
                response = AIMessage(content=f"Verified price: {observation['result']['price']}")
            self.index += 1
            return ChatResult(generations=[ChatGeneration(message=response)])

    run, _, repo, executor, _ = fixture([], outcomes=[
        dict(status='success', result={'sku': 'DISCOVERED-SKU'}, error_code=None),
        dict(status='success', result={'price': 29}, error_code=None),
    ])
    model = ObservationDrivenModel(responses=[])
    runtime = LangChainRuntime(repo, executor, Settings(_env_file=None), lambda _: model)
    asyncio.run(runtime.execute(run))
    assert executor.calls[1][1].arguments == {'sku': 'DISCOVERED-SKU'}
    assert repo.result == dict(status='completed', reason='final_answer', answer='Verified price: 29')
