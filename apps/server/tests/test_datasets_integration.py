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
