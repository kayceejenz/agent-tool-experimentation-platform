import hashlib

import pytest
from test_projects_integration import create, query, workspace  # noqa: F401

pytestmark = pytest.mark.integration


def test_upload_preview_permissions_and_cleanup(workspace, tmp_path):  # noqa: F811
    client, config, users = workspace
    config.dataset_storage_root = str(tmp_path)
    owner, editor, viewer, outsider = users
    project = create(client, owner[1])
    path = f"/api/v1/projects/{project['id']}/datasets"
    for user, role in [(editor, "editor"), (viewer, "viewer")]:
        query(
            config,
            "INSERT INTO agent_platform.project_members(project_id,user_id,role) VALUES (%s,%s,%s)",
            (project["id"], user[0], role),
        )
    data = b"Animal_ID,Duration_s\n001,24\n"
    response = client.post(
        path,
        headers=owner[1],
        data={"name": "Trial"},
        files=[("files", ("events.csv", data, "text/csv"))],
    )
    assert response.status_code == 201, response.text
    dataset = response.json()
    file = dataset["files"][0]
    assert file["sha256"] == hashlib.sha256(data).hexdigest()
    preview = f"{path}/{dataset['id']}/files/{file['id']}/preview"
    assert client.get(preview, headers=viewer[1]).json()["rows"] == [["001", "24"]]
    assert client.get(preview, headers=outsider[1]).status_code == 404
    assert len(client.get(path, headers=viewer[1]).json()["items"]) == 1
    assert (
        client.post(
            path,
            headers=viewer[1],
            data={"name": "Denied"},
            files={"files": ("x.csv", data)},
        ).status_code
        == 403
    )
    before = set(tmp_path.iterdir())
    response = client.post(
        path,
        headers=owner[1],
        data={"name": "Bad"},
        files=[("files", ("x.csv", data)), ("files", ("bad.csv", b"\xff"))],
    )
    assert response.status_code == 422
    assert set(tmp_path.iterdir()) == before
    other = create(client, owner[1], "Other")
    assert (
        client.get(
            preview.replace(project["id"], other["id"]), headers=owner[1]
        ).status_code
        == 404
    )
    assert (tmp_path / dataset["id"] / file["id"]).read_bytes() == data


def test_upload_limits_and_duplicate_cleanup(workspace, tmp_path):  # noqa: F811
    client, config, users = workspace
    config.dataset_storage_root = str(tmp_path)
    owner = users[0]
    project = create(client, owner[1])
    path = f"/api/v1/projects/{project['id']}/datasets"
    data = b"a,b\n1,2\n"
    response = client.post(
        path,
        headers=owner[1],
        data={"name": "Duplicate"},
        files=[("files", ("x.csv", data)), ("files", ("x.csv", data))],
    )
    assert response.status_code == 422
    assert not list(tmp_path.iterdir())
    config.dataset_file_limit_bytes = 5
    response = client.post(
        path, headers=owner[1], data={"name": "Large"}, files={"files": ("x.csv", data)}
    )
    assert response.status_code == 413
    config.dataset_file_limit_bytes = 2 * 1024 * 1024
    config.dataset_total_limit_bytes = 10
    response = client.post(
        path,
        headers=owner[1],
        data={"name": "Too large"},
        files={"files": ("x.csv", b"a,b\n" + b"1,2\n" * 300000)},
    )
    assert response.status_code == 413
    assert not list(tmp_path.iterdir())
    assert client.get(path, headers=owner[1]).json()["items"] == []


def test_delete_dataset_permissions_and_files(workspace, tmp_path):  # noqa: F811
    client, config, users = workspace
    config.dataset_storage_root = str(tmp_path)
    owner, editor, viewer, outsider = users
    project = create(client, owner[1])
    for user, role in [(editor, "editor"), (viewer, "viewer")]:
        query(
            config,
            "INSERT INTO agent_platform.project_members(project_id,user_id,role) VALUES (%s,%s,%s)",
            (project["id"], user[0], role),
        )
    base = f"/api/v1/projects/{project['id']}/datasets"
    dataset = client.post(
        base,
        headers=owner[1],
        data={"name": "Delete me"},
        files={"files": ("events.csv", b"a,b\n1,2\n")},
    ).json()
    url = f"{base}/{dataset['id']}"
    directory = tmp_path / dataset["id"]
    assert directory.exists()
    assert client.delete(url, headers=viewer[1]).status_code == 403
    assert client.delete(url, headers=outsider[1]).status_code == 404
    other = create(client, owner[1], "Other")
    assert (
        client.delete(
            url.replace(project["id"], other["id"]), headers=owner[1]
        ).status_code
        == 404
    )
    assert directory.exists()
    assert client.delete(url, headers=editor[1]).json() == {"deleted": True}
    assert not directory.exists()
    assert client.get(base, headers=owner[1]).json()["items"] == []
    assert client.get(url, headers=owner[1]).status_code == 404
    assert (
        client.get(
            url + f"/files/{dataset['files'][0]['id']}/preview", headers=owner[1]
        ).status_code
        == 404
    )
    assert client.delete(url, headers=owner[1]).status_code == 404
    assert (
        query(
            config,
            "SELECT id FROM agent_platform.dataset_files WHERE dataset_id=%s",
            (dataset["id"],),
        )
        == []
    )


def test_direct_upload_ticket_scope_replay_expiry_and_cors(workspace, tmp_path):  # noqa: F811
    client, config, users = workspace
    config.dataset_storage_root = str(tmp_path)
    owner, _, viewer, _ = users
    project = create(client, owner[1])
    other = create(client, owner[1], "Other")
    base = f"/api/v1/projects/{project['id']}/datasets"
    origin = config.auth_origins[0]
    headers = {**owner[1], "Origin": origin}
    query(
        config,
        "INSERT INTO agent_platform.project_members(project_id,user_id,role) VALUES (%s,%s,'viewer')",
        (project["id"], viewer[0]),
    )
    assert (
        client.post(
            base + "/upload-ticket", headers={**viewer[1], "Origin": origin}
        ).status_code
        == 403
    )
    assert (
        client.post(
            base + "/upload-ticket",
            headers={**owner[1], "Origin": "https://evil.invalid"},
        ).status_code
        == 403
    )
    ticket = client.post(base + "/upload-ticket", headers=headers)
    assert ticket.status_code == 200, ticket.text
    assert ticket.json()["file_limit_bytes"] == 128 * 1024 * 1024
    direct_headers = {
        "Origin": origin,
        "Authorization": "Upload " + ticket.json()["token"],
    }
    payload = {
        "data": {"name": "Direct"},
        "files": {"files": ("data.csv", b"a,b\n1,2\n")},
    }
    assert (
        client.post(
            base.replace(project["id"], other["id"]) + "/direct-upload",
            headers=direct_headers,
            **payload,
        ).status_code
        == 403
    )
    assert (
        client.post(
            base + "/direct-upload",
            headers={**direct_headers, "Origin": "https://evil.invalid"},
            **payload,
        ).status_code
        == 403
    )
    preflight = client.options(
        base + "/direct-upload",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin
    response = client.post(base + "/direct-upload", headers=direct_headers, **payload)
    assert response.status_code == 201, response.text
    assert response.headers["access-control-allow-origin"] == origin
    assert (
        client.post(
            base + "/direct-upload", headers=direct_headers, **payload
        ).status_code
        == 403
    )
    ticket = client.post(base + "/upload-ticket", headers=headers).json()
    query(
        config,
        "UPDATE agent_platform.dataset_upload_tickets SET expires_at=now()-interval '1 second'",
    )
    assert (
        client.post(
            base + "/direct-upload",
            headers={**direct_headers, "Authorization": "Upload " + ticket["token"]},
            **payload,
        ).status_code
        == 403
    )
    ticket = client.post(base + "/upload-ticket", headers=headers).json()
    query(
        config,
        "DELETE FROM agent_platform.project_members WHERE project_id=%s AND user_id=%s",
        (project["id"], owner[0]),
    )
    assert (
        client.post(
            base + "/direct-upload",
            headers={**direct_headers, "Authorization": "Upload " + ticket["token"]},
            **payload,
        ).status_code
        == 404
    )


def test_direct_upload_larger_than_previous_file_limit(workspace, tmp_path):  # noqa: F811
    client, config, users = workspace
    config.dataset_storage_root = str(tmp_path / "inputs")
    project = create(client, users[0][1])
    base = f"/api/v1/projects/{project['id']}/datasets"
    origin = config.auth_origins[0]
    ticket = client.post(
        base + "/upload-ticket", headers={**users[0][1], "Origin": origin}
    ).json()
    source = tmp_path / "large.csv"
    with source.open("wb") as output:
        output.write(b"a,b\n")
        for _ in range(73):
            output.write(b"1,2\n" * (1024 * 1024 // 4))
    with source.open("rb") as data:
        response = client.post(
            base + "/direct-upload",
            headers={"Origin": origin, "Authorization": "Upload " + ticket["token"]},
            data={"name": "Large"},
            files={"files": ("large.csv", data, "text/csv")},
        )
    assert response.status_code == 201, response.text
    assert response.json()["files"][0]["size_bytes"] == source.stat().st_size
