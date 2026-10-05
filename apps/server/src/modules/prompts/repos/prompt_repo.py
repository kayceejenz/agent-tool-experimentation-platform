from uuid import uuid4

from psycopg.rows import dict_row

from modules.prompts.models.error_model import PromptError

SUMMARY = """SELECT p.id,p.type,r.revision,r.name,r.description,r.created_by,r.created_at
 FROM agent_platform.prompts p JOIN agent_platform.prompt_revisions r
 ON r.prompt_id=p.id AND r.revision=p.current_revision"""

DETAIL = SUMMARY.replace("r.created_at\n", "r.created_at,r.content\n")


class PromptRepository:
    def __init__(self, database):
        self.database = database

    @staticmethod
    async def member(db, user_id, project_id, write=False):
        lock = "FOR UPDATE" if write else "FOR SHARE"
        row = await (
            await db.execute(
                "SELECT role FROM agent_platform.project_members WHERE project_id=%s AND user_id=%s "
                + lock,
                (project_id, user_id),
            )
        ).fetchone()
        if row is None:
            raise PromptError(404, "Project or prompt not found")
        if write and row["role"] not in ("owner", "editor"):
            raise PromptError(403, "Your role cannot edit prompts")

    @staticmethod
    async def read(db, project_id, prompt_id):
        row = await (
            await db.execute(
                DETAIL + " WHERE p.project_id=%s AND p.id=%s", (project_id, prompt_id)
            )
        ).fetchone()
        if row is None:
            raise PromptError(404, "Prompt not found")
        return row

    async def create(self, user_id, project_id, body):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, True)
                prompt_id = uuid4()
                await db.execute(
                    "INSERT INTO agent_platform.prompts(id,project_id,type) VALUES (%s,%s,%s)",
                    (prompt_id, project_id, body.type),
                )
                await self.insert_revision(db, prompt_id, 1, user_id, body)
                return await self.read(db, project_id, prompt_id)

    @staticmethod
    async def insert_revision(db, prompt_id, revision, user_id, body):
        await db.execute(
            "INSERT INTO agent_platform.prompt_revisions(prompt_id,revision,name,description,content,created_by) VALUES (%s,%s,%s,%s,%s,%s)",
            (prompt_id, revision, body.name, body.description, body.content, user_id),
        )

    async def get(self, user_id, project_id, prompt_id, revision=None):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id)
                if revision is None:
                    return await self.read(db, project_id, prompt_id)
                row = await (
                    await db.execute(
                        DETAIL.replace("r.revision=p.current_revision", "r.revision=%s")
                        + " WHERE p.project_id=%s AND p.id=%s",
                        (revision, project_id, prompt_id),
                    )
                ).fetchone()
                if not row:
                    raise PromptError(404, "Revision not found")
                return row

    async def list(self, user_id, project_id, offset, prompt_type=None):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id)
                rows = await (
                    await db.execute(
                        SUMMARY
                        + " WHERE p.project_id=%s AND (%s::text IS NULL OR p.type=%s) ORDER BY p.created_at DESC,p.id DESC LIMIT 21 OFFSET %s",
                        (project_id, prompt_type, prompt_type, offset),
                    )
                ).fetchall()
                return {
                    "items": rows[:20],
                    "next_offset": offset + 20 if len(rows) > 20 else None,
                }

    async def history(self, user_id, project_id, prompt_id, offset):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id)
                await self.read(db, project_id, prompt_id)
                rows = await (
                    await db.execute(
                        SUMMARY.replace(" AND r.revision=p.current_revision", "")
                        + " WHERE p.project_id=%s AND p.id=%s ORDER BY r.revision DESC LIMIT 21 OFFSET %s",
                        (project_id, prompt_id, offset),
                    )
                ).fetchall()
                return {
                    "items": rows[:20],
                    "next_offset": offset + 20 if len(rows) > 20 else None,
                }

    async def revise(self, user_id, project_id, prompt_id, body):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, True)
                row = await (
                    await db.execute(
                        "SELECT current_revision FROM agent_platform.prompts WHERE id=%s AND project_id=%s FOR UPDATE",
                        (prompt_id, project_id),
                    )
                ).fetchone()
                if not row:
                    raise PromptError(404, "Prompt not found")
                if row["current_revision"] != body.base_revision:
                    raise PromptError(
                        409, "A newer revision exists. Reload before saving."
                    )
                current = await self.read(db, project_id, prompt_id)
                if all(
                    current[key] == getattr(body, key)
                    for key in ("name", "description", "content")
                ):
                    return current
                revision = row["current_revision"] + 1
                await self.insert_revision(db, prompt_id, revision, user_id, body)
                await db.execute(
                    "UPDATE agent_platform.prompts SET current_revision=%s WHERE id=%s",
                    (revision, prompt_id),
                )
                return await self.read(db, project_id, prompt_id)
