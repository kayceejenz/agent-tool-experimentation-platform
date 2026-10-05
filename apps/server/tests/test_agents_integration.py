from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest
from test_mcp_connections_integration import query
from test_tools_integration import DEFINITION, setup

pytest_plugins = ["test_mcp_connections_integration"]

pytestmark = pytest.mark.integration


def prompts(client, project, owner):
    refs = {}
    for kind in ("system", "agent"):
        result = client.post(
            f"/api/v1/projects/{project}/prompts",
            headers=owner,
            json={"name": kind, "type": kind, "content": "Original instructions"},
        )
        assert result.status_code == 201
        refs[kind + "_prompt"] = {"id": result.json()["id"], "revision": 1}
    return refs


def test_agent_versions_permissions_and_pins(connections):
    client, config, users, project, _ = connections
    owner, editor, viewer, outsider = [u[1] for u in users]
    base = f"/api/v1/projects/{project}/agents"
    body = {"name": "Commerce"}
    assert client.post(base, headers=viewer, json=body).status_code == 403
    assert client.get(base, headers=outsider).status_code == 404
    draft = client.post(base, headers=owner, json=body)
    assert draft.status_code == 201, draft.text
    assert not draft.json()["configuration_ready"]
    url = base + "/" + draft.json()["id"]
    assert (
        client.patch(
            url, headers=owner, json={"enabled": True, "base_revision": 1}
        ).status_code
        == 409
    )
    body.update(prompts(client, project, owner))
    body["model_settings"] = {"provider": "example", "model": "demo"}
    saved = client.post(
        url + "/revisions", headers=editor, json={**body, "base_revision": 1}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 2 and saved.json()["configuration_ready"]
    assert not saved.json()["runtime_available"]
    assert (
        client.patch(
            url, headers=viewer, json={"enabled": True, "base_revision": 2}
        ).status_code
        == 403
    )
    assert client.patch(
        url, headers=owner, json={"enabled": True, "base_revision": 2}
    ).json()["enabled"]
    assert client.post(
        url + "/revisions", headers=owner, json={**body, "base_revision": 2}
    ).json()["enabled"]
    assert (
        client.post(
            url + "/revisions", headers=owner, json={**body, "base_revision": 1}
        ).status_code
        == 409
    )
    prompt_url = (
        f"/api/v1/projects/{project}/prompts/{body['system_prompt']['id']}/revisions"
    )
    assert (
        client.post(
            prompt_url,
            headers=owner,
            json={
                "name": "system",
                "content": "Changed instructions",
                "base_revision": 1,
            },
        ).status_code
        == 200
    )
    assert (
        client.get(url, headers=viewer).json()["system_prompt"]["content"]
        == "Original instructions"
    )
    assert client.get(url, headers=outsider).status_code == 404
    assert (
        client.get(url + "/revisions/1", headers=viewer).json()["system_prompt"] is None
    )
    other = client.post(
        "/api/v1/projects", headers=owner, json={"name": "Other"}
    ).json()["id"]
    assert (
        client.post(
            f"/api/v1/projects/{other}/agents", headers=owner, json=body
        ).status_code
        == 422
    )
    assert (
        client.get(
            f"/api/v1/projects/{other}/agents/{draft.json()['id']}", headers=owner
        ).status_code
        == 404
    )
    assert (
        client.post(
            base, headers=owner, json={**body, "system_prompt": body["agent_prompt"]}
        ).status_code
        == 422
    )

    def change(index):
        return client.post(
            url + "/revisions",
            headers=users[index][1],
            json={**body, "name": f"Changed {index}", "base_revision": 2},
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(change, [0, 1])) == [200, 409]
    assert not client.get(url, headers=owner).json()["enabled"]
    assert [
        r["revision"]
        for r in client.get(url + "/revisions", headers=viewer).json()["items"]
    ] == [3, 2, 1]
    with pytest.raises(psycopg.errors.RaiseException):
        query(
            config,
            "UPDATE agent_platform.agent_revisions SET name=%s WHERE agent_id=%s",
            ("Overwrite", draft.json()["id"]),
        )
    for invalid in (
        {"name": " "},
        {"limits": {"max_turns": 0}},
        {"model_settings": {"temperature": 3}},
        {"enabled": True},
    ):
        assert (
            client.post(base, headers=owner, json={**body, **invalid}).status_code
            == 422
        )


def test_agent_tool_drift_and_pagination(connections, monkeypatch):
    client, config, users, owner, server_url, tools_url, tool = setup(
        connections, monkeypatch
    )
    project = connections[3]
    base = f"/api/v1/projects/{project}/agents"
    body = {
        "name": "Analyst",
        **prompts(client, project, owner),
        "model_settings": {"provider": "example", "model": "demo"},
        "tools": [{"id": tool["id"], "revision": 1}],
    }
    saved = client.post(base, headers=owner, json=body)
    assert saved.status_code == 201, saved.text
    url = base + "/" + saved.json()["id"]
    assert not saved.json()["configuration_ready"]
    assert (
        client.post(
            base, headers=owner, json={**body, "tools": body["tools"] * 2}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            tools_url + "/" + tool["id"],
            headers=owner,
            json={"enabled": True, "revision": 1},
        ).status_code
        == 200
    )
    assert (
        client.patch(server_url, headers=owner, json={"enabled": True}).status_code
        == 200
    )
    assert (
        client.patch(
            url, headers=owner, json={"enabled": True, "base_revision": 1}
        ).status_code
        == 200
    )

    async def changed(*args):
        return [{**DEFINITION, "description": "Changed definition"}]

    monkeypatch.setattr("modules.mcp_servers.services.server_service.probe", changed)
    assert client.post(server_url + "/discover", headers=owner).status_code == 200
    current = client.get(url, headers=owner).json()
    assert (
        current["tools"][0]["revision"] == 1
        and current["tools"][0]["latest_revision"] == 2
    )
    assert not current["configuration_ready"]
    assert any(
        "definition changed" in issue for issue in current["configuration_issues"]
    )
    assert (
        client.patch(
            url, headers=owner, json={"enabled": True, "base_revision": 1}
        ).status_code
        == 409
    )
    for index in range(20):
        assert (
            client.post(
                base, headers=owner, json={"name": f"Draft {index}"}
            ).status_code
            == 201
        )
    first = client.get(base, headers=owner).json()
    second = client.get(base + "?offset=20", headers=owner).json()
    assert len(first["items"]) == 20 and first["next_offset"] == 20
    assert len(second["items"]) == 1 and second["next_offset"] is None
