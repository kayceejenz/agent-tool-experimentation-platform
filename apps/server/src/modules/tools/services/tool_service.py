import asyncio
import hashlib
import json
import time

from integrations.mcp.client import ProbeFailure, execute_tool
from integrations.mcp.credential_cipher import CredentialStorageUnavailable

from modules.mcp_servers.models.error_model import McpConnectionError
from modules.tools.helpers.validation import redact, validate_arguments


class ToolService:
    def __init__(self, repository, cipher, settings):
        self.repository, self.cipher, self.settings = repository, cipher, settings

    async def execute(self, user_id, project_id, tool_id, body):
        digest = hashlib.sha256(
            json.dumps(
                {"revision": body.revision, "arguments": body.arguments},
                sort_keys=True,
                allow_nan=False,
            ).encode()
        ).hexdigest()
        token = None
        async with self.repository.execution_context(
            user_id, project_id, tool_id, body.request_id, digest
        ) as (db, tool, previous):
            if previous:
                return previous
            if (
                not tool["available"]
                or not tool["enabled"]
                or not tool["server_enabled"]
                or tool["revision"] != body.revision
            ):
                raise McpConnectionError(
                    409, "Enable the server and current tool revision before running"
                )
            await validate_arguments(tool["definition"]["input_schema"], body.arguments)
            server, credential = await self.repository.execution_target(
                db, project_id, tool["server_id"]
            )
            if server.auth_type == "bearer":
                try:
                    if credential is None:
                        raise CredentialStorageUnavailable
                    token = self.cipher.decrypt(
                        credential, project_id, server.id, server.endpoint
                    )
                except CredentialStorageUnavailable:
                    raise McpConnectionError(
                        503, "Credential storage unavailable"
                    ) from None
            secret = token.get_secret_value() if token else None
            execution_id = await self.repository.reserve_execution(
                db, tool_id, user_id, body, digest, redact(body.arguments, secret)
            )
        # Persist the reservation before dispatch; retries with the same ID cannot invoke twice.
        started = time.monotonic()
        result, error_code = None, None
        interrupted = False
        try:
            result = redact(
                await execute_tool(
                    server.endpoint, token, self.settings, tool["name"], body.arguments
                ),
                secret,
            )
            status = "tool_error" if result.get("isError") else "success"
        except ProbeFailure as error:
            # A timeout/disconnect may occur after a remote write completed.
            status, error_code = "unknown", error.code
        except asyncio.CancelledError:
            status, error_code, interrupted = "unknown", "interrupted", True
        except Exception:
            status, error_code = "unknown", "executor_error"
        duration = int((time.monotonic() - started) * 1000)
        saved = await self.repository.finish_execution(
            execution_id, status, result, error_code, duration
        )
        if interrupted:
            raise asyncio.CancelledError
        return saved
