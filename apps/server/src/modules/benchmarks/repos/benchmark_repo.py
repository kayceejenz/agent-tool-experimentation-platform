from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from modules.agents.models.error_model import AgentError
from modules.agents.repos.agent_repo import AgentRepository
from modules.benchmarks.helpers.scoring import score_call, totals


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
                "SELECT * FROM agent_platform.tool_benchmarks WHERE id=%s AND project_id=%s",
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
                              e.agent_revision,e.agent_id,e.agent_name
                       FROM agent_platform.tool_benchmarks b
                       LEFT JOIN LATERAL (
                        SELECT id,status,termination_reason,agent_revision,agent_id,
                               snapshot->>'name' AS agent_name
                        FROM agent_platform.agent_executions
                        WHERE benchmark_id=b.id AND (%s::uuid IS NULL OR (agent_id=%s AND agent_revision=%s))
                        ORDER BY created_at DESC,id DESC LIMIT 1
                       ) e ON true
                       WHERE b.project_id=%s ORDER BY b.created_at DESC,b.id DESC""",
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
