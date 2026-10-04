from __future__ import annotations

from datetime import datetime
from uuid import UUID

from integrations.database import Database
from psycopg import sql
from psycopg.rows import dict_row

from modules.mcp_servers.models.error_model import McpConnectionError
from modules.mcp_servers.models.server_model import McpServer

PUBLIC_SELECT = "SELECT s.*, EXISTS(SELECT 1 FROM agent_platform.mcp_server_credentials c WHERE c.server_id=s.id) AS credential_configured FROM agent_platform.mcp_servers s"


class ServerRepository:
    def __init__(self, database: Database):
        self.database = database

    @staticmethod
    async def member(db, user_id: UUID, project_id: UUID, write: bool):
        lock = "FOR UPDATE" if write else "FOR SHARE"
        row = await (
            await db.execute(
                f"SELECT role FROM agent_platform.project_members WHERE project_id=%s AND user_id=%s {lock}",
                (project_id, user_id),
            )
        ).fetchone()

        if row is None:
            raise McpConnectionError(404, "Project or connection not found")
        if write and row["role"] not in ("owner", "editor"):
            raise McpConnectionError(403, "Project role cannot manage MCP connections")

    async def authorize(self, user_id: UUID, project_id: UUID):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, True)

    @staticmethod
    async def read(db, project_id: UUID, server_id: UUID):
        row = await (
            await db.execute(
                PUBLIC_SELECT + " WHERE s.project_id=%s AND s.id=%s",
                (project_id, server_id),
            )
        ).fetchone()
        if row is None:
            raise McpConnectionError(404, "Project or connection not found")
        return McpServer(**row)

    async def create(
        self,
        user_id: UUID,
        project_id: UUID,
        server_id: UUID,
        fields: dict,
        encrypted: bytes | None,
    ) -> McpServer:
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, True)
                await db.execute(
                    "INSERT INTO agent_platform.mcp_servers(id,project_id,name,endpoint,transport,auth_type,created_by) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    (
                        server_id,
                        project_id,
                        fields["name"],
                        fields["endpoint"],
                        "streamable_http",
                        fields["auth_type"],
                        user_id,
                    ),
                )
                if encrypted is not None:
                    await db.execute(
                        "INSERT INTO agent_platform.mcp_server_credentials(server_id,encrypted_value) VALUES (%s,%s)",
                        (server_id, encrypted),
                    )
                return await self.read(db, project_id, server_id)

    async def get(self, user_id: UUID, project_id: UUID, server_id: UUID) -> McpServer:
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, False)
                return await self.read(db, project_id, server_id)

    async def snapshot(self, user_id: UUID, project_id: UUID, server_id: UUID):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, True)
                # Membership lock serializes configuration and credential updates.
                server = await self.read(db, project_id, server_id)
                row = await (
                    await db.execute(
                        "SELECT encrypted_value FROM agent_platform.mcp_server_credentials WHERE server_id=%s",
                        (server_id,),
                    )
                ).fetchone()
                return server, row["encrypted_value"] if row else None

    async def list(
        self,
        user_id: UUID,
        project_id: UUID,
        limit: int,
        after: tuple[datetime, UUID] | None,
    ) -> list[McpServer]:
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, False)
                statement = PUBLIC_SELECT + " WHERE s.project_id=%s"
                params = [project_id]
                if after:
                    statement += " AND (s.created_at,s.id)<(%s,%s)"
                    params.extend(after)
                statement += " ORDER BY s.created_at DESC,s.id DESC LIMIT %s"
                params.append(limit)
                return [
                    McpServer(**row)
                    for row in await (await db.execute(statement, params)).fetchall()
                ]

    async def update(
        self,
        user_id: UUID,
        project_id: UUID,
        server_id: UUID,
        version: int,
        changes: dict,
        replace_credential: bool,
        encrypted: bytes | None,
        discovered_tools: list | None = None,
    ) -> McpServer:
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, True)

                row = await (
                    await db.execute(
                        "SELECT config_version FROM agent_platform.mcp_servers WHERE project_id=%s AND id=%s FOR UPDATE",
                        (project_id, server_id),
                    )
                ).fetchone()

                if row is None:
                    raise McpConnectionError(404, "Project or connection not found")

                if row["config_version"] != version:
                    raise McpConnectionError(
                        409,
                        "Connection changed during this request. Reload and try again.",
                    )
                allowed = (
                    "name",
                    "endpoint",
                    "auth_type",
                    "enabled",
                    "connection_status",
                    "last_checked_at",
                    "last_error_code",
                )
                keys = [key for key in allowed if key in changes]
                assignments = [
                    sql.SQL("{}=%s").format(sql.Identifier(key)) for key in keys
                ]
                assignments.append(sql.SQL("config_version=config_version+1"))
                await db.execute(
                    sql.SQL(
                        "UPDATE agent_platform.mcp_servers SET {} WHERE id=%s AND project_id=%s"
                    ).format(sql.SQL(",").join(assignments)),
                    [changes[key] for key in keys] + [server_id, project_id],
                )
                if replace_credential:
                    if encrypted is None:
                        await db.execute(
                            "DELETE FROM agent_platform.mcp_server_credentials WHERE server_id=%s",
                            (server_id,),
                        )
                    else:
                        await db.execute(
                            "INSERT INTO agent_platform.mcp_server_credentials(server_id,encrypted_value) VALUES (%s,%s) ON CONFLICT(server_id) DO UPDATE SET encrypted_value=excluded.encrypted_value",
                            (server_id, encrypted),
                        )
                from modules.tools.repos.tool_repo import sync_tools

                if changes.get("connection_status") == "untested":
                    await db.execute(
                        "UPDATE agent_platform.mcp_tools SET available=false,enabled=false WHERE server_id=%s",
                        (server_id,),
                    )
                if discovered_tools is not None:
                    await sync_tools(db, server_id, discovered_tools)
                return await self.read(db, project_id, server_id)
