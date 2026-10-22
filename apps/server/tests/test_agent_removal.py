from uuid import uuid4

import pytest
from test_executions_integration import ready
from test_mcp_connections_integration import query

pytest_plugins = ["test_mcp_connections_integration"]
pytestmark = pytest.mark.integration


def test_remove_agent_preserves_history_and_checks_pending_runs(
    connections, monkeypatch
):
    client, config, users, project, agent, tool, run_url = ready(
        connections, monkeypatch
    )
    owner, _, viewer, outsider = [user[1] for user in users]
    url = f"/api/v1/projects/{project}/agents/{agent['id']}"
    assert client.delete(url, headers=viewer).status_code == 403
    assert client.delete(url, headers=outsider).status_code == 404
    run = client.post(
        run_url,
        headers=owner,
        json={
            "request_id": str(uuid4()),
            "revision": agent["revision"],
            "input": "Test removal",
        },
    )
    assert run.status_code == 202
    assert client.delete(url, headers=owner).status_code == 409
    execution_url = f"/api/v1/projects/{project}/executions/{run.json()['id']}"
    assert client.post(execution_url + "/cancel", headers=owner).status_code == 200
    assert client.delete(url, headers=owner).json() == {"removed": True}
    assert client.delete(url, headers=owner).status_code == 200
    assert client.get(url, headers=owner).status_code == 404
    assert (
        client.get(f"/api/v1/projects/{project}/agents", headers=owner).json()["items"]
        == []
    )
    assert client.get(execution_url, headers=owner).status_code == 200
    assert (
        query(
            config,
            "SELECT count(*) FROM agent_platform.agent_revisions WHERE agent_id=%s",
            (agent["id"],),
        )[0][0]
        >= 1
    )
