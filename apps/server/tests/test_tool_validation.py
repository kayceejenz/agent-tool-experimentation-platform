import asyncio

import pytest
from modules.mcp_servers.models.error_model import McpConnectionError
from modules.tools.helpers.validation import redact, validate_arguments


def test_local_references_work_but_external_references_are_rejected():
    schema = {
        "type": "object",
        "properties": {"items": {"type": "array", "items": {"$ref": "#/$defs/item"}}},
        "$defs": {"item": {"type": "integer", "minimum": 1}},
    }
    asyncio.run(validate_arguments(schema, {"items": [1, 2]}))
    with pytest.raises(McpConnectionError):
        asyncio.run(validate_arguments(schema, {"items": [0]}))
    with pytest.raises(McpConnectionError):
        asyncio.run(
            validate_arguments({"$ref": "https://example.com/private-schema"}, {})
        )


def test_recursive_schema_cannot_hang_the_api():
    with pytest.raises(McpConnectionError):
        asyncio.run(validate_arguments({"$ref": "#"}, {}))


def test_embedded_json_secrets_are_redacted():
    value = {
        "password": "private",
        "nested": [{"text": '{"api_key":"private","total":4}'}],
        "echo": "Bearer credential-value",
    }
    result = redact(value, "credential-value")
    assert result["password"] == "[redacted]"
    assert "private" not in str(result) and "credential-value" not in str(result)
    assert "total" in result["nested"][0]["text"]
