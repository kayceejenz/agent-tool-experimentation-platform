import base64
import os
from uuid import uuid4

import pytest
from core.settings import Settings
from integrations.mcp.credential_cipher import (
    CredentialCipher,
    CredentialStorageUnavailable,
)
from modules.mcp_servers.helpers.endpoint import validate_endpoint
from modules.mcp_servers.models.error_model import McpConnectionError
from pydantic import SecretStr, ValidationError


def test_encryption_is_randomized_bound_and_authenticated():
    key = SecretStr(base64.urlsafe_b64encode(os.urandom(32)).decode())
    cipher = CredentialCipher(key)
    project, server = uuid4(), uuid4()
    secret = SecretStr("test-bearer-credential")
    endpoint = "https://tools.example.com/mcp"
    encrypted = cipher.encrypt(secret, project, server, endpoint)
    assert encrypted != cipher.encrypt(secret, project, server, endpoint)
    assert secret.get_secret_value().encode() not in encrypted
    assert cipher.decrypt(encrypted, project, server, endpoint) == secret
    for data, pid, sid, url in [
        (encrypted, uuid4(), server, endpoint),
        (encrypted, project, uuid4(), endpoint),
        (encrypted, project, server, endpoint + "/other"),
        (encrypted[:-1] + bytes([encrypted[-1] ^ 1]), project, server, endpoint),
    ]:
        with pytest.raises(CredentialStorageUnavailable):
            cipher.decrypt(data, pid, sid, url)
    with pytest.raises(CredentialStorageUnavailable):
        CredentialCipher(None).encrypt(secret, project, server, endpoint)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, mcp_credential_key="invalid-key")


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://tools.example.com/mcp",
        "https://user:secret@tools.example.com/mcp",
        "https://tools.example.com/mcp?token=secret",
        "https://tools.example.com/mcp#secret",
        "file:///tmp/demo",
        "https://127.0.0.1/mcp",
        "https://169.254.169.254/mcp",
        "https://[::1]/mcp",
        "https://tools.local/mcp",
        "https://tools.example.com/\r\nother",
        "http://localhost:8013/mcp",
    ],
)
def test_reject_invalid_or_unapproved_endpoint_configuration(endpoint):
    config = Settings(_env_file=None, mcp_development_origins=["http://localhost:8012"])
    with pytest.raises(McpConnectionError) as error:
        validate_endpoint(endpoint, config)
    assert error.value.status == 422
    assert "secret" not in str(error.value)


def test_local_demo_origin_is_explicit_and_development_only():
    config = Settings(_env_file=None, mcp_development_origins=["http://localhost:8012"])
    assert (
        validate_endpoint("http://localhost:8012/mcp", config)
        == "http://localhost:8012/mcp"
    )
    assert (
        validate_endpoint("https://Tools.Example.com/mcp", config)
        == "https://tools.example.com/mcp"
    )
    with pytest.raises(McpConnectionError):
        validate_endpoint(
            "http://localhost:8012/mcp",
            config.model_copy(update={"app_env": "production"}),
        )
