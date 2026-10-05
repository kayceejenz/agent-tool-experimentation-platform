from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest
from test_mcp_connections_integration import connections, query

pytestmark = pytest.mark.integration


def test_prompt_revisions_permissions_and_isolation(connections):
    client, config, users, project, _ = connections
    base = f"/api/v1/projects/{project}/prompts"
    owner = users[0][1]
    editor = users[1][1]
    viewer = users[2][1]
    outsider = users[3][1]
    body = {
        "name": "Commerce rules",
        "type": "system",
        "description": "Shared rules",
        "content": "Use GBP.\nKeep these instructions exactly.\n",
    }
    assert client.post(base, headers=viewer, json=body).status_code == 403
    assert client.get(base, headers=outsider).status_code == 404
    for value in ["system", "agent", "evaluation"]:
        response = client.post(base, headers=owner, json={**body, "type": value})
        assert response.status_code == 201, response.text
    prompt = response.json()
    url = base + "/" + prompt["id"]
    assert prompt["revision"] == 1 and prompt["content"] == body["content"]
    assert (
        client.get(base + "?type=system", headers=viewer).json()["items"][0]["type"]
        == "system"
    )
    updated = {k: v for k, v in body.items() if k != "type"} | {
        "content": "Evaluate only supported answers.",
        "base_revision": 1,
    }
    assert (
        client.post(url + "/revisions", headers=viewer, json=updated).status_code == 403
    )
    assert client.get(url, headers=outsider).status_code == 404
    saved = client.post(url + "/revisions", headers=editor, json=updated)
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 2
    assert (
        client.post(url + "/revisions", headers=owner, json=updated).status_code == 409
    )
    assert (
        client.get(url + "/revisions/1", headers=viewer).json()["content"]
        == body["content"]
    )
    assert client.get(url, headers=viewer).json()["content"] == updated["content"]
    history = client.get(url + "/revisions", headers=viewer).json()["items"]
    assert [r["revision"] for r in history] == [2, 1]
    assert "content" not in history[0]
    unchanged = client.post(
        url + "/revisions", headers=editor, json={**updated, "base_revision": 2}
    )
    assert unchanged.json()["revision"] == 2
    other = client.post(
        "/api/v1/projects", headers=owner, json={"name": "Other"}
    ).json()["id"]
    assert (
        client.get(
            f"/api/v1/projects/{other}/prompts/{prompt['id']}", headers=owner
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/projects/{other}/prompts/{prompt['id']}/revisions/1",
            headers=owner,
        ).status_code
        == 404
    )
    assert (
        client.post(
            url + "/revisions",
            headers=owner,
            json={**updated, "base_revision": 2, "type": "agent"},
        ).status_code
        == 422
    )
    with pytest.raises(psycopg.errors.RaiseException):
        query(
            config,
            "UPDATE agent_platform.prompt_revisions SET content=%s WHERE prompt_id=%s",
            ("Overwrite", prompt["id"]),
        )
    for invalid in [
        {"name": "  "},
        {"content": "\n\t"},
        {"type": "unknown"},
        {"content": "x" * 32001},
    ]:
        assert (
            client.post(base, headers=owner, json={**body, **invalid}).status_code
            == 422
        )


def test_concurrent_edits_and_pagination(connections):
    client, config, users, project, _ = connections
    base = f"/api/v1/projects/{project}/prompts"
    owner = users[0][1]
    for index in range(21):
        response = client.post(
            base,
            headers=owner,
            json={"name": f"Prompt {index}", "type": "agent", "content": "Original"},
        )
        assert response.status_code == 201
    first = client.get(base, headers=owner).json()
    second = client.get(base + "?offset=20", headers=owner).json()
    assert (
        len(first["items"]) == 20
        and first["next_offset"] == 20
        and len(second["items"]) == 1
    )
    url = base + "/" + first["items"][0]["id"]

    def save(index):
        return client.post(
            url + "/revisions",
            headers=users[index][1],
            json={
                "name": "Changed",
                "content": f"New content {index}",
                "base_revision": 1,
            },
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, [0, 1])) == [200, 409]
    assert len(client.get(url + "/revisions", headers=owner).json()["items"]) == 2
