from uuid import uuid4

import pytest
from integrations.agents.langchain_runtime import LangChainRuntime
from langchain_core.messages import AIMessage
from pydantic import SecretStr
from test_agent_runtime import ScriptedModel
from test_agents_integration import prompts
from test_mcp_connections_integration import TOKEN, query
from test_tools_integration import setup

pytest_plugins = ["test_mcp_connections_integration"]
pytestmark = pytest.mark.integration


def ready(connections, monkeypatch):
    client, config, users, project, _ = connections
    _, _, _, owner, server, catalog, tool = setup(connections, monkeypatch)
    config.openai_api_key = SecretStr("fake-runtime-key")
    client.app.state.executions.secret = "fake-runtime-key"
    client.patch(server, headers=owner, json={"enabled": True})
    client.patch(
        catalog + "/" + tool["id"], headers=owner, json={"enabled": True, "revision": 1}
    )
    base = f"/api/v1/projects/{project}/agents"
    body = {
        "name": "Runtime agent",
        **prompts(client, project, owner),
        "model_settings": {"provider": "openai", "model": "fixture"},
        "tools": [{"id": tool["id"], "revision": 1}],
    }
    agent = client.post(base, headers=owner, json=body).json()
    client.patch(
        base + "/" + agent["id"],
        headers=owner,
        json={"enabled": True, "base_revision": 1},
    )
    return (
        client,
        config,
        users,
        project,
        agent,
        tool,
        base + "/" + agent["id"] + "/executions",
    )


def test_execution_persistence_lineage_permissions_and_idempotency(
    connections, monkeypatch
):
    client, config, users, project, agent, tool, url = ready(connections, monkeypatch)
    owner, editor, viewer, outsider = [u[1] for u in users]
    body = dict(revision=1, request_id=str(uuid4()), input="Find monthly sales")
    assert client.post(url, headers=viewer, json=body).status_code == 403
    assert client.post(url, headers=outsider, json=body).status_code == 404
    started = client.post(url, headers=owner, json=body)
    assert started.status_code == 202, started.text
    run_id = started.json()["id"]
    assert client.post(url, headers=owner, json=body).json()["id"] == run_id
    assert (
        client.post(
            url, headers=owner, json={**body, "input": "Another task"}
        ).status_code
        == 409
    )
    repo = client.app.state.executions

    async def process():
        run = await repo.claim()
        alias = run["snapshot"]["tools"][0]["alias"]
        model = ScriptedModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": alias,
                            "args": {"month": 10},
                            "id": "call-sales",
                            "type": "tool_call",
                        }
                    ],
                ),
                AIMessage(content="Sales are 42"),
            ]
        )
        runtime = LangChainRuntime(
            repo, client.app.state.tools, config, lambda _: model
        )
        await runtime.execute(run)

    async def remote(*args):
        return {
            "content": [
                {"type": "text", "text": '{"sales":42,"token":"demo-secret-token"}'}
            ],
            "isError": False,
        }

    monkeypatch.setattr("modules.tools.services.tool_service.execute_tool", remote)
    client.portal.call(process)
    detail_url = f"/api/v1/projects/{project}/executions/{run_id}"
    response = client.get(detail_url, headers=viewer)
    assert response.status_code == 200, response.text
    run = response.json()
    assert run["status"] == "completed", run
    assert run["final_answer"] == "Sales are 42"
    assert TOKEN not in response.text and "fake-runtime-key" not in response.text
    first, call, final = run["spans"]
    assert [s["kind"] for s in run["spans"]] == ["model", "tool", "model"]
    assert call["parent_id"] == first["id"] and call["call_id"] == "call-sales"
    assert call["tool_id"] == tool["id"] and call["tool_revision"] == 1
    assert call["tool_execution_id"]
    assert (
        query(
            config,
            "SELECT status FROM agent_platform.tool_executions WHERE id=%s",
            (call["tool_execution_id"],),
        )[0][0]
        == "success"
    )
    assert final["context_span_ids"] == [call["id"]]
    assert run["snapshot"]["limits"]["max_output_tokens"] == 2048
    assert client.get(detail_url, headers=outsider).status_code == 404
    assert client.post(detail_url + "/cancel", headers=viewer).status_code == 403
    assert client.get(url, headers=editor).json()["items"][0]["id"] == run_id
    with pytest.raises(Exception):
        query(
            config,
            "UPDATE agent_platform.execution_spans SET parent_id=%s WHERE id=%s",
            (uuid4(), call["id"]),
        )


def test_cancel_queue_and_interrupted_claim_recovery(connections, monkeypatch):
    client, config, users, project, agent, tool, url = ready(connections, monkeypatch)
    owner = users[0][1]

    def start():
        result = client.post(
            url,
            headers=owner,
            json=dict(revision=1, request_id=str(uuid4()), input="Task"),
        )
        assert result.status_code == 202, result.text
        return result.json()["id"]

    cancelled = start()
    detail = f"/api/v1/projects/{project}/executions/{cancelled}"
    assert (
        client.post(detail + "/cancel", headers=owner).json()["status"] == "cancelled"
    )
    assert client.portal.call(client.app.state.executions.claim) is None
    interrupted = start()
    run = client.portal.call(client.app.state.executions.claim)
    assert str(run["id"]) == interrupted
    query(
        config,
        "UPDATE agent_platform.agent_executions SET heartbeat_at=now()-interval '1 minute' WHERE id=%s",
        (interrupted,),
    )
    assert client.portal.call(client.app.state.executions.claim) is None
    result = client.get(
        f"/api/v1/projects/{project}/executions/{interrupted}", headers=owner
    ).json()
    assert (
        result["status"] == "interrupted"
        and result["termination_reason"] == "worker_interrupted"
    )


def test_live_disablement_blocks_snapshotted_tool(connections, monkeypatch):
    client, config, users, project, agent, tool, url = ready(connections, monkeypatch)
    owner = users[0][1]
    result = client.post(
        url, headers=owner, json=dict(revision=1, request_id=str(uuid4()), input="Task")
    )
    assert result.status_code == 202
    run = client.portal.call(client.app.state.executions.claim)
    client.patch(
        f"/api/v1/projects/{project}/tools/{tool['id']}",
        headers=owner,
        json={"enabled": False, "revision": 1},
    )
    model = ScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": run["snapshot"]["tools"][0]["alias"],
                        "args": {"month": 10},
                        "id": "blocked",
                        "type": "tool_call",
                    }
                ],
            )
        ]
    )
    runtime = LangChainRuntime(
        client.app.state.executions, client.app.state.tools, config, lambda _: model
    )
    client.portal.call(runtime.execute, run)
    detail = client.get(
        f"/api/v1/projects/{project}/executions/{run['id']}", headers=owner
    ).json()
    assert detail["termination_reason"] == "tool_unavailable"
    assert detail["spans"][1]["status"] == "blocked"
    assert not query(config, "SELECT id FROM agent_platform.tool_executions")


def test_timeout_preserves_unknown_executor_link(connections, monkeypatch):
    import asyncio

    client, config, users, project, agent, tool, url = ready(connections, monkeypatch)
    owner = users[0][1]
    started = client.post(
        url, headers=owner, json=dict(revision=1, request_id=str(uuid4()), input="Task")
    )
    assert started.status_code == 202
    run = client.portal.call(client.app.state.executions.claim)
    run["snapshot"]["limits"]["timeout_seconds"] = 1
    model = ScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": run["snapshot"]["tools"][0]["alias"],
                        "args": {"month": 10},
                        "id": "timeout-call",
                        "type": "tool_call",
                    }
                ],
            )
        ]
    )

    async def slow_remote(*args):
        await asyncio.sleep(5)

    monkeypatch.setattr("modules.tools.services.tool_service.execute_tool", slow_remote)
    runtime = LangChainRuntime(
        client.app.state.executions, client.app.state.tools, config, lambda _: model
    )
    client.portal.call(runtime.execute, run)
    detail = client.get(
        f"/api/v1/projects/{project}/executions/{run['id']}", headers=owner
    ).json()
    assert detail["termination_reason"] == "timeout"
    span = detail["spans"][1]
    assert span["status"] == "unknown"
    assert span["tool_execution_id"]
    assert (
        query(
            config,
            "SELECT status FROM agent_platform.tool_executions WHERE id=%s",
            (span["tool_execution_id"],),
        )[0][0]
        == "unknown"
    )


def test_worker_cancels_inflight_model_with_terminal_evidence(connections, monkeypatch):
    import asyncio

    from modules.executions.services.worker import supervise

    client, config, users, project, agent, tool, url = ready(connections, monkeypatch)
    owner = users[0][1]
    result = client.post(
        url, headers=owner, json=dict(revision=1, request_id=str(uuid4()), input="Task")
    )
    assert result.status_code == 202
    repo = client.app.state.executions
    run = client.portal.call(repo.claim)

    class SlowModel(ScriptedModel):
        async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
            await asyncio.sleep(20)

    runtime = LangChainRuntime(
        repo, client.app.state.tools, config, lambda _: SlowModel(responses=[])
    )

    async def process():
        task = asyncio.create_task(supervise(runtime, repo, run))
        await asyncio.sleep(0.1)
        await repo.cancel(run["user_id"], run["project_id"], run["id"])
        await task

    client.portal.call(process)
    detail = client.get(
        f"/api/v1/projects/{project}/executions/{run['id']}", headers=owner
    ).json()
    assert (
        detail["status"] == "cancelled" and detail["termination_reason"] == "cancelled"
    )
    assert detail["spans"][0]["status"] == "unknown"
