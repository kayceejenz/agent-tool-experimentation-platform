import base64
import json
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import psycopg
import pytest
from api.main import create_app
from fastapi.testclient import TestClient
from migrations import migrate
from pydantic import SecretStr

pytestmark = pytest.mark.integration


@pytest.fixture
def workspace(migration_settings):
    config = migration_settings.model_copy(
        update={
            "jwt_secret": SecretStr("project-test-secret-of-at-least-32-bytes"),
            "registration_invitation_code": SecretStr("BETA"),
            "registration_rate_limit": 100,
            "login_rate_limit": 100,
        }
    )
    migrate(settings=config)
    with TestClient(create_app(config)) as client:
        users = []
        for index in range(4):
            data = {
                "email": f"user{index}@example.com",
                "password": "project-test-password",
            }
            response = client.post(
                "/api/v1/auth/register", json={**data, "invitation_code": "BETA"}
            )
            assert response.status_code == 201
            token = client.post("/api/v1/auth/login", json=data).json()["access_token"]
            users.append((response.json()["id"], {"Authorization": f"Bearer {token}"}))
        yield client, config, users


def query(config, statement, args=()):
    with psycopg.connect(config.database_url.get_secret_value()) as conn:
        cursor = conn.execute(statement, args)
        return cursor.fetchall() if cursor.description else None


def create(client, headers, name="Project"):
    response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={"name": name, "description": "Description"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_permissions_and_revocation(workspace):
    client, config, users = workspace
    owner, editor, viewer, outsider = users
    project = create(client, owner[1], "  Trim me  ")
    assert project["name"] == "Trim me" and project["role"] == "owner"
    assert project["created_by"] == owner[0]
    project_id = project["id"]
    path = f"/api/v1/projects/{project_id}"
    assert query(
        config,
        "SELECT user_id,role FROM agent_platform.project_members WHERE project_id=%s",
        (project_id,),
    ) == [(UUID(owner[0]), "owner")]
    for user, role in [(editor, "editor"), (viewer, "viewer")]:
        query(
            config,
            "INSERT INTO agent_platform.project_members(project_id,user_id,role) VALUES (%s,%s,%s)",
            (project_id, user[0], role),
        )
        assert client.get(path, headers=user[1]).json()["role"] == role
    assert client.get(path, headers=outsider[1]).status_code == 404
    assert (
        client.patch(path, headers=outsider[1], json={"name": "Denied"}).status_code
        == 404
    )
    assert client.get("/api/v1/projects", headers=outsider[1]).json()["items"] == []
    assert (
        client.patch(path, headers=viewer[1], json={"name": "Denied"}).status_code
        == 403
    )
    changed = client.patch(path, headers=editor[1], json={"description": None})
    assert changed.status_code == 200 and changed.json()["description"] is None
    assert changed.json()["name"] == "Trim me"
    query(
        config,
        "UPDATE agent_platform.project_members SET role='viewer' WHERE project_id=%s AND user_id=%s",
        (project_id, editor[0]),
    )
    assert (
        client.patch(path, headers=editor[1], json={"name": "Denied"}).status_code
        == 403
    )
    query(
        config,
        "DELETE FROM agent_platform.project_members WHERE project_id=%s AND user_id=%s",
        (project_id, editor[0]),
    )
    assert client.get(path, headers=editor[1]).status_code == 404
    assert client.get(path).status_code == 401
    assert client.post("/api/v1/projects", json={"name": "Denied"}).status_code == 401
    assert (
        client.get(path, headers={"Authorization": "Bearer invalid"}).status_code == 401
    )
    assert client.get(path, headers=owner[1]).headers["cache-control"] == "no-store"


def test_pagination_and_validation(workspace):
    client, config, users = workspace
    headers = users[0][1]
    ids = {create(client, headers, "Same name")["id"] for _ in range(5)}
    query(
        config, "UPDATE agent_platform.projects SET created_at='2026-01-01T00:00:00Z'"
    )
    found = []
    cursor = None
    while True:
        response = client.get(
            "/api/v1/projects",
            headers=headers,
            params={"limit": 2, **({"cursor": cursor} if cursor else {})},
        )
        assert response.status_code == 200
        body = response.json()
        found.extend(item["id"] for item in body["items"])
        cursor = body["next_cursor"]
        if cursor is None:
            break
    assert set(found) == ids and len(found) == 5
    path = f"/api/v1/projects/{found[0]}"
    for body in [
        {},
        {"name": None},
        {"name": "  "},
        {"name": "a" * 161},
        {"description": "x" * 2001},
        {"role": "owner"},
        {"name": 123},
    ]:
        assert client.patch(path, headers=headers, json=body).status_code == 422
    for params in [
        {"limit": 0},
        {"limit": 101},
        {"cursor": "bad"},
        {"cursor": base64.urlsafe_b64encode(json.dumps([123, 123]).encode()).decode()},
    ]:
        assert (
            client.get("/api/v1/projects", headers=headers, params=params).status_code
            == 422
        )
    assert client.get("/api/v1/projects/not-a-uuid", headers=headers).status_code == 422
    assert client.get(f"/api/v1/projects/{uuid4()}", headers=headers).status_code == 404


def test_creation_rollback_and_concurrent_duplicate_membership(workspace):
    client, config, users = workspace
    query(
        config,
        "CREATE FUNCTION agent_platform.reject_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$",
    )
    query(
        config,
        "CREATE TRIGGER reject_membership BEFORE INSERT ON agent_platform.project_members FOR EACH ROW EXECUTE FUNCTION agent_platform.reject_membership()",
    )
    assert (
        client.post(
            "/api/v1/projects", headers=users[0][1], json={"name": "Rollback"}
        ).status_code
        == 503
    )
    assert query(config, "SELECT count(*) FROM agent_platform.projects")[0][0] == 0
    query(config, "DROP TRIGGER reject_membership ON agent_platform.project_members")
    project = create(client, users[0][1])

    def insert(_):
        try:
            query(
                config,
                "INSERT INTO agent_platform.project_members(project_id,user_id,role) VALUES (%s,%s,'viewer')",
                (project["id"], users[1][0]),
            )
            return "created"
        except psycopg.errors.UniqueViolation:
            return "duplicate"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(insert, range(2))) == ["created", "duplicate"]


def test_demotion_committing_before_update_is_respected(workspace):
    client, config, users = workspace
    project = create(client, users[0][1])
    path = f"/api/v1/projects/{project['id']}"
    query(
        config,
        "INSERT INTO agent_platform.project_members(project_id,user_id,role) VALUES (%s,%s,'editor')",
        (project["id"], users[1][0]),
    )
    with psycopg.connect(config.database_url.get_secret_value()) as conn:
        conn.execute(
            "UPDATE agent_platform.project_members SET role='viewer' WHERE project_id=%s AND user_id=%s",
            (project["id"], users[1][0]),
        )
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(
                client.patch, path, headers=users[1][1], json={"name": "Denied"}
            )
            conn.commit()
            assert future.result().status_code == 403
    assert client.get(path, headers=users[0][1]).json()["name"] == "Project"


def test_runtime_grants_allow_project_operations_without_creator_changes(workspace):
    _, config, _ = workspace
    for table, column, privilege, expected in [
        ("projects", "name", "INSERT", True),
        ("projects", "name", "UPDATE", True),
        ("projects", "created_by", "UPDATE", False),
        ("project_members", "role", "UPDATE", True),
        ("project_members", "user_id", "INSERT", True),
    ]:
        assert (
            query(
                config,
                "SELECT has_column_privilege('agent_platform_api', %s, %s, %s)",
                ("agent_platform." + table, column, privilege),
            )[0][0]
            is expected
        )
