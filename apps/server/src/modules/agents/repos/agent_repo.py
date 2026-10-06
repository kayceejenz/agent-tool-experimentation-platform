from uuid import uuid4

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from modules.agents.models.error_model import AgentError

SUMMARY = """SELECT a.id,a.enabled,r.revision,r.name,r.description,r.model_settings,r.created_at,
 (SELECT count(*) FROM agent_platform.agent_revision_tools t WHERE t.agent_id=a.id AND t.agent_revision=r.revision) AS tool_count
 FROM agent_platform.agents a JOIN agent_platform.agent_revisions r ON r.agent_id=a.id AND r.revision=a.current_revision"""


class AgentRepository:
    def __init__(self, database):
        self.database = database

    @staticmethod
    async def member(db, user_id, project_id, write=False):
        row = await (
            await db.execute(
                "SELECT role FROM agent_platform.project_members WHERE project_id=%s AND user_id=%s "
                + ("FOR UPDATE" if write else "FOR SHARE"),
                (project_id, user_id),
            )
        ).fetchone()
        if not row:
            raise AgentError(404, "Project or agent not found")
        if write and row["role"] not in ("owner", "editor"):
            raise AgentError(403, "Your role cannot manage agents")

    @staticmethod
    async def agent(db, project_id, agent_id, lock=False):
        row = await (
            await db.execute(
                "SELECT * FROM agent_platform.agents WHERE project_id=%s AND id=%s"
                + (" FOR UPDATE" if lock else ""),
                (project_id, agent_id),
            )
        ).fetchone()
        if not row:
            raise AgentError(404, "Agent not found")
        return row

    @staticmethod
    async def validate_references(db, project_id, body):
        for kind in ("system", "agent"):
            reference = getattr(body, kind + "_prompt")
            if reference:
                row = await (
                    await db.execute(
                        "SELECT p.type FROM agent_platform.prompts p JOIN agent_platform.prompt_revisions r ON r.prompt_id=p.id WHERE p.project_id=%s AND p.id=%s AND r.revision=%s",
                        (project_id, reference.id, reference.revision),
                    )
                ).fetchone()
                if not row or row["type"] != kind:
                    raise AgentError(
                        422, "Select a matching prompt revision in this project"
                    )
        for tool in body.tools:
            row = await (
                await db.execute(
                    "SELECT t.id FROM agent_platform.mcp_tools t JOIN agent_platform.mcp_servers s ON s.id=t.server_id JOIN agent_platform.tool_revisions r ON r.tool_id=t.id WHERE s.project_id=%s AND t.id=%s AND r.revision=%s",
                    (project_id, tool.id, tool.revision),
                )
            ).fetchone()
            if not row:
                raise AgentError(422, "Select a tool revision in this project")

    @staticmethod
    async def insert(db, agent_id, revision, user_id, body):
        system, agent = body.system_prompt, body.agent_prompt
        await db.execute(
            "INSERT INTO agent_platform.agent_revisions(agent_id,revision,name,description,system_prompt_id,system_prompt_revision,agent_prompt_id,agent_prompt_revision,model_settings,limits,created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                agent_id,
                revision,
                body.name,
                body.description,
                system.id if system else None,
                system.revision if system else None,
                agent.id if agent else None,
                agent.revision if agent else None,
                Jsonb(body.model_settings.model_dump()),
                Jsonb(body.limits.model_dump()),
                user_id,
            ),
        )
        for tool in body.tools:
            await db.execute(
                "INSERT INTO agent_platform.agent_revision_tools(agent_id,agent_revision,tool_id,tool_revision) VALUES (%s,%s,%s,%s)",
                (agent_id, revision, tool.id, tool.revision),
            )

    @staticmethod
    async def detail(db, agent, revision=None):
        revision = revision or agent["current_revision"]
        row = await (
            await db.execute(
                "SELECT * FROM agent_platform.agent_revisions WHERE agent_id=%s AND revision=%s",
                (agent["id"], revision),
            )
        ).fetchone()
        if not row:
            raise AgentError(404, "Agent revision not found")
        result = {
            "id": agent["id"],
            "enabled": agent["enabled"],
            "current_revision": agent["current_revision"],
            "revision": revision,
            "name": row["name"],
            "description": row["description"],
            "model_settings": row["model_settings"],
            "limits": row["limits"],
            "created_at": row["created_at"],
            "created_by": row["created_by"],
        }
        issues = []
        for kind in ("system", "agent"):
            identifier = row[kind + "_prompt_id"]
            version = row[kind + "_prompt_revision"]
            result[kind + "_prompt"] = None
            if identifier:
                prompt = await (
                    await db.execute(
                        "SELECT p.id,p.current_revision AS latest_revision,r.revision,r.name,r.content FROM agent_platform.prompts p JOIN agent_platform.prompt_revisions r ON r.prompt_id=p.id WHERE p.id=%s AND r.revision=%s",
                        (identifier, version),
                    )
                ).fetchone()
                result[kind + "_prompt"] = prompt
            else:
                issues.append("Select a " + kind + " prompt revision.")
        if not row["model_settings"]["provider"] or not row["model_settings"]["model"]:
            issues.append("Specify a provider and model.")
        tools = await (
            await db.execute(
                "SELECT t.id,t.name,t.server_id,s.name AS server_name,s.enabled AS server_enabled,t.enabled,t.available,t.revision AS latest_revision,b.tool_revision AS revision FROM agent_platform.agent_revision_tools b JOIN agent_platform.mcp_tools t ON t.id=b.tool_id JOIN agent_platform.mcp_servers s ON s.id=t.server_id WHERE b.agent_id=%s AND b.agent_revision=%s ORDER BY s.name,t.name,t.id",
                (agent["id"], revision),
            )
        ).fetchall()
        for tool in tools:
            if tool["revision"] != tool["latest_revision"]:
                issues.append(
                    tool["name"] + ": definition changed; review the latest revision."
                )
            if (
                not tool["available"]
                or not tool["enabled"]
                or not tool["server_enabled"]
            ):
                issues.append(
                    tool["name"] + ": tool or MCP server is disabled or unavailable."
                )
        result.update(
            tools=tools,
            configuration_issues=issues,
            configuration_ready=not issues,
            runtime_available=row["model_settings"]["provider"].lower() == "openai",
        )
        return result

    async def create(self, user_id, project_id, body):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, True)
                await self.validate_references(db, project_id, body)
                identifier = uuid4()
                await db.execute(
                    "INSERT INTO agent_platform.agents(id,project_id) VALUES (%s,%s)",
                    (identifier, project_id),
                )
                await self.insert(db, identifier, 1, user_id, body)
                return await self.detail(
                    db, await self.agent(db, project_id, identifier)
                )

    async def get(self, user_id, project_id, agent_id, revision=None):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id)
                return await self.detail(
                    db, await self.agent(db, project_id, agent_id), revision
                )

    async def list(self, user_id, project_id, offset):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id)
                rows = await (
                    await db.execute(
                        SUMMARY
                        + " WHERE a.project_id=%s ORDER BY a.created_at DESC,a.id DESC LIMIT 21 OFFSET %s",
                        (project_id, offset),
                    )
                ).fetchall()
                return {
                    "items": rows[:20],
                    "next_offset": offset + 20 if len(rows) > 20 else None,
                }

    async def history(self, user_id, project_id, agent_id, offset):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id)
                await self.agent(db, project_id, agent_id)
                rows = await (
                    await db.execute(
                        SUMMARY.replace(" AND r.revision=a.current_revision", "")
                        + " WHERE a.id=%s ORDER BY r.revision DESC LIMIT 21 OFFSET %s",
                        (agent_id, offset),
                    )
                ).fetchall()
                return {
                    "items": rows[:20],
                    "next_offset": offset + 20 if len(rows) > 20 else None,
                }

    async def revise(self, user_id, project_id, agent_id, body):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, True)
                agent = await self.agent(db, project_id, agent_id, True)
                if agent["current_revision"] != body.base_revision:
                    raise AgentError(
                        409, "A newer revision exists. Reload before saving."
                    )
                await self.validate_references(db, project_id, body)
                current = await self.detail(db, agent)

                def reference(value):
                    return (
                        {"id": str(value["id"]), "revision": value["revision"]}
                        if value
                        else None
                    )

                configuration = {
                    key: current[key]
                    for key in ("name", "description", "model_settings", "limits")
                }
                configuration.update(
                    system_prompt=reference(current["system_prompt"]),
                    agent_prompt=reference(current["agent_prompt"]),
                    tools=sorted(
                        [reference(t) for t in current["tools"]], key=lambda t: t["id"]
                    ),
                )
                if configuration == body.model_dump(
                    mode="json", exclude={"base_revision"}
                ):
                    return current
                revision = agent["current_revision"] + 1
                await self.insert(db, agent_id, revision, user_id, body)
                await db.execute(
                    "UPDATE agent_platform.agents SET current_revision=%s,enabled=false WHERE id=%s",
                    (revision, agent_id),
                )
                return await self.detail(db, await self.agent(db, project_id, agent_id))

    async def availability(self, user_id, project_id, agent_id, body):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, True)
                agent = await self.agent(db, project_id, agent_id, True)
                if agent["current_revision"] != body.base_revision:
                    raise AgentError(
                        409, "Agent changed. Reload before changing availability."
                    )
                detail = await self.detail(db, agent)
                if body.enabled and detail["configuration_issues"]:
                    raise AgentError(
                        409,
                        "Complete the configuration and resolve tool availability before enabling.",
                    )
                await db.execute(
                    "UPDATE agent_platform.agents SET enabled=%s WHERE id=%s",
                    (body.enabled, agent_id),
                )
                return {**detail, "enabled": body.enabled}
