import hashlib
from concurrent.futures import ThreadPoolExecutor

import jwt
import psycopg
import pytest
from api.main import create_app
from fastapi.testclient import TestClient
from migrations import migrate

pytestmark = pytest.mark.integration
PASSWORD = "test-only-long-password"
SECRET = "test-signing-secret-that-is-at-least-32-bytes"
COOKIE = "agent_refresh_token"
INVITATION = "BETA"


@pytest.fixture
def auth_config(migration_settings):
    from pydantic import SecretStr

    config = migration_settings.model_copy(
        update={
            "jwt_secret": SecretStr(SECRET),
            "registration_invitation_code": SecretStr(INVITATION),
        }
    )
    migrate(settings=config)
    with TestClient(create_app(config)) as client:
        assert register(client).status_code == 201
    return config


def query(config, statement, args=()):
    with psycopg.connect(config.database_url.get_secret_value()) as conn:
        cursor = conn.execute(statement, args)
        return cursor.fetchall() if cursor.description else None


def register(
    client, email="User@Example.com", invitation=INVITATION, password=PASSWORD
):
    return client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": password,
            "display_name": "Test User",
            "invitation_code": invitation,
        },
    )


def login(client, email="user@example.com", password=PASSWORD):
    return client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_login_returns_token_contract_and_me_requires_bearer(auth_config):
    with TestClient(create_app(auth_config)) as client:
        assert client.get("/api/v1/auth/me").status_code == 401
        response = login(client, email=" USER@EXAMPLE.COM ")
        assert response.status_code == 200
        assert set(response.json()) == {"access_token", "token_type", "expires_in"}
        assert response.json()["token_type"] == "bearer"
        assert response.json()["expires_in"] == 900

        raw = response.json()["access_token"]
        jwt.decode(
            raw,
            SECRET,
            algorithms=["HS256"],
            audience="agent-platform-api",
            issuer="agent-platform",
        )

        assert client.get("/api/v1/auth/me").status_code == 401

        me = client.get("/api/v1/auth/me", headers=bearer(raw))

        assert me.status_code == 200 and me.json()["email"] == "user@example.com"

        refresh = client.cookies.get(COOKIE)
        stored = query(
            auth_config, "SELECT token_hash FROM agent_platform.refresh_tokens"
        )[0][0]

        assert stored == hashlib.sha256(refresh.encode()).hexdigest()
        assert refresh not in response.text
        assert "HttpOnly" in response.headers["set-cookie"]
        assert "SameSite=strict" in response.headers["set-cookie"]
        assert "Path=/api/v1/auth" in response.headers["set-cookie"]


def test_refresh_rotation_reuse_and_logout_match_rag(auth_config):
    with TestClient(create_app(auth_config)) as client:
        token = login(client).json()["access_token"]
        old = client.cookies.get(COOKIE)
        response = client.post("/api/v1/auth/refresh")

        assert response.status_code == 200

        new = client.cookies.get(COOKIE)

        assert new != old
        assert (
            client.get(
                "/api/v1/auth/me", headers=bearer(response.json()["access_token"])
            ).status_code
            == 200
        )

        client.cookies.clear()
        replay = client.post(
            "/api/v1/auth/refresh", headers={"Cookie": f"{COOKIE}={old}"}
        )

        assert replay.status_code == 401
        assert "Max-Age=0" in replay.headers["set-cookie"]
        assert (
            client.post(
                "/api/v1/auth/refresh", headers={"Cookie": f"{COOKIE}={new}"}
            ).status_code
            == 401
        )

        login(client)
        current = client.cookies.get(COOKIE)

        assert client.post("/api/v1/auth/logout").status_code == 204
        assert not client.cookies.get(COOKIE)
        assert (
            client.post(
                "/api/v1/auth/refresh", headers={"Cookie": f"{COOKIE}={current}"}
            ).status_code
            == 401
        )

        assert client.get("/api/v1/auth/me", headers=bearer(token)).status_code == 200
        assert client.post("/api/v1/auth/logout").status_code == 204


def test_registration_invitation_duplicate_and_validation(auth_config):
    with TestClient(create_app(auth_config)) as client:
        assert register(client, "other@example.com", "wrong-code").status_code == 403
        assert register(client, "other@example.com", "💙").status_code == 403
        assert register(client, "USER@example.com").status_code == 409

        bad = register(client, "other@example.com", password="private")

        assert bad.status_code == 422 and "private" not in bad.text


def test_invalid_credentials_lockout_and_recovery(auth_config):
    with TestClient(create_app(auth_config)) as client:
        wrong = login(client, password="wrong")
        unknown = login(client, email="absent@example.com")

        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json() == unknown.json()

        for _ in range(4):
            assert login(client, password="wrong").status_code == 401
        assert login(client).status_code == 401

        query(
            auth_config,
            "UPDATE agent_platform.users SET locked_until=now()-interval '1 second'",
        )
        assert login(client).status_code == 200
        assert query(
            auth_config,
            "SELECT failed_login_attempts, locked_until FROM agent_platform.users",
        ) == [(0, None)]


def test_expired_refresh_disabled_account_and_token_version(auth_config):
    with TestClient(create_app(auth_config)) as client:
        token = login(client).json()["access_token"]

        query(
            auth_config,
            "UPDATE agent_platform.refresh_tokens SET created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'",
        )

        assert client.post("/api/v1/auth/refresh").status_code == 401

        query(
            auth_config, "UPDATE agent_platform.users SET token_version=token_version+1"
        )

        assert client.get("/api/v1/auth/me", headers=bearer(token)).status_code == 401

        token = login(client).json()["access_token"]

        query(auth_config, "UPDATE agent_platform.users SET is_active=false")

        assert client.get("/api/v1/auth/me", headers=bearer(token)).status_code == 401
        assert client.post("/api/v1/auth/refresh").status_code == 401
        assert login(client).status_code == 401


def test_limits_persist_across_instances_and_are_atomic(auth_config):
    config = auth_config.model_copy(update={"login_rate_limit": 2})

    with TestClient(create_app(config)) as client:
        with ThreadPoolExecutor(max_workers=4) as executor:
            responses = list(
                executor.map(
                    lambda _: login(client, email="absent@example.com").status_code,
                    range(4),
                )
            )
        assert sorted(responses) == [401, 401, 429, 429]

    with TestClient(create_app(config)) as client:
        response = login(client)
        assert response.status_code == 429 and int(response.headers["retry-after"]) > 0

        query(
            config,
            "UPDATE agent_platform.auth_rate_limits SET window_started_at=now()-interval '1 hour'",
        )
        assert login(client).status_code == 200


def test_parallel_refresh_revokes_reused_family(auth_config):
    with TestClient(create_app(auth_config)) as client:
        login(client)
        raw = client.cookies.get(COOKIE)
        client.cookies.clear()

        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(
                executor.map(
                    lambda _: client.post(
                        "/api/v1/auth/refresh", headers={"Cookie": f"{COOKIE}={raw}"}
                    ),
                    range(2),
                )
            )

        assert sorted(r.status_code for r in responses) == [200, 401]
        assert query(
            auth_config,
            "SELECT count(*) FROM agent_platform.refresh_tokens WHERE revoked_at IS NULL",
        ) == [(0,)]


def test_foreign_origins_rag_cookies_and_db_errors(auth_config):
    with TestClient(create_app(auth_config)) as client:
        assert (
            client.post(
                "/api/v1/auth/logout", headers={"Origin": "http://localhost:3000"}
            ).status_code
            == 403
        )

        assert (
            client.get(
                "/api/v1/auth/me",
                headers={"Cookie": "access_token=rag-token; refresh_token=rag-refresh"},
            ).status_code
            == 401
        )

        query(auth_config, "DROP TABLE agent_platform.auth_rate_limits")
        response = login(client)
        assert response.status_code == 503
        assert response.json() == {"detail": "Service temporarily unavailable"}
        assert response.headers["cache-control"] == "no-store"


def test_production_refresh_cookie(auth_config):
    config = auth_config.model_copy(
        update={"app_env": "production", "auth_origins": ["https://agent.example.com"]}
    )
    with TestClient(create_app(config), base_url="https://agent.example.com") as client:
        response = login(client)

        assert response.status_code == 200
        assert "Secure" in response.headers["set-cookie"]
        assert "Domain=" not in response.headers["set-cookie"]


def test_concurrent_logout_and_refresh_leave_no_live_family(auth_config):
    with TestClient(create_app(auth_config)) as client:
        login(client)
        raw = client.cookies.get(COOKIE)
        client.cookies.clear()

        with ThreadPoolExecutor(max_workers=2) as executor:
            refresh = executor.submit(
                client.post,
                "/api/v1/auth/refresh",
                headers={"Cookie": f"{COOKIE}={raw}"},
            )
            logout = executor.submit(
                client.post,
                "/api/v1/auth/logout",
                headers={"Cookie": f"{COOKIE}={raw}"},
            )

            assert refresh.result().status_code in {200, 401}
            assert logout.result().status_code == 204
        assert query(
            auth_config,
            "SELECT count(*) FROM agent_platform.refresh_tokens WHERE revoked_at IS NULL",
        ) == [(0,)]
