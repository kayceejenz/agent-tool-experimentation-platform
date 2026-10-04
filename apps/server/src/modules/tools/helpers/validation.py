import json
import re
from jsonschema import Draft202012Validator
from modules.mcp_servers.models.error_model import McpConnectionError

SENSITIVE = re.compile(
    r"password|secret|token|authorization|api[_-]?key|credential", re.I
)


def redact(value, secret=None):
    if isinstance(value, dict):
        return {
            key: "[redacted]" if SENSITIVE.search(key) else redact(item, secret)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item, secret) for item in value]
    if isinstance(value, str):
        if secret:
            value = value.replace(secret, "[redacted]")
        # MCP text content often embeds JSON; redact its sensitive fields too.
        try:
            parsed = json.loads(value)
            if isinstance(parsed, (dict, list)):
                return json.dumps(redact(parsed, secret))
        except (ValueError, RecursionError):
            pass
    return value


def validate_arguments_inline(schema, arguments):
    # Only document-local references are supported. No schema-controlled network IO.
    def inspect(node, depth=0):
        if depth > 40:
            raise ValueError("schema nesting")
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("$ref", "$dynamicRef") and (
                    not isinstance(value, str) or not value.startswith("#")
                ):
                    raise ValueError("external reference")
                if key == "$id":
                    raise ValueError("schema resource identifiers are unsupported")
                inspect(value, depth + 1)
        elif isinstance(node, list):
            for value in node:
                inspect(value, depth + 1)

    try:
        if len(json.dumps(arguments, allow_nan=False)) > 65536:
            raise ValueError("arguments too large")
        inspect(schema)
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema)
        if next(validator.iter_errors(arguments), None) is not None:
            raise McpConnectionError(
                422, "Arguments do not match the tool input schema"
            )
    except McpConnectionError:
        raise
    except Exception:
        raise McpConnectionError(
            422, "Unsupported schema or invalid arguments"
        ) from None


async def validate_arguments(schema, arguments):
    # Run untrusted schema regexes/recursive references outside the API event loop.
    import asyncio
    import sys

    payload = json.dumps(
        {"schema": schema, "arguments": arguments}, allow_nan=False
    ).encode()
    if len(payload) > 1_100_000:
        raise McpConnectionError(422, "Inputs or schema too large")
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "modules.tools.helpers.validation",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        async with asyncio.timeout(2):
            await process.communicate(payload)
        if process.returncode != 0:
            raise McpConnectionError(
                422, "Arguments do not match the schema or schema is unsupported"
            )
    except TimeoutError:
        raise McpConnectionError(
            422, "Schema validation exceeded its time limit"
        ) from None
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


if __name__ == "__main__":
    import sys
    import resource

    resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
    try:
        data = json.load(sys.stdin)
        validate_arguments_inline(data["schema"], data["arguments"])
    except Exception:
        sys.exit(1)
