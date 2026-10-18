from uuid import uuid4

from core.serialization import json_value
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from modules.agents.models.error_model import AgentError
from modules.agents.repos.agent_repo import AgentRepository
from modules.tools.helpers.validation import redact


class EvaluationRepository:
    def __init__(self, database, secret=None):
        self.database, self.secret = database, secret

    def redacted_jsonb(self, value):
        return Jsonb(redact(json_value(value), self.secret))

    async def execution(self, db, user_id, project_id, execution_id, write=False):
        await AgentRepository.member(db, user_id, project_id, write)
        run = await (
            await db.execute(
                "SELECT * FROM agent_platform.agent_executions WHERE project_id=%s AND id=%s"
                + (" FOR UPDATE" if write else ""),
                (project_id, execution_id),
            )
        ).fetchone()
        if not run:
            raise AgentError(404, "Execution not found")
        return run

    async def list(self, user_id, project_id, execution_id, offset=0):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.execution(db, user_id, project_id, execution_id)
                rows = await (
                    await db.execute(
                        "SELECT * FROM agent_platform.execution_evaluations WHERE execution_id=%s ORDER BY attempt DESC LIMIT 21 OFFSET %s",
                        (execution_id, offset),
                    )
                ).fetchall()
                return {
                    "items": rows[:20],
                    "next_offset": offset + 20 if len(rows) > 20 else None,
                }

    async def resolve_profile(self, db, project_id, run, body):
        if body.profile is None:
            return run["snapshot"].get("evaluation_profile")
        from modules.evaluations.helpers.rubric import profile_snapshot

        config = body.profile.model_dump(mode="json")
        reference = config["prompt"]
        prompt = None
        if reference:
            prompt = await (
                await db.execute(
                    "SELECT r.content FROM agent_platform.prompts p JOIN agent_platform.prompt_revisions r ON r.prompt_id=p.id WHERE p.project_id=%s AND p.id=%s AND r.revision=%s AND p.type='evaluation'",
                    (project_id, reference["id"], reference["revision"]),
                )
            ).fetchone()
            if not prompt:
                raise AgentError(
                    422, "Select an evaluation prompt revision in this project"
                )
        profile = profile_snapshot(
            {
                "evaluation_profile": config,
                "evaluation_prompt": prompt,
                "model_settings": run["snapshot"]["model_settings"],
            }
        )
        profile["instructions"] = redact(profile["instructions"], self.secret)
        return profile

    async def enqueue(self, user_id, project_id, execution_id, body):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                run = await self.execution(db, user_id, project_id, execution_id, True)
                if run.get("benchmark_id"):
                    raise AgentError(
                        409, "This run uses tool comparison, without an LLM judge"
                    )
                expectations = (
                    body.expectations.model_dump(mode="json")
                    if body.expectations
                    else None
                )
                profile = await self.resolve_profile(db, project_id, run, body)
                old = await (
                    await db.execute(
                        "SELECT * FROM agent_platform.execution_evaluations WHERE execution_id=%s AND request_id=%s",
                        (execution_id, body.request_id),
                    )
                ).fetchone()
                if old:
                    if old["expectations"] != json_value(
                        redact(expectations, self.secret)
                    ) or old["profile"] != json_value(profile):
                        raise AgentError(
                            409, "Request ID already used with different expectations"
                        )
                    return old
                if run["status"] in ("queued", "running"):
                    raise AgentError(409, "Wait for the execution to finish")
                if not profile:
                    raise AgentError(
                        409,
                        "This execution predates evaluation profiles; run the agent again",
                    )
                pending = await (
                    await db.execute(
                        "SELECT id FROM agent_platform.execution_evaluations WHERE execution_id=%s AND status IN ('queued','running')",
                        (execution_id,),
                    )
                ).fetchone()
                if pending:
                    raise AgentError(409, "An evaluation is already pending")
                # Serialize attempts using the execution row lock, and cap queued work per project.
                await db.execute(
                    "SELECT id FROM agent_platform.projects WHERE id=%s FOR UPDATE",
                    (project_id,),
                )
                count = await (
                    await db.execute(
                        "SELECT count(*) AS n FROM agent_platform.execution_evaluations v JOIN agent_platform.agent_executions e ON e.id=v.execution_id WHERE e.project_id=%s AND v.status IN ('queued','running')",
                        (project_id,),
                    )
                ).fetchone()
                if count["n"] >= 20:
                    raise AgentError(409, "Wait for pending evaluations to finish")
                return await (
                    await db.execute(
                        "INSERT INTO agent_platform.execution_evaluations(id,execution_id,attempt,request_id,profile,expectations,requested_by) SELECT %s,%s,COALESCE(max(attempt),0)+1,%s,%s,%s,%s FROM agent_platform.execution_evaluations WHERE execution_id=%s RETURNING *",
                        (
                            uuid4(),
                            execution_id,
                            body.request_id,
                            Jsonb(json_value(profile)),
                            self.redacted_jsonb(expectations),
                            user_id,
                            execution_id,
                        ),
                    )
                ).fetchone()

    async def claim(self):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                # Judge calls are bounded at 90 seconds. A dead worker leaves a recoverable failed attempt.
                await db.execute(
                    "UPDATE agent_platform.execution_evaluations SET status='failed',error_code='worker_interrupted',finished_at=now() WHERE status='running' AND started_at < now()-interval '120 seconds'"
                )
                return await (
                    await db.execute(
                        "UPDATE agent_platform.execution_evaluations SET status='running',started_at=now() WHERE id=(SELECT id FROM agent_platform.execution_evaluations WHERE status='queued' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *"
                    )
                ).fetchone()

    async def evidence(self, job):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                run = await (
                    await db.execute(
                        "SELECT * FROM agent_platform.agent_executions WHERE id=%s",
                        (job["execution_id"],),
                    )
                ).fetchone()
                await AgentRepository.member(db, job["requested_by"], run["project_id"])
                spans = await (
                    await db.execute(
                        "SELECT * FROM agent_platform.execution_spans WHERE execution_id=%s ORDER BY sequence",
                        (job["execution_id"],),
                    )
                ).fetchall()
                return run, spans

    async def finish(
        self, job, status, metrics, report, evidence_hash, usage=None, error_code=None
    ):
        async with self.database.connection() as conn:
            await conn.execute(
                "UPDATE agent_platform.execution_evaluations SET status=%s,metrics=%s,report=%s,evidence_hash=%s,usage=%s,error_code=%s,finished_at=now() WHERE id=%s AND status='running'",
                (
                    status,
                    self.redacted_jsonb(metrics),
                    self.redacted_jsonb(report),
                    evidence_hash,
                    self.redacted_jsonb(usage),
                    error_code,
                    job["id"],
                ),
            )
