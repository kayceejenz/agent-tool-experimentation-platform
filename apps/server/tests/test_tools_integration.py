from uuid import uuid4

import pytest
from integrations.mcp.client import ProbeFailure
from test_mcp_connections_integration import TOKEN, connections, create, query

pytestmark = pytest.mark.integration
DEFINITION = {
    "name": "sales",
    "description": "Monthly sales",
    "input_schema": {
        "type": "object",
        "properties": {"month": {"type": "integer", "minimum": 1, "maximum": 12}},
        "required": ["month"],
        "additionalProperties": False,
    },
}


def setup(connections, monkeypatch):
    client, config, users, project, path = connections
    headers = users[0][1]
    server = create(client, path, headers)

    async def discover(*args):
        return [DEFINITION]

    monkeypatch.setattr("modules.mcp_servers.services.server_service.probe", discover)
    server_url = f"{path}/{server['id']}"
    assert client.post(server_url + "/discover", headers=headers).status_code == 200
    tools_url = f"/api/v1/projects/{project}/tools"
    tool = client.get(tools_url, headers=headers).json()["items"][0]
    return client, config, users, headers, server_url, tools_url, tool


def test_catalog_revision_enablement_and_isolation(connections, monkeypatch):
    client, config, users, headers, server_url, url, tool = setup(
        connections, monkeypatch
    )
    assert not tool["enabled"] and tool["revision"] == 1
    item = url + "/" + tool["id"]
    assert (
        client.patch(
            item, headers=users[2][1], json={"enabled": True, "revision": 1}
        ).status_code
        == 403
    )
    assert client.get(url, headers=users[3][1]).status_code == 404
    assert client.patch(
        item, headers=headers, json={"enabled": True, "revision": 1}
    ).json()["enabled"]
    client.post(server_url + "/discover", headers=headers)
    same = client.get(url, headers=headers).json()["items"][0]
    assert same["id"] == tool["id"] and same["revision"] == 1 and same["enabled"]

    async def changed(*args):
        return [{**DEFINITION, "description": "Changed"}]

    monkeypatch.setattr("modules.mcp_servers.services.server_service.probe", changed)
    client.post(server_url + "/discover", headers=headers)
    updated = client.get(url, headers=headers).json()["items"][0]
    assert updated["revision"] == 2 and not updated["enabled"]
    assert (
        client.patch(
            item, headers=headers, json={"enabled": True, "revision": 1}
        ).status_code
        == 409
    )
    assert (
        len(
            query(
                config,
                "SELECT * FROM agent_platform.tool_revisions WHERE tool_id=%s",
                (tool["id"],),
            )
        )
        == 2
    )

    async def missing(*args):
        return []

    monkeypatch.setattr("modules.mcp_servers.services.server_service.probe", missing)
    client.post(server_url + "/discover", headers=headers)
    assert not client.get(url, headers=headers).json()["items"][0]["available"]


def test_execution_guards_history_redaction_and_no_duplicate_dispatch(
    connections, monkeypatch
):
    client, config, users, headers, server_url, url, tool = setup(
        connections, monkeypatch
    )
    item = url + "/" + tool["id"]
    run = item + "/executions"
    body = {"revision": 1, "request_id": str(uuid4()), "arguments": {"month": 10}}
    calls = []

    async def execute(endpoint, token, settings, name, arguments):
        calls.append(arguments)
        return {
            "isError": False,
            "content": [{"type": "text", "text": TOKEN}],
            "structuredContent": {"api_key": "secret", "total": 42},
        }

    monkeypatch.setattr("modules.tools.services.tool_service.execute_tool", execute)
    assert client.post(run, headers=headers, json=body).status_code == 409
    client.patch(item, headers=headers, json={"enabled": True, "revision": 1})
    assert client.post(run, headers=headers, json=body).status_code == 409
    client.patch(server_url, headers=headers, json={"enabled": True})
    assert client.post(run, headers=users[2][1], json=body).status_code == 403
    assert (
        client.post(
            run, headers=headers, json={**body, "arguments": {"month": 13}}
        ).status_code
        == 422
    )
    assert not calls
    response = client.post(run, headers=headers, json=body)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "success" and TOKEN not in response.text
    assert response.json()["result"]["structuredContent"]["api_key"] == "[redacted]"
    duplicate = client.post(run, headers=headers, json=body)
    assert duplicate.json()["id"] == response.json()["id"] and len(calls) == 1
    assert (
        client.post(
            run, headers=headers, json={**body, "arguments": {"month": 9}}
        ).status_code
        == 409
    )
    history = client.get(run, headers=users[2][1]).json()["items"]
    assert len(history) == 1 and history[0]["inputs"] == {"month": 10}
    assert client.get(run, headers=users[3][1]).status_code == 404

    async def timeout(*args):
        raise ProbeFailure("timeout")

    monkeypatch.setattr("modules.tools.services.tool_service.execute_tool", timeout)
    timed = client.post(run, headers=headers, json={**body, "request_id": str(uuid4())})
    assert (
        timed.json()["status"] == "unknown" and timed.json()["error_code"] == "timeout"
    )

    async def failure(*args):
        return {"isError": True, "content": []}

    monkeypatch.setattr("modules.tools.services.tool_service.execute_tool", failure)
    assert (
        client.post(
            run, headers=headers, json={**body, "request_id": str(uuid4())}
        ).json()["status"]
        == "tool_error"
    )
    client.patch(
        server_url,
        headers=headers,
        json={"endpoint": "http://localhost:8012/other", "credential": TOKEN},
    )
    invalidated = client.get(url, headers=headers).json()["items"][0]
    assert not invalidated["available"] and not invalidated["enabled"]
