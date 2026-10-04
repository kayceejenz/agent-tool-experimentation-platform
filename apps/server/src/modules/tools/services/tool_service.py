import hashlib
import json
import time
from uuid import uuid4
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from integrations.mcp.client import execute_tool, ProbeFailure
from integrations.mcp.credential_cipher import CredentialStorageUnavailable
from modules.mcp_servers.models.error_model import McpConnectionError
from modules.mcp_servers.repos.server_repo import ServerRepository
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
        async with self.repository.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await ServerRepository.member(db, user_id, project_id, True)
                tool = await self.repository.read(db, project_id, tool_id, True)
                previous = await (
                    await db.execute(
                        "SELECT id,status,result,error_code,duration_ms,created_at,revision,inputs FROM agent_platform.tool_executions WHERE tool_id=%s AND user_id=%s AND request_id=%s AND arguments_hash=%s",
                        (tool_id, user_id, body.request_id, digest),
                    )
                ).fetchone()
                if previous:
                    return previous
                conflict = await (
                    await db.execute(
                        "SELECT id FROM agent_platform.tool_executions WHERE tool_id=%s AND user_id=%s AND request_id=%s",
                        (tool_id, user_id, body.request_id),
                    )
                ).fetchone()
                if conflict:
                    raise McpConnectionError(
                        409, "Request ID already used with different inputs"
                    )
                if (
                    not tool["available"]
                    or not tool["enabled"]
                    or not tool["server_enabled"]
                    or tool["revision"] != body.revision
                ):
                    raise McpConnectionError(
                        409,
                        "Enable the server and current tool revision before running",
                    )
                await validate_arguments(
                    tool["definition"]["input_schema"], body.arguments
                )
                server = await ServerRepository.read(db, project_id, tool["server_id"])
                if server.auth_type == "bearer":
                    credential = await (
                        await db.execute(
                            "SELECT encrypted_value FROM agent_platform.mcp_server_credentials WHERE server_id=%s",
                            (server.id,),
                        )
                    ).fetchone()
                    try:
                        if credential is None:
                            raise CredentialStorageUnavailable
                        token = self.cipher.decrypt(
                            credential["encrypted_value"],
                            project_id,
                            server.id,
                            server.endpoint,
                        )
                    except CredentialStorageUnavailable:
                        raise McpConnectionError(
                            503, "Credential storage unavailable"
                        ) from None
                execution_id = uuid4()
                secret = token.get_secret_value() if token else None
                await db.execute(
                    "INSERT INTO agent_platform.tool_executions(id,tool_id,revision,user_id,request_id,arguments_hash,inputs,status) VALUES (%s,%s,%s,%s,%s,%s,%s,'running')",
                    (
                        execution_id,
                        tool_id,
                        body.revision,
                        user_id,
                        body.request_id,
                        digest,
                        Jsonb(redact(body.arguments, secret)),
                    ),
                )
        # Persist the reservation before dispatch; retries with the same ID cannot invoke twice.
        started = time.monotonic()
        result, error_code = None, None
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
        duration = int((time.monotonic() - started) * 1000)
        async with self.repository.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                return await (
                    await db.execute(
                        "UPDATE agent_platform.tool_executions SET status=%s,result=%s,error_code=%s,duration_ms=%s WHERE id=%s RETURNING id,revision,inputs,status,result,error_code,duration_ms,created_at",
                        (status, Jsonb(result), error_code, duration, execution_id),
                    )
                ).fetchone()
