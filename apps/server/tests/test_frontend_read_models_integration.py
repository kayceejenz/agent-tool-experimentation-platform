from uuid import UUID, uuid4

import pytest
from test_executions_integration import ready
from test_mcp_connections_integration import query
from test_tools_integration import setup

pytest_plugins = ["test_mcp_connections_integration"]
pytestmark = pytest.mark.integration


def test_compact_execution_and_lazy_trace_preserve_permissions(
    connections, monkeypatch
):
    client, config, users, project, agent, tool, url = ready(connections, monkeypatch)
    owner, editor, viewer, outsider = [user[1] for user in users]
    started = client.post(
        url,
        headers=owner,
        json={
            "revision": 1,
            "request_id": str(uuid4()),
            "input": "Inspect a large trace",
        },
    )
    assert started.status_code == 202
    identifier = started.json()["id"]
    repo = client.app.state.executions

    async def record():
        ids = []
        for index in range(52):
            span_id = await repo.begin_span(
                UUID(identifier),
                kind="model",
                name=f"Step {index}",
                inputs={"large": "x" * 20000},
            )
            await repo.end_span(span_id, "success", outputs={"answer": "y" * 20000})
            ids.append(str(span_id))
        return ids

    ids = client.portal.call(record)
    base = f"/api/v1/projects/{project}/executions/{identifier}"
    status = client.get(base + "?view=status", headers=owner)
    assert status.status_code == 200
    assert status.json()["model_turns"] == 52
    assert not {"input", "snapshot", "spans"} & status.json().keys()
    assert len(status.content) < 2000
    summary = client.get(base + "?view=summary", headers=viewer).json()
    assert summary["input"] == "Inspect a large trace"
    assert "spans" not in summary and "snapshot" not in summary
    first = client.get(base + "/spans", headers=owner).json()
    assert len(first["items"]) == 50 and first["next_offset"] == 50
    assert all(
        "inputs" not in span and "outputs" not in span for span in first["items"]
    )
    assert (
        len(client.get(base + "/spans?offset=50", headers=owner).json()["items"]) == 2
    )
    payload = client.get(base + "/spans/" + ids[0], headers=viewer).json()
    assert len(payload["inputs"]["large"]) == 20000
    assert "snapshot" in client.get(base + "/snapshot", headers=owner).json()
    for suffix in ["?view=status", "/spans", "/spans/" + ids[0], "/snapshot"]:
        assert client.get(base + suffix, headers=outsider).status_code == 404
    other = client.post(
        url,
        headers=owner,
        json={"revision": 1, "request_id": str(uuid4()), "input": "Other run"},
    ).json()["id"]
    assert (
        client.get(
            f"/api/v1/projects/{project}/executions/{other}/spans/{ids[0]}",
            headers=owner,
        ).status_code
        == 404
    )
    assert client.get(base + "/spans?offset=-1", headers=owner).status_code == 422


def test_searchable_tool_summaries_and_user_scoped_operation_lookup(
    connections, monkeypatch
):
    client, config, users, owner, server, catalog, tool = setup(
        connections, monkeypatch
    )
    listed = client.get(catalog + "?summary=true&q=SAL", headers=owner).json()
    assert len(listed["items"]) == 1
    assert listed["items"][0]["description"] == "Monthly sales"
    assert "definition" not in listed["items"][0]
    assert client.get(catalog + "?q=nonexistent", headers=owner).json()["items"] == []
    assert client.get(catalog + "?summary=true", headers=users[3][1]).status_code == 404
    item = catalog + "/" + tool["id"]
    assert "definition" in client.get(item, headers=owner).json()
    client.patch(server, headers=owner, json={"enabled": True})
    client.patch(item, headers=owner, json={"enabled": True, "revision": 1})
    dispatched = 0

    async def execute(*args):
        nonlocal dispatched
        dispatched += 1
        return {"content": [{"type": "text", "text": "ok"}], "isError": False}

    monkeypatch.setattr("modules.tools.services.tool_service.execute_tool", execute)
    request_id = str(uuid4())
    result = client.post(
        item + "/executions",
        headers=owner,
        json={"revision": 1, "arguments": {"month": 10}, "request_id": request_id},
    )
    assert result.status_code == 200
    operation = item + "/executions/requests/" + request_id
    assert client.get(operation, headers=owner).json()["id"] == result.json()["id"]
    assert client.get(operation, headers=users[1][1]).status_code == 404
    assert client.get(operation, headers=users[3][1]).status_code == 404
    assert dispatched == 1


def test_prompt_search_matches_current_revision_and_rejects_oversized_query(
    connections,
):
    client, config, users, project, _ = connections
    owner = users[0][1]
    url = f"/api/v1/projects/{project}/prompts"
    client.post(
        url,
        headers=owner,
        json={
            "name": "Customer support",
            "type": "system",
            "content": "Help customers",
        },
    )
    client.post(
        url,
        headers=owner,
        json={"name": "Invoice helper", "type": "agent", "content": "Draft invoices"},
    )
    result = client.get(url + "?type=system&q=SUPPORT", headers=owner).json()
    assert [item["name"] for item in result["items"]] == ["Customer support"]
    assert client.get(url + "?q=missing", headers=owner).json()["items"] == []
    assert client.get(url + "?q=" + "a" * 161, headers=owner).status_code == 422
    assert client.get(url + "?q=support", headers=users[3][1]).status_code == 404
