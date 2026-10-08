import hashlib
import json
from uuid import uuid4

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from modules.agents.models.error_model import AgentError
from modules.agents.repos.agent_repo import AgentRepository
from modules.tools.helpers.validation import redact


def json_value(value):
    return json.loads(json.dumps(value, default=str, allow_nan=False))


class ExecutionRepository:
    def __init__(self, database, secret=None):
        self.database, self.secret = database, secret

    def safe(self, value):
        return redact(json_value(value), self.secret)

    async def start(self, user_id, project_id, agent_id, body):
        digest = hashlib.sha256(body.input.encode()).hexdigest()
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id, True)
                old = await (
                    await db.execute(
                        "SELECT * FROM agent_platform.agent_executions WHERE project_id=%s AND user_id=%s AND request_id=%s",
                        (project_id, user_id, body.request_id),
                    )
                ).fetchone()
                if old:
                    if (
                        old["agent_id"] != agent_id
                        or old["agent_revision"] != body.revision
                        or old["input_hash"] != digest
                    ):
                        raise AgentError(
                            409, "Request ID already used for another task"
                        )
                    return old
                agent = await AgentRepository.agent(db, project_id, agent_id, True)
                detail = await AgentRepository.detail(db, agent, body.revision)
                if (
                    not agent["enabled"]
                    or body.revision != agent["current_revision"]
                    or not detail["configuration_ready"]
                ):
                    raise AgentError(
                        409, "Enable a ready, current agent revision before running"
                    )
                if detail["model_settings"]["provider"].lower() != "openai":
                    raise AgentError(
                        422, "The first runtime supports the OpenAI provider"
                    )
                pending = await (
                    await db.execute(
                        "SELECT count(*) AS total FROM agent_platform.agent_executions WHERE project_id=%s AND user_id=%s AND status IN ('queued','running')",
                        (project_id, user_id),
                    )
                ).fetchone()
                if pending["total"] >= 20:
                    raise AgentError(409, "Wait for pending executions to finish")
                for tool in detail["tools"]:
                    definition = await (
                        await db.execute(
                            "SELECT definition FROM agent_platform.tool_revisions WHERE tool_id=%s AND revision=%s",
                            (tool["id"], tool["revision"]),
                        )
                    ).fetchone()
                    tool["definition"] = definition["definition"]
                    tool["alias"] = "tool_" + tool["id"].hex
                # Preserve settings keys (e.g. max_output_tokens); redact user text and definitions.
                snapshot = json_value(detail)
                for key in (
                    "system_prompt",
                    "agent_prompt",
                    "name",
                    "description",
                ):
                    snapshot[key] = self.safe(snapshot[key])
                # Schema properties are definitions, including names like "token".
                # Preserve keys so redaction cannot change argument semantics.
                if self.secret:
                    snapshot["tools"] = json.loads(
                        json.dumps(snapshot["tools"]).replace(self.secret, "[redacted]")
                    )
                return await (
                    await db.execute(
                        "INSERT INTO agent_platform.agent_executions(id,project_id,agent_id,agent_revision,user_id,request_id,input,input_hash,snapshot) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
                        (
                            uuid4(),
                            project_id,
                            agent_id,
                            body.revision,
                            user_id,
                            body.request_id,
                            self.safe(body.input),
                            digest,
                            Jsonb(snapshot),
                        ),
                    )
                ).fetchone()

    async def get(self, user_id, project_id, execution_id, view="full"):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id)
                row = await (
                    await db.execute(
                        ("SELECT *" if view == "full" else "SELECT id,agent_revision,status,termination_reason,final_answer,created_at,finished_at" + (",input" if view == "summary" else "")) + " FROM agent_platform.agent_executions WHERE project_id=%s AND id=%s",
                        (project_id, execution_id),
                    )
                ).fetchone()
                if not row:
                    raise AgentError(404, "Execution not found")
                if view != "full":
                    counts = await (await db.execute(
                        "SELECT count(*) FILTER(WHERE kind='model') AS model_turns,count(*) FILTER(WHERE kind='tool') AS tool_calls FROM agent_platform.execution_spans WHERE execution_id=%s",
                        (execution_id,),
                    )).fetchone()
                    hint = await (await db.execute(
                        "SELECT outputs->>'hint' AS hint FROM agent_platform.execution_spans WHERE execution_id=%s AND error_code IS NOT NULL ORDER BY sequence LIMIT 1",
                        (execution_id,),
                    )).fetchone()
                    return {**row, **counts, "failure_hint": hint["hint"] if hint else None}
                row.pop("input_hash", None)
                row["spans"] = await (
                    await db.execute(
                        "SELECT * FROM agent_platform.execution_spans WHERE execution_id=%s ORDER BY sequence",
                        (execution_id,),
                    )
                ).fetchall()
                return row

    async def list(self, user_id, project_id, agent_id, offset):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id)
                await AgentRepository.agent(db, project_id, agent_id)
                rows = await (
                    await db.execute(
                        "SELECT id,agent_revision,input,status,termination_reason,created_at,finished_at FROM agent_platform.agent_executions WHERE project_id=%s AND agent_id=%s ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET %s",
                        (project_id, agent_id, offset),
                    )
                ).fetchall()
                return {
                    "items": rows[:20],
                    "next_offset": offset + 20 if len(rows) > 20 else None,
                }

    async def cancel(self, user_id, project_id, execution_id, view="full"):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id, True)
                row = await (
                    await db.execute(
                        "UPDATE agent_platform.agent_executions SET cancel_requested=true, status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END, termination_reason=CASE WHEN status='queued' THEN 'cancelled' ELSE termination_reason END, finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END WHERE id=%s AND project_id=%s RETURNING id",
                        (execution_id, project_id),
                    )
                ).fetchone()
                if not row:
                    raise AgentError(404, "Execution not found")
        return await self.get(user_id, project_id, execution_id, view)

    async def claim(self):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                stale = await (
                    await db.execute(
                        "UPDATE agent_platform.agent_executions SET status='interrupted',termination_reason='worker_interrupted',finished_at=now() WHERE status='running' AND heartbeat_at < now()-interval '30 seconds' RETURNING id",
                    )
                ).fetchall()
                for row in stale:
                    await db.execute(
                        "UPDATE agent_platform.execution_spans s SET tool_execution_id=t.id FROM agent_platform.tool_executions t, agent_platform.agent_executions e WHERE s.execution_id=%s AND e.id=s.execution_id AND t.user_id=e.user_id AND t.tool_id=s.tool_id AND t.request_id=s.executor_request_id AND s.status='running'",
                        (row["id"],),
                    )
                    await db.execute(
                        "UPDATE agent_platform.tool_executions t SET status='unknown',error_code='worker_interrupted' FROM agent_platform.execution_spans s WHERE s.execution_id=%s AND s.tool_execution_id=t.id AND s.status='running' AND t.status='running'",
                        (row["id"],),
                    )
                    await db.execute(
                        "UPDATE agent_platform.execution_spans SET status='unknown',error_code='worker_interrupted',finished_at=now() WHERE execution_id=%s AND status='running'",
                        (row["id"],),
                    )
                return await (
                    await db.execute(
                        "UPDATE agent_platform.agent_executions SET status='running',started_at=now(),heartbeat_at=now() WHERE id=(SELECT id FROM agent_platform.agent_executions WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
                    )
                ).fetchone()

    async def check(self, run):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(
                    db, run["user_id"], run["project_id"], True
                )
                agent = await AgentRepository.agent(
                    db, run["project_id"], run["agent_id"]
                )
                if (
                    not agent["enabled"]
                    or agent["current_revision"] != run["agent_revision"]
                ):
                    raise AgentError(409, "Agent disabled or changed during execution")
                row = await (
                    await db.execute(
                        "UPDATE agent_platform.agent_executions SET heartbeat_at=now() WHERE id=%s AND status='running' RETURNING cancel_requested",
                        (run["id"],),
                    )
                ).fetchone()
                return not row or row["cancel_requested"]

    async def begin_span(self, run_id, **fields):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await db.execute(
                    "SELECT id FROM agent_platform.agent_executions WHERE id=%s FOR UPDATE",
                    (run_id,),
                )
                seq = await (
                    await db.execute(
                        "SELECT COALESCE(max(sequence),0)+1 AS n FROM agent_platform.execution_spans WHERE execution_id=%s",
                        (run_id,),
                    )
                ).fetchone()
                identifier = uuid4()
                await db.execute(
                    "INSERT INTO agent_platform.execution_spans(id,execution_id,sequence,parent_id,kind,name,call_id,tool_id,tool_revision,executor_request_id,context_span_ids,inputs) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        identifier,
                        run_id,
                        seq["n"],
                        fields.get("parent_id"),
                        fields["kind"],
                        fields["name"],
                        fields.get("call_id"),
                        fields.get("tool_id"),
                        fields.get("tool_revision"),
                        fields.get("executor_request_id"),
                        Jsonb(json_value(fields.get("context_span_ids", []))),
                        Jsonb(self.safe(fields["inputs"])),
                    ),
                )
                return identifier

    async def end_span(
        self, span_id, status, outputs=None, error_code=None, tool_execution_id=None
    ):
        async with self.database.connection() as conn:
            await conn.execute(
                "UPDATE agent_platform.execution_spans s SET status=%s,outputs=%s,error_code=%s,tool_execution_id=COALESCE(%s,(SELECT t.id FROM agent_platform.tool_executions t WHERE t.tool_id=s.tool_id AND t.request_id=s.executor_request_id)),finished_at=now(),duration_ms=greatest(0,(extract(epoch FROM now()-created_at)*1000)::integer) WHERE s.id=%s",
                (
                    status,
                    Jsonb(self.safe(outputs)),
                    error_code,
                    tool_execution_id,
                    span_id,
                ),
            )

    async def finish(self, run_id, status, reason, answer=None):
        async with self.database.connection() as conn:
            await conn.execute(
                "UPDATE agent_platform.execution_spans SET status='unknown',error_code=%s,finished_at=now() WHERE execution_id=%s AND status='running'",
                (reason, run_id),
            )
            await conn.execute(
                "UPDATE agent_platform.agent_executions SET status=%s,termination_reason=%s,final_answer=%s,finished_at=now() WHERE id=%s AND status='running'",
                (status, reason, self.safe(answer), run_id),
            )

    async def trace(self, user_id, project_id, execution_id, offset=0, span_id=None, snapshot=False):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id)
                execution = await (await db.execute(
                    "SELECT id" + (",snapshot" if snapshot else "") + " FROM agent_platform.agent_executions WHERE project_id=%s AND id=%s",
                    (project_id, execution_id),
                )).fetchone()
                if not execution:
                    raise AgentError(404, "Execution not found")
                if snapshot:
                    return {"snapshot": execution["snapshot"]}
                if span_id is not None:
                    row = await (await db.execute(
                        "SELECT * FROM agent_platform.execution_spans WHERE execution_id=%s AND id=%s",
                        (execution_id, span_id),
                    )).fetchone()
                    if not row:
                        raise AgentError(404, "Execution step not found")
                    return row
                rows = await (await db.execute(
                    "SELECT id,sequence,parent_id,kind,name,status,call_id,tool_id,tool_revision,tool_execution_id,context_span_ids,error_code,duration_ms FROM agent_platform.execution_spans WHERE execution_id=%s ORDER BY sequence LIMIT 51 OFFSET %s",
                    (execution_id, offset),
                )).fetchall()
                return {"items": rows[:50], "next_offset": offset + 50 if len(rows) > 50 else None}
