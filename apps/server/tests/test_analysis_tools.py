import asyncio
from uuid import uuid4

import pytest
from langchain_core.messages import AIMessage
from pydantic import ValidationError

from integrations.agents.runtime_errors import RuntimeStop
from integrations.sandbox.tools import WorkspaceTools, tool_definitions
from modules.executions.dtos.execution_dto import StartExecution
from test_agent_runtime import fixture


def test_analysis_request_contract_and_schema_versions():
    body = dict(revision=1, request_id=uuid4(), input="Inspect data")
    assert StartExecution(**body).analysis is None
    assert StartExecution(**body, analysis={"dataset_id": uuid4()}).analysis
    for extra in (
        {"analysis": {"dataset_id": uuid4(), "image": "host"}},
        {"analysis": {"dataset_id": uuid4()}, "benchmark_id": uuid4()},
    ):
        with pytest.raises(ValidationError):
            StartExecution(**body, **extra)
    tools = tool_definitions()
    tools[0]["definition"]["input_schema"]["properties"]["injected"] = {}
    assert not tool_definitions()[0]["definition"]["input_schema"]["properties"]
    assert all(tool["source"] == "builtin" and tool["revision"] == 1 for tool in tools)


def test_workspace_tool_invalid_arguments_do_not_execute():
    async def scenario():
        workspace = WorkspaceTools({}, None, None)
        for name, arguments in [
            ("read_file", {"path": "/etc/passwd"}),
            ("read_file", {"path": "/input/../etc/passwd"}),
            ("execute_python", {"code": "print(1)", "unexpected": 1}),
        ]:
            tool = next(t for t in tool_definitions() if t["name"] == name)
            assert (await workspace.execute(tool, arguments))["status"] == "invalid"

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "outcome", ["success", "prepare_error", "tool_timeout", "cancelled"]
)
def test_analysis_runtime_lifecycle_keeps_mcp_separate(monkeypatch, outcome):
    from integrations.agents import langchain_runtime

    calls = []

    class FakeWorkspace:
        def __init__(self, *args):
            pass

        async def prepare(self):
            calls.append("prepare")
            if outcome == "prepare_error":
                raise RuntimeStop("dataset_unavailable")

        async def execute(self, tool, arguments):
            calls.append(tool["name"])
            if outcome == "tool_timeout":
                raise RuntimeStop("sandbox_timeout")
            if outcome == "cancelled":
                await asyncio.sleep(30)
            return {"status": "success", "result": {"files": []}}

        async def finish(self, collect=False):
            calls.append(("finish", collect))

    monkeypatch.setattr(langchain_runtime, "WorkspaceTools", FakeWorkspace)
    message = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "workspace_list_files",
                "args": {},
                "id": "list",
                "type": "tool_call",
            }
        ],
    )
    run, model, repo, executor, runtime = fixture([message, AIMessage(content="Done")])
    run["snapshot"]["analysis"] = {"dataset": {"id": str(uuid4())}}
    run["snapshot"]["builtin_tools"] = tool_definitions()

    async def execute():
        if outcome != "cancelled":
            await runtime.execute(run)
            return
        task = asyncio.create_task(runtime.execute(run))
        while "list_files" not in calls:
            await asyncio.sleep(0.001)
        task.cancel()
        await task

    asyncio.run(execute())
    assert not executor.calls
    assert calls[0] == "prepare" and calls[-1] == ("finish", outcome == "success")
    assert repo.result["status"] == (
        "completed"
        if outcome == "success"
        else "interrupted" if outcome == "cancelled" else "failed"
    )
    if outcome != "prepare_error":
        tool_span = next(span for span in repo.spans if span["kind"] == "tool")
        assert tool_span["tool_id"] is None and tool_span["tool_revision"] == 1


def test_python_validation_explains_extra_argument_and_print_requirement():
    async def scenario():
        workspace = WorkspaceTools({}, None, None)
        tool = next(t for t in tool_definitions() if t["name"] == "execute_python")
        result = await workspace.execute(tool, {"code": "1+1", "max_bytes": 200000})
        assert result["status"] == "invalid"
        assert "max_bytes" in result["result"]["hint"]
        assert "print()" in result["result"]["hint"]
        assert list(result["result"]["input_schema"]["properties"]) == ["code"]

    asyncio.run(scenario())


def test_runtime_can_recover_from_extra_python_argument_within_budget(monkeypatch):
    from integrations.agents import langchain_runtime
    from integrations.sandbox.runner import CommandResult

    executed = []

    class Session:
        async def execute(self, code):
            executed.append(code)
            return CommandResult("success", 0, "2\n", "", False, False, 1)

    class Tools(WorkspaceTools):
        async def prepare(self):
            self.session = Session()

        async def finish(self, collect=False):
            pass

    monkeypatch.setattr(langchain_runtime, "WorkspaceTools", Tools)

    def call(arguments, identifier):
        return AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "workspace_execute_python",
                    "args": arguments,
                    "id": identifier,
                    "type": "tool_call",
                }
            ],
        )

    run, model, repo, executor, runtime = fixture(
        [
            call({"code": "1+1", "max_bytes": 200000}, "invalid"),
            call({"code": "print(1+1)"}, "corrected"),
            AIMessage(content="The result is 2."),
        ],
        limits={"max_tool_calls": 2, "max_turns": 3},
    )
    run["snapshot"]["analysis"] = {"dataset": {"id": str(uuid4())}}
    run["snapshot"]["builtin_tools"] = tool_definitions()
    asyncio.run(runtime.execute(run))
    assert repo.result["status"] == "completed"
    assert executed == ["print(1+1)"]
    spans = [span for span in repo.spans if span["kind"] == "tool"]
    assert "max_bytes" in spans[0]["outputs"]["result"]["hint"]
    assert spans[1]["outputs"]["remaining_tool_calls"] == 0
    assert "No tool calls remain" in spans[1]["outputs"]["budget_hint"]
