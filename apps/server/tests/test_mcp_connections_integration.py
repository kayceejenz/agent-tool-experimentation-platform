import base64
import os
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from api.main import create_app
from integrations.mcp.credential_cipher import CredentialCipher
from migrations import migrate
from modules.mcp_servers.models.error_model import McpConnectionError

pytestmark = pytest.mark.integration
TOKEN = "demo-secret-token"


@pytest.fixture
def connections(migration_settings):
    config = migration_settings.model_copy(
        update={
            "jwt_secret": SecretStr("mcp-test-jwt-secret-at-least-32-bytes"),
            "mcp_credential_key": SecretStr(
                base64.urlsafe_b64encode(os.urandom(32)).decode()
            ),
            "mcp_development_origins": ["http://localhost:8012"],
            "registration_invitation_code": SecretStr("BETA"),
        }
    )
    migrate(settings=config)
    with TestClient(create_app(config)) as client:
        users = []
        for index in range(4):
            body = {
                "email": f"mcp{index}@example.com",
                "password": "mcp-test-password-long",
            }
            registered = client.post(
                "/api/v1/auth/register", json={**body, "invitation_code": "BETA"}
            )
            assert registered.status_code == 201
            token = client.post("/api/v1/auth/login", json=body).json()["access_token"]
            users.append(
                (registered.json()["id"], {"Authorization": f"Bearer {token}"})
            )
        project = client.post(
            "/api/v1/projects", json={"name": "MCP project"}, headers=users[0][1]
        ).json()["id"]
        for user, role in [(users[1], "editor"), (users[2], "viewer")]:
            query(
                config,
                "INSERT INTO agent_platform.project_members(project_id,user_id,role) VALUES (%s,%s,%s)",
                (project, user[0], role),
            )
        yield client, config, users, project, f"/api/v1/projects/{project}/mcp-servers"


def query(config, statement, args=()):
    with psycopg.connect(config.database_url.get_secret_value()) as conn:
        result = conn.execute(statement, args)
        return result.fetchall() if result.description else None


def create(client, path, headers, **changes):
    response = client.post(
        path,
        headers=headers,
        json={
            "name": "Demo",
            "endpoint": "http://localhost:8012/mcp",
            "auth_type": "bearer",
            "credential": TOKEN,
            **changes,
        },
    )
    assert response.status_code == 201, response.text
    assert TOKEN not in response.text
    return response.json()


def test_credential_lifecycle_and_connection_state(connections):
    client, config, users, project, path = connections
    headers = users[0][1]
    server = create(client, path, headers)
    url = path + "/" + server["id"]
    assert server["enabled"] is False and server["connection_status"] == "untested"
    assert server["last_checked_at"] is None and server["credential_configured"] is True
    encrypted = query(
        config,
        "SELECT encrypted_value FROM agent_platform.mcp_server_credentials WHERE server_id=%s",
        (server["id"],),
    )[0][0]
    assert TOKEN.encode() not in encrypted
    assert (
        CredentialCipher(config.mcp_credential_key)
        .decrypt(encrypted, UUID(project), UUID(server["id"]), server["endpoint"])
        .get_secret_value()
        == TOKEN
    )
    for response in [
        client.get(path, headers=headers),
        client.get(url, headers=headers),
    ]:
        assert (
            response.status_code == 200
            and TOKEN not in response.text
            and "encrypted_value" not in response.text
        )
        assert response.headers["cache-control"] == "no-store"
    assert (
        client.patch(url, headers=headers, json={"enabled": True}).json()["enabled"]
        is True
    )
    renamed = client.patch(url, headers=headers, json={"name": "Renamed"}).json()
    assert renamed["credential_configured"] is True and renamed["enabled"] is True
    assert (
        query(
            config,
            "SELECT encrypted_value FROM agent_platform.mcp_server_credentials WHERE server_id=%s",
            (server["id"],),
        )[0][0]
        == encrypted
    )
    assert (
        client.patch(
            url, headers=headers, json={"endpoint": "https://other.example.com/mcp"}
        ).status_code
        == 422
    )
    replaced = client.patch(
        url,
        headers=headers,
        json={
            "endpoint": "https://other.example.com/mcp",
            "credential": "new-secret-token",
            "enabled": True,
        },
    )
    assert replaced.status_code == 200 and replaced.json()["enabled"] is False
    assert "new-secret-token" not in replaced.text
    assert (
        client.patch(url, headers=headers, json={"credential": None}).status_code == 422
    )
    cleared = client.patch(url, headers=headers, json={"auth_type": "none"})
    assert (
        cleared.status_code == 200 and cleared.json()["credential_configured"] is False
    )
    assert (
        query(config, "SELECT count(*) FROM agent_platform.mcp_server_credentials")[0][
            0
        ]
        == 0
    )


def test_project_permissions_and_cross_project_ids(connections):
    client, config, users, project, path = connections
    server = create(client, path, users[1][1])
    url = path + "/" + server["id"]
    assert client.get(url).status_code == 401
    assert client.get(path, headers=users[3][1]).status_code == 404
    assert client.get(url, headers=users[3][1]).status_code == 404
    assert client.get(url, headers=users[2][1]).status_code == 200
    assert (
        client.patch(url, headers=users[2][1], json={"name": "Denied"}).status_code
        == 403
    )
    assert (
        client.post(
            path,
            headers=users[2][1],
            json={"name": "Denied", "endpoint": "http://localhost:8012/mcp"},
        ).status_code
        == 403
    )
    other = client.post(
        "/api/v1/projects", headers=users[0][1], json={"name": "Other"}
    ).json()["id"]
    other_url = f"/api/v1/projects/{other}/mcp-servers/{server['id']}"
    assert client.get(other_url, headers=users[0][1]).status_code == 404
    assert (
        client.patch(other_url, headers=users[0][1], json={"enabled": True}).status_code
        == 404
    )
    query(
        config,
        "DELETE FROM agent_platform.project_members WHERE project_id=%s AND user_id=%s",
        (project, users[1][0]),
    )
    assert (
        client.patch(url, headers=users[1][1], json={"enabled": True}).status_code
        == 404
    )


def test_pagination_and_validation_redact_secrets(connections):
    client, _, users, _, path = connections
    headers = users[0][1]
    ids = {
        create(client, path, headers, auth_type="none", credential=None)["id"]
        for _ in range(5)
    }
    found = []
    cursor = None
    while True:
        response = client.get(
            path,
            headers=headers,
            params={"limit": 2, **({"cursor": cursor} if cursor else {})},
        )
        assert response.status_code == 200
        page = response.json()
        found.extend(item["id"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert set(found) == ids and len(found) == 5
    for body in [
        {"name": "", "endpoint": "http://localhost:8012/mcp"},
        {
            "name": "Demo",
            "endpoint": "http://localhost:8012/mcp",
            "auth_type": "bearer",
            "credential": TOKEN + "\r\n",
        },
        {"name": "Demo", "endpoint": f"https://user:{TOKEN}@example.com/mcp"},
        {"name": "Demo", "endpoint": "http://localhost:8012/mcp", "transport": "stdio"},
        {"name": "Demo", "endpoint": "http://localhost:8012/mcp", "credential": TOKEN},
    ]:
        response = client.post(path, headers=headers, json=body)
        assert response.status_code == 422 and TOKEN not in response.text
    url = path + "/" + found[0]
    for body in [
        {},
        {"endpoint": None},
        {"enabled": "true"},
        {"last_error_code": "forged"},
    ]:
        assert client.patch(url, headers=headers, json=body).status_code == 422
    assert (
        client.get(path, headers=headers, params={"cursor": "invalid"}).status_code
        == 422
    )
    assert client.get(path, headers=headers, params={"limit": 101}).status_code == 422


def test_missing_key_and_failed_storage_never_leave_partial_records(connections):
    client, config, users, _, path = connections
    headers = users[0][1]
    actual = client.app.state.mcp_servers.cipher
    client.app.state.mcp_servers.cipher = CredentialCipher(None)
    response = client.post(
        path,
        headers=headers,
        json={
            "name": "Demo",
            "endpoint": "http://localhost:8012/mcp",
            "auth_type": "bearer",
            "credential": TOKEN,
        },
    )
    assert response.status_code == 503 and TOKEN not in response.text
    assert query(config, "SELECT count(*) FROM agent_platform.mcp_servers")[0][0] == 0
    client.app.state.mcp_servers.cipher = actual
    query(
        config,
        "CREATE FUNCTION agent_platform.fail_credential() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'storage failure'; END $$",
    )
    query(
        config,
        "CREATE TRIGGER fail_credential BEFORE INSERT ON agent_platform.mcp_server_credentials FOR EACH ROW EXECUTE FUNCTION agent_platform.fail_credential()",
    )
    response = client.post(
        path,
        headers=headers,
        json={
            "name": "Demo",
            "endpoint": "http://localhost:8012/mcp",
            "auth_type": "bearer",
            "credential": TOKEN,
        },
    )
    assert response.status_code == 503 and TOKEN not in response.text
    assert query(config, "SELECT count(*) FROM agent_platform.mcp_servers")[0][0] == 0


def test_concurrent_configuration_updates_detect_conflict(connections):
    client, _, users, project, path = connections
    server = create(client, path, users[0][1])

    def change(name):
        try:
            client.portal.call(
                partial(
                    client.app.state.mcp_servers.repository.update,
                    UUID(users[0][0]),
                    UUID(project),
                    UUID(server["id"]),
                    server["config_version"],
                    {"name": name},
                    False,
                    None,
                )
            )
            return 200
        except McpConnectionError as error:
            return error.status

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(change, ["One", "Two"])) == [200, 409]


def test_check_and_discover_permissions_status_and_credentials(
    connections, monkeypatch
):
    from integrations.mcp.client import ProbeFailure
    from modules.mcp_servers.services import server_service

    client, _config, users, _project, path = connections
    server = create(client, path, users[0][1])
    url = path + "/" + server["id"]
    calls = []

    async def successful(endpoint, token, settings, discover=False):
        assert token.get_secret_value() == TOKEN
        calls.append(discover)
        return (
            [
                {
                    "name": "inspect_dataset",
                    "description": "Inspect",
                    "input_schema": {"type": "object"},
                }
            ]
            if discover
            else []
        )

    monkeypatch.setattr(server_service, "probe", successful)
    assert client.post(url + "/check", headers=users[2][1]).status_code == 403
    assert client.post(url + "/discover", headers=users[3][1]).status_code == 404
    assert calls == []
    response = client.post(url + "/check", headers=users[0][1])
    assert response.status_code == 200
    assert TOKEN not in response.text
    assert response.json()["server"]["connection_status"] == "connected"
    assert response.json()["server"]["enabled"] is False
    assert response.json()["server"]["last_checked_at"]
    response = client.post(url + "/discover", headers=users[1][1])
    assert response.json()["tools"][0]["name"] == "inspect_dataset"
    assert (
        client.get(url, headers=users[0][1]).json()["connection_status"] == "connected"
    )

    async def failed(*args):
        raise ProbeFailure("authentication_failed")

    monkeypatch.setattr(server_service, "probe", failed)
    response = client.post(url + "/check", headers=users[0][1])
    assert response.json()["server"]["connection_status"] == "error"
    assert response.json()["server"]["last_error_code"] == "authentication_failed"
    assert response.json()["tools"] is None


def test_probe_validates_unsaved_connection_without_persisting(
    connections, monkeypatch
):
    from integrations.mcp.client import ProbeFailure
    from modules.mcp_servers.services import server_service

    client, config, users, _project, path = connections
    calls = []

    async def reachable(endpoint, token, settings, discover=False):
        calls.append((endpoint, token.get_secret_value() if token else None))
        return []

    monkeypatch.setattr(server_service, "probe", reachable)
    response = client.post(
        path + "/probe",
        headers=users[0][1],
        json={
            "endpoint": "http://localhost:8012/mcp",
            "auth_type": "bearer",
            "credential": TOKEN,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"reachable": True, "error_code": None}
    assert TOKEN not in response.text
    assert calls == [("http://localhost:8012/mcp", TOKEN)]
    assert client.get(path, headers=users[0][1]).json()["items"] == []
    assert (
        query(config, "SELECT count(*) FROM agent_platform.mcp_servers")[0][0] == 0
    )
    assert (
        query(
            config,
            "SELECT count(*) FROM agent_platform.mcp_server_credentials",
        )[0][0]
        == 0
    )

    async def failed(*args):
        raise ProbeFailure("authentication_failed")

    monkeypatch.setattr(server_service, "probe", failed)
    response = client.post(
        path + "/probe",
        headers=users[0][1],
        json={
            "endpoint": "http://localhost:8012/mcp",
            "auth_type": "bearer",
            "credential": TOKEN,
        },
    )
    assert response.json() == {
        "reachable": False,
        "error_code": "authentication_failed",
    }

    assert client.post(path + "/probe", headers=users[2][1], json={
        "endpoint": "http://localhost:8012/mcp",
    }).status_code == 403
    assert client.post(path + "/probe", headers=users[0][1], json={
        "endpoint": "http://localhost:8012/mcp",
        "auth_type": "bearer",
    }).status_code == 422
    assert client.post(path + "/probe", headers=users[0][1], json={
        "endpoint": "http://example.com/mcp",
    }).status_code == 422


def test_check_does_not_overwrite_changed_configuration(connections, monkeypatch):
    from modules.mcp_servers.services import server_service

    client, config, users, _project, path = connections
    server = create(client, path, users[0][1])
    url = path + "/" + server["id"]

    async def changed(*args):
        query(
            config,
            "UPDATE agent_platform.mcp_servers SET name='Changed', config_version=config_version+1 WHERE id=%s",
            (server["id"],),
        )
        return []

    monkeypatch.setattr(server_service, "probe", changed)
    assert client.post(url + "/check", headers=users[0][1]).status_code == 409
    current = client.get(url, headers=users[0][1]).json()
    assert current["name"] == "Changed"
    assert current["connection_status"] == "untested"
