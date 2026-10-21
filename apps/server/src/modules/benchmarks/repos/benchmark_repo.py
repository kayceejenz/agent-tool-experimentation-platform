from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from modules.agents.models.error_model import AgentError
from modules.agents.repos.agent_repo import AgentRepository
from modules.benchmarks.helpers.scoring import model_performance, score_call, totals


class BenchmarkRepository:
    def __init__(self, database):
        self.database = database

    @staticmethod
    async def capture(db, project_id, capture_id):
        row = await (
            await db.execute(
                """SELECT e.id,e.tool_id,e.revision,e.inputs AS arguments,e.result,
                      t.name AS tool_name,s.name AS server_name
               FROM agent_platform.tool_executions e
               JOIN agent_platform.mcp_tools t ON t.id=e.tool_id
               JOIN agent_platform.mcp_servers s ON s.id=t.server_id
               WHERE e.id=%s AND s.project_id=%s AND e.status='success'
                 AND NOT EXISTS(SELECT 1 FROM agent_platform.execution_spans x
                                WHERE x.tool_execution_id=e.id)""",
                (capture_id, project_id),
            )
        ).fetchone()
        if not row:
            raise AgentError(
                404, "Select a successful manual tool test in this project"
            )
        return row

    async def get_capture(self, user_id, project_id, capture_id):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id)
                return await self.capture(db, project_id, capture_id)

    async def save(self, user_id, project_id, body):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id, True)
                old = await (
                    await db.execute(
                        "SELECT * FROM agent_platform.tool_benchmarks WHERE id=%s",
                        (body.request_id,),
                    )
                ).fetchone()
                if old:
                    if (
                        old["project_id"] != project_id
                        or old["created_by"] != user_id
                        or old["input"] != body.input
                        or old["capture_id"] != body.capture_id
                    ):
                        raise AgentError(
                            409, "Request ID already used for another example"
                        )
                    return old
                capture = await self.capture(db, project_id, body.capture_id)
                return await (
                    await db.execute(
                        """INSERT INTO agent_platform.tool_benchmarks
                       (id,project_id,capture_id,input,tool_id,tool_revision,tool_name,server_name,arguments,created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                        (
                            body.request_id,
                            project_id,
                            body.capture_id,
                            body.input,
                            capture["tool_id"],
                            capture["revision"],
                            capture["tool_name"],
                            capture["server_name"],
                            Jsonb(capture["arguments"]),
                            user_id,
                        ),
                    )
                ).fetchone()

    @staticmethod
    async def reference(db, project_id, benchmark_id):
        row = await (
            await db.execute(
                "SELECT * FROM agent_platform.tool_benchmarks WHERE id=%s AND project_id=%s AND deleted_at IS NULL",
                (benchmark_id, project_id),
            )
        ).fetchone()
        if not row:
            raise AgentError(404, "Benchmark not found")
        return row

    async def list(self, user_id, project_id, agent_id=None):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id)
                revision = None
                if agent_id:
                    agent = await AgentRepository.agent(db, project_id, agent_id)
                    revision = agent["current_revision"]
                # The latest run per example keeps the first version easy to read.
                rows = await (
                    await db.execute(
                        """SELECT b.*,e.id AS execution_id,e.status,e.termination_reason,
                              e.agent_revision,e.agent_id,e.agent_name,
                              (SELECT count(*) FROM agent_platform.agent_executions runs
                               WHERE runs.benchmark_id=b.id AND runs.project_id=b.project_id) AS run_count
                       FROM agent_platform.tool_benchmarks b
                       LEFT JOIN LATERAL (
                        SELECT id,status,termination_reason,agent_revision,agent_id,
                               snapshot->>'name' AS agent_name
                        FROM agent_platform.agent_executions
                        WHERE benchmark_id=b.id AND (%s::uuid IS NULL OR (agent_id=%s AND agent_revision=%s))
                        ORDER BY created_at DESC,id DESC LIMIT 1
                       ) e ON true
                       WHERE b.project_id=%s AND b.deleted_at IS NULL ORDER BY b.created_at DESC,b.id DESC""",
                        (agent_id, agent_id, revision, project_id),
                    )
                ).fetchall()
                scores = []
                for row in rows:
                    await self.add_score(db, row)
                    if row["score"] is not None:
                        scores.append(row["score"])
                return {
                    "items": rows,
                    "metrics": totals(scores),
                    "agent_revision": revision,
                }

    @staticmethod
    async def add_score(db, row):
        row["calls"], row["score"] = [], None
        if not row["execution_id"]:
            return
        row["calls"] = await (
            await db.execute(
                """SELECT tool_id,name,inputs,status FROM agent_platform.execution_spans
               WHERE execution_id=%s AND kind='tool' ORDER BY sequence""",
                (row["execution_id"],),
            )
        ).fetchall()
        if row["status"] not in ("queued", "running"):
            definition = await (
                await db.execute(
                    "SELECT definition FROM agent_platform.tool_revisions WHERE tool_id=%s AND revision=%s",
                    (row["tool_id"], row["tool_revision"]),
                )
            ).fetchone()
            row["input_schema"] = (
                definition["definition"].get("inputSchema", {}) if definition else {}
            )
            row["score"] = score_call(row, row["calls"])

    async def run(self, user_id, project_id, execution_id):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id)
                row = await (
                    await db.execute(
                        """SELECT b.*,e.id AS execution_id,e.status,e.termination_reason,
                              e.agent_id,e.agent_revision,e.snapshot->>'name' AS agent_name,
                              e.final_answer
                       FROM agent_platform.agent_executions e
                       JOIN agent_platform.tool_benchmarks b ON b.id=e.benchmark_id
                       WHERE e.id=%s AND e.project_id=%s AND b.project_id=%s""",
                        (execution_id, project_id, project_id),
                    )
                ).fetchone()
                if not row:
                    raise AgentError(404, "Benchmark run not found")
                await self.add_score(db, row)
                return row

    async def history(self, user_id, project_id, benchmark_id):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id)
                reference = await self.reference(db, project_id, benchmark_id)
                runs = await (
                    await db.execute(
                        """SELECT id AS execution_id,status,termination_reason,agent_revision,
                              snapshot->>'name' AS agent_name,
                              snapshot->'model_settings' AS model_settings,created_at,
                              CASE WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
                                   THEN greatest(0,extract(epoch FROM finished_at-started_at)*1000)::double precision
                              END AS latency_ms
                       FROM agent_platform.agent_executions
                       WHERE benchmark_id=%s AND project_id=%s
                       ORDER BY created_at DESC,id DESC""",
                        (benchmark_id, project_id),
                    )
                ).fetchall()
                for run in runs:
                    run["tool_id"] = reference["tool_id"]
                    run["tool_revision"] = reference["tool_revision"]
                    run["arguments"] = reference["arguments"]
                    await self.add_score(db, run)
                return {"benchmark": reference, "runs": runs}

    async def delete(self, user_id, project_id, benchmark_id):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id, True)
                row = await (
                    await db.execute(
                        """UPDATE agent_platform.tool_benchmarks
                       SET deleted_at=COALESCE(deleted_at,now())
                       WHERE id=%s AND project_id=%s RETURNING id""",
                        (benchmark_id, project_id),
                    )
                ).fetchone()
                if not row:
                    raise AgentError(404, "Benchmark not found")
                return {"deleted": True}

    async def performance(self, user_id, project_id):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await AgentRepository.member(db, user_id, project_id)
                rows = await (
                    await db.execute(
                        """SELECT e.benchmark_id,e.status,e.agent_id,
                       e.snapshot->>'name' AS agent_name,
                       b.tool_id,b.arguments,r.definition->'inputSchema' AS input_schema,
                       CASE WHEN e.started_at IS NOT NULL AND e.finished_at IS NOT NULL
                            THEN greatest(0,extract(epoch FROM e.finished_at-e.started_at)*1000)::double precision
                       END AS latency_ms,
                       COALESCE((SELECT jsonb_agg(jsonb_build_object('tool_id',s.tool_id,'inputs',s.inputs))
                                 FROM agent_platform.execution_spans s
                                 WHERE s.execution_id=e.id AND s.kind='tool'),'[]'::jsonb) AS calls
                       FROM agent_platform.agent_executions e
                       JOIN agent_platform.tool_benchmarks b ON b.id=e.benchmark_id
                       JOIN agent_platform.tool_revisions r ON r.tool_id=b.tool_id AND r.revision=b.tool_revision
                       WHERE e.project_id=%s AND b.project_id=%s AND b.deleted_at IS NULL
                         AND e.status NOT IN ('queued','running') ORDER BY e.created_at,e.id""",
                        (project_id, project_id),
                    )
                ).fetchall()
                return {"items": model_performance(rows)}
