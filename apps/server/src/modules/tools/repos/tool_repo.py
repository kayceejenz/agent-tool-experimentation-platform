from uuid import uuid4
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from modules.mcp_servers.repos.server_repo import ServerRepository
from modules.mcp_servers.models.error_model import McpConnectionError

SELECT = """SELECT t.*, s.name AS server_name, s.enabled AS server_enabled,
 r.definition FROM agent_platform.mcp_tools t
 JOIN agent_platform.mcp_servers s ON s.id=t.server_id
 JOIN agent_platform.tool_revisions r ON r.tool_id=t.id AND r.revision=t.revision"""


async def sync_tools(db, server_id, tools):
    names = [tool["name"] for tool in tools]
    await db.execute(
        "UPDATE agent_platform.mcp_tools SET available=false, enabled=false WHERE server_id=%s AND NOT (name=ANY(%s))",
        (server_id, names),
    )
    for definition in tools:
        row = await (
            await db.execute(
                SELECT + " WHERE t.server_id=%s AND t.name=%s FOR UPDATE OF t",
                (server_id, definition["name"]),
            )
        ).fetchone()
        if row is None:
            tool_id, revision = uuid4(), 1
            await db.execute(
                "INSERT INTO agent_platform.mcp_tools(id,server_id,name) VALUES (%s,%s,%s)",
                (tool_id, server_id, definition["name"]),
            )
        else:
            tool_id, revision = row["id"], row["revision"]
            changed = row["definition"] != definition
            revision += int(changed)
            await db.execute(
                "UPDATE agent_platform.mcp_tools SET available=true, revision=%s, enabled=CASE WHEN %s THEN false ELSE enabled END WHERE id=%s",
                (revision, changed, tool_id),
            )
            if not changed:
                continue
        await db.execute(
            "INSERT INTO agent_platform.tool_revisions(tool_id,revision,definition) VALUES (%s,%s,%s)",
            (tool_id, revision, Jsonb(definition)),
        )


class ToolRepository:
    def __init__(self, database):
        self.database = database

    @staticmethod
    async def read(db, project_id, tool_id, lock=False):
        row = await (
            await db.execute(
                SELECT
                + " WHERE s.project_id=%s AND t.id=%s"
                + (" FOR UPDATE OF s,t" if lock else ""),
                (project_id, tool_id),
            )
        ).fetchone()
        if not row:
            raise McpConnectionError(404, "Tool not found")
        return row

    async def list(self, user_id, project_id, server_id, offset, query="", summary=False):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await ServerRepository.member(db, user_id, project_id, False)
                rows = await (
                    await db.execute(
                        (SELECT.replace("r.definition", "r.definition->>'description' AS description") if summary else SELECT)
                        + " WHERE s.project_id=%s AND (%s::uuid IS NULL OR s.id=%s) AND strpos(lower(t.name),lower(%s))>0 ORDER BY s.name,t.name,t.id LIMIT 101 OFFSET %s",
                        (project_id, server_id, server_id, query, offset),
                    )
                ).fetchall()
                return {
                    "items": rows[:100],
                    "next_offset": offset + 100 if len(rows) > 100 else None,
                }

    async def toggle(self, user_id, project_id, tool_id, body):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await ServerRepository.member(db, user_id, project_id, True)
                row = await self.read(db, project_id, tool_id, True)
                if row["revision"] != body.revision or (
                    body.enabled and not row["available"]
                ):
                    raise McpConnectionError(
                        409, "Tool changed or is unavailable. Rediscover and reload."
                    )
                await db.execute(
                    "UPDATE agent_platform.mcp_tools SET enabled=%s WHERE id=%s",
                    (body.enabled, tool_id),
                )
                return {**row, "enabled": body.enabled}

    async def history(self, user_id, project_id, tool_id):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await ServerRepository.member(db, user_id, project_id, False)
                await self.read(db, project_id, tool_id)
                rows = await (
                    await db.execute(
                        "SELECT id,revision,inputs,status,result,error_code,duration_ms,created_at FROM agent_platform.tool_executions WHERE tool_id=%s ORDER BY created_at DESC LIMIT 20",
                        (tool_id,),
                    )
                ).fetchall()
                # A worker may have stopped after dispatch. Never imply it is safe to retry.
                from datetime import datetime, UTC

                for row in rows:
                    if (
                        row["status"] == "running"
                        and (datetime.now(UTC) - row["created_at"]).total_seconds() > 30
                    ):
                        row.update(status="unknown", error_code="interrupted")
                return {"items": rows}

    async def operation(self, user_id, project_id, tool_id, request_id):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await ServerRepository.member(db, user_id, project_id, False)
                await self.read(db, project_id, tool_id)
                row = await (await db.execute(
                    "SELECT id,revision,inputs,status,result,error_code,duration_ms,created_at FROM agent_platform.tool_executions WHERE tool_id=%s AND user_id=%s AND request_id=%s",
                    (tool_id, user_id, request_id),
                )).fetchone()
                if not row:
                    raise McpConnectionError(404, "Tool operation not found")
                return row

    async def get(self, user_id, project_id, tool_id):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await ServerRepository.member(db, user_id, project_id, False)
                return await self.read(db, project_id, tool_id)
