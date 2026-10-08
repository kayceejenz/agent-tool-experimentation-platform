from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from api.main import create_app
from core.settings import Settings
from fastapi.testclient import TestClient
from modules.auth.helpers.tokens import JwtAccessTokenIssuer
from modules.auth.models.auth_user_model import AuthenticatedUser
from pydantic import ValidationError

SECRET = "test-signing-secret-that-is-at-least-32-bytes"


def issuer():
    return JwtAccessTokenIssuer(SECRET, "agent-platform", "agent-platform-api")


@pytest.mark.parametrize(
    "change",
    [
        {"exp": datetime.now(UTC) - timedelta(seconds=1)},
        {"iss": "ragapp"},
        {"aud": "ragapp-api"},
        {"sub": "invalid-uuid"},
    ],
)
def test_invalid_jwt_claims(change):
    raw, _ = issuer().issue(AuthenticatedUser(uuid4(), "user@example.com", None, 0))
    payload = jwt.decode(
        raw, SECRET, algorithms=["HS256"], audience="agent-platform-api"
    )
    payload.update(change)
    with pytest.raises((jwt.InvalidTokenError, ValueError)):
        issuer().verify(jwt.encode(payload, SECRET, algorithm="HS256"))


def test_wrong_signature_algorithm_and_missing_claims():
    raw, _ = issuer().issue(AuthenticatedUser(uuid4(), "user@example.com", None, 0))
    payload = jwt.decode(
        raw, SECRET, algorithms=["HS256"], audience="agent-platform-api"
    )
    for secret, algorithm in [
        ("another-unrelated-secret-of-at-least-32-bytes", "HS256"),
        (SECRET * 2, "HS384"),
    ]:
        with pytest.raises(jwt.InvalidTokenError):
            issuer().verify(jwt.encode(payload, secret, algorithm=algorithm))
    del payload["ver"]
    with pytest.raises(jwt.InvalidTokenError):
        issuer().verify(jwt.encode(payload, SECRET, algorithm="HS256"))


@pytest.mark.parametrize(
    "values",
    [
        {"jwt_secret": "short"},
        {"auth_origins": ["*"]},
        {"app_env": "production"},
    ],
)
def test_invalid_auth_configuration(values):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


def test_validation_does_not_echo_credentials_and_missing_configuration_is_safe():
    with TestClient(create_app(Settings(_env_file=None, jwt_secret=SECRET))) as client:
        # Dependency failure is deliberately redacted before database access.
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "user@example.com", "password": "private-password"},
        )
        assert response.status_code == 503
        assert "private-password" not in response.text
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/api/v1/auth/me").status_code == 401
        assert client.get("/health").status_code == 200


def test_invitation_code_has_no_length_constraints():
    from modules.auth.dtos.register_dto import RegisterRequest

    for code in ("", "X", "BETA", "x" * 1024):
        settings = Settings(
            _env_file=None,
            app_env="production",
            jwt_secret=SECRET,
            auth_origins=["https://agent.example.com"],
            registration_invitation_code=code,
        )
        request = RegisterRequest(
            email="user@example.com",
            password="test-password-long",
            invitation_code=code,
        )
        assert (
            settings.registration_invitation_code.get_secret_value()
            == request.invitation_code
            == code
        )


@pytest.mark.parametrize(
    "headers,expected",
    [
        ({"x-agent-client-ip": "192.0.2.1"}, 403),
        ({"x-agent-proxy-secret": "wrong", "x-agent-client-ip": "192.0.2.1"}, 403),
        ({"x-agent-proxy-secret": SECRET, "x-agent-client-ip": "not-an-ip"}, 400),
    ],
)
def test_untrusted_proxy_cannot_choose_rate_limit_bucket(headers, expected):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from fastapi import HTTPException
    from modules.auth.controllers.auth_controller import enforce_auth_rate_limit
    from starlette.requests import Request

    request = Request(
        {
            "type": "http",
            "client": ("127.0.0.1", 1234),
            "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
            "app": SimpleNamespace(
                state=SimpleNamespace(
                    settings=Settings(_env_file=None, auth_proxy_secret=SECRET)
                )
            ),
        }
    )
    limiter = AsyncMock()
    with pytest.raises(HTTPException) as error:
        asyncio.run(enforce_auth_rate_limit(request, limiter, "login"))
    assert error.value.status_code == expected
    limiter.check.assert_not_called()
