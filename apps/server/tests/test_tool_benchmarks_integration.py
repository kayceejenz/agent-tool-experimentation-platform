from uuid import uuid4

import pytest
from integrations.agents.langchain_runtime import LangChainRuntime
from langchain_core.messages import AIMessage
from test_agent_runtime import ScriptedModel
from test_executions_integration import ready
from test_mcp_connections_integration import query

pytest_plugins = ["test_mcp_connections_integration"]
pytestmark = pytest.mark.integration


def test_manual_reference_normal_execution_comparison_and_access(
    connections, monkeypatch
):
    client, config, users, project, agent, tool, run_url = ready(
        connections, monkeypatch
    )
    owner, _, viewer, outsider = [u[1] for u in users]
    base = f"/api/v1/projects/{project}"
    benchmark_url = base + "/benchmarks"

    async def remote(*args):
        return {"content": [{"type": "text", "text": '{"sales":42}'}], "isError": False}

    monkeypatch.setattr("modules.tools.services.tool_service.execute_tool", remote)
    response = client.post(
        base + f"/tools/{tool['id']}/executions",
        headers=owner,
        json={"revision": 1, "request_id": str(uuid4()), "arguments": {"month": 10}},
    )
    assert response.status_code == 200, response.text
    capture = response.json()
    capture_url = benchmark_url + "/captures/" + capture["id"]
    assert client.get(capture_url, headers=viewer).json()["arguments"] == {"month": 10}
    assert client.get(capture_url, headers=outsider).status_code == 404
    body = {
        "request_id": str(uuid4()),
        "capture_id": capture["id"],
        "input": "Find October sales",
    }
    assert client.post(benchmark_url, headers=viewer, json=body).status_code == 403
    saved = client.post(benchmark_url, headers=owner, json=body)
    assert saved.status_code == 201, saved.text
    benchmark = saved.json()
    assert (
        client.post(benchmark_url, headers=owner, json=body).json()["id"]
        == benchmark["id"]
    )
    assert (
        client.post(
            benchmark_url, headers=owner, json={**body, "input": "Changed"}
        ).status_code
        == 409
    )
    assert (
        client.post(
            benchmark_url,
            headers=owner,
            json={**body, "request_id": str(uuid4()), "capture_id": str(uuid4())},
        ).status_code
        == 404
    )

    run_body = {
        "revision": 1,
        "request_id": str(uuid4()),
        "input": body["input"],
        "benchmark_id": benchmark["id"],
    }
    assert (
        client.post(
            run_url, headers=owner, json={**run_body, "input": "Different question"}
        ).status_code
        == 422
    )
    run = client.post(run_url, headers=owner, json=run_body)
    assert run.status_code == 202, run.text
    run_id = run.json()["id"]
    assert client.post(run_url, headers=owner, json=run_body).json()["id"] == run_id
    assert (
        client.post(
            run_url, headers=owner, json={**run_body, "benchmark_id": None}
        ).status_code
        == 409
    )
    result_url = benchmark_url + f"?agent_id={agent['id']}"
    queued = client.get(result_url, headers=viewer).json()
    assert queued["metrics"]["scored"] == 0 and queued["items"][0]["status"] == "queued"

    async def process(month):
        claimed = await client.app.state.executions.claim()
        assert claimed["snapshot"]["evaluation_profile"]["enabled"] is False
        # The answer key is never added to the model's messages.
        assert "benchmark" not in claimed["snapshot"]
        model = ScriptedModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": claimed["snapshot"]["tools"][0]["alias"],
                            "args": {"month": month},
                            "id": "sales-call",
                            "type": "tool_call",
                        }
                    ],
                ),
                AIMessage(content="Sales are 42"),
            ]
        )
        await LangChainRuntime(
            client.app.state.executions, client.app.state.tools, config, lambda _: model
        ).execute(claimed)

    client.portal.call(process, 10)
    result = client.get(result_url, headers=viewer).json()
    assert result["metrics"] == {
        "scored": 1,
        "precision": 100,
        "recall": 100,
        "arguments": 100,
    }
    assert result["items"][0]["score"]["arguments_correct"] is True
    unfiltered = client.get(benchmark_url, headers=viewer).json()
    assert unfiltered["items"][0]["execution_id"] == run_id
    assert unfiltered["items"][0]["agent_name"] == agent["name"]
    detail_url = benchmark_url + f"/runs/{run_id}"
    detail = client.get(detail_url, headers=viewer)
    assert detail.status_code == 200
    assert detail.json()["score"]["arguments_correct"] is True
    assert detail.json()["final_answer"] == "Sales are 42"
    assert client.get(detail_url, headers=outsider).status_code == 404
    assert (
        client.get(benchmark_url + f"/runs/{uuid4()}", headers=owner).status_code == 404
    )
    agent_capture = query(
        config,
        "SELECT tool_execution_id FROM agent_platform.execution_spans WHERE execution_id=%s AND kind='tool'",
        (run_id,),
    )[0][0]
    assert (
        client.get(
            benchmark_url + f"/captures/{agent_capture}", headers=owner
        ).status_code
        == 404
    )
    assert (
        query(
            config,
            "SELECT count(*) FROM agent_platform.execution_evaluations WHERE execution_id=%s",
            (run_id,),
        )[0][0]
        == 0
    )
    assert (
        client.post(
            base + f"/executions/{run_id}/evaluations",
            headers=owner,
            json={"request_id": str(uuid4())},
        ).status_code
        == 409
    )

    again = client.post(
        run_url, headers=owner, json={**run_body, "request_id": str(uuid4())}
    )
    assert again.status_code == 202
    client.portal.call(process, 9)
    wrong = client.get(result_url, headers=owner).json()
    assert wrong["metrics"] == {
        "scored": 1,
        "precision": 100,
        "recall": 100,
        "arguments": 0,
    }
    assert wrong["items"][0]["execution_id"] == again.json()["id"]
    assert wrong["items"][0]["run_count"] == 2
    history_url = benchmark_url + f"/{benchmark['id']}/runs"
    history = client.get(history_url, headers=viewer)
    assert history.status_code == 200
    runs = history.json()["runs"]
    assert [r["execution_id"] for r in runs] == [again.json()["id"], run_id]
    assert runs[0]["score"]["arguments_correct"] is False
    assert runs[1]["score"]["arguments_correct"] is True
    assert runs[0]["latency_ms"] >= 0
    assert runs[1]["latency_ms"] >= 0
    assert runs[0]["model_settings"]["model"]
    assert client.get(history_url, headers=outsider).status_code == 404
    # Direct run pages retain their original score after a newer run replaces the list entry.
    assert (
        client.get(detail_url, headers=viewer).json()["score"]["arguments_correct"]
        is True
    )
    assert (
        client.get(benchmark_url, headers=viewer).json()["items"][0]["execution_id"]
        == again.json()["id"]
    )
    assert client.get(benchmark_url, headers=outsider).status_code == 404
    assert (
        client.get(benchmark_url + f"?agent_id={uuid4()}", headers=owner).status_code
        == 404
    )

    performance_url = benchmark_url + "/performance"
    performance = client.get(performance_url, headers=viewer)
    assert performance.status_code == 200
    model = performance.json()["items"][0]
    assert model["agent_name"] == agent["name"]
    assert model["runs"] == 2
    assert model["questions"] == 1
    assert model["argument_accuracy"] == 50
    assert model["recall"] == 100
    assert model["completion_rate"] == 100
    assert model["latency_ms"] >= 0
    assert client.get(performance_url, headers=outsider).status_code == 404
    delete_url = benchmark_url + f"/{benchmark['id']}"
    assert client.delete(delete_url, headers=viewer).status_code == 403
    assert client.delete(delete_url, headers=outsider).status_code == 404
    assert client.delete(delete_url, headers=owner).json() == {"deleted": True}
    assert client.delete(delete_url, headers=owner).status_code == 200
    assert client.get(benchmark_url, headers=owner).json()["items"] == []
    assert client.get(history_url, headers=owner).status_code == 404
    assert client.get(performance_url, headers=owner).json()["items"] == []
    assert client.get(detail_url, headers=owner).status_code == 200
    assert (
        client.post(
            run_url, headers=owner, json={**run_body, "request_id": str(uuid4())}
        ).status_code
        == 404
    )


def test_examples_are_newest_first(connections, monkeypatch):
    client, _, users, project, _, tool, _ = ready(connections, monkeypatch)
    owner = users[0][1]
    base = f"/api/v1/projects/{project}"

    async def remote(*args):
        return {"content": [], "isError": False}

    monkeypatch.setattr("modules.tools.services.tool_service.execute_tool", remote)
    capture = client.post(
        base + f"/tools/{tool['id']}/executions",
        headers=owner,
        json={"revision": 1, "request_id": str(uuid4()), "arguments": {"month": 10}},
    ).json()
    for question in ["Older question", "Newest question"]:
        response = client.post(
            base + "/benchmarks",
            headers=owner,
            json={
                "request_id": str(uuid4()),
                "capture_id": capture["id"],
                "input": question,
            },
        )
        assert response.status_code == 201
    items = client.get(base + "/benchmarks", headers=owner).json()["items"]
    assert [item["input"] for item in items] == ["Newest question", "Older question"]
