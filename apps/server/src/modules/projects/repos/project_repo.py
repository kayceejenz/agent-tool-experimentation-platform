from datetime import datetime
from uuid import UUID

from integrations.database import Database
from psycopg import sql
from psycopg.rows import dict_row

from modules.projects.models.error_model import (
    ProjectForbiddenError,
    ProjectNotFoundError,
)
from modules.projects.models.project_model import Project


class ProjectRepository:
    def __init__(self, database: Database):
        self.database = database

    async def create(
        self, user_id: UUID, name: str, description: str | None
    ) -> Project:
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                # Both inserts share the pool connection's transaction.
                row = await (
                    await db.execute(
                        "INSERT INTO agent_platform.projects(name, description, created_by) VALUES (%s,%s,%s) RETURNING *",
                        (name, description, user_id),
                    )
                ).fetchone()
                await db.execute(
                    "INSERT INTO agent_platform.project_members(project_id,user_id,role) VALUES (%s,%s,'owner')",
                    (row["id"], user_id),
                )
                return Project(**row, role="owner")

    async def list_for_user(
        self, user_id: UUID, limit: int, after: tuple[datetime, UUID] | None
    ) -> list[Project]:
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                statement = "SELECT p.*, m.role FROM agent_platform.projects p JOIN agent_platform.project_members m ON m.project_id=p.id WHERE m.user_id=%s"
                params = [user_id]
                if after:
                    statement += " AND (p.created_at,p.id) < (%s,%s)"
                    params.extend(after)
                statement += " ORDER BY p.created_at DESC,p.id DESC LIMIT %s"
                params.append(limit)
                rows = await (await db.execute(statement, params)).fetchall()
                return [Project(**row) for row in rows]

    async def get(self, user_id: UUID, project_id: UUID) -> Project:
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                row = await (
                    await db.execute(
                        "SELECT p.*,m.role FROM agent_platform.projects p JOIN agent_platform.project_members m ON m.project_id=p.id WHERE p.id=%s AND m.user_id=%s",
                        (project_id, user_id),
                    )
                ).fetchone()
                if row is None:
                    raise ProjectNotFoundError
                return Project(**row)

    async def update(self, user_id: UUID, project_id: UUID, changes: dict) -> Project:
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                # Lock the membership until commit. Concurrent role updates/deletions
                # must wait; if they committed first, this reads the new permission.
                member = await (
                    await db.execute(
                        "SELECT role FROM agent_platform.project_members WHERE project_id=%s AND user_id=%s FOR UPDATE",
                        (project_id, user_id),
                    )
                ).fetchone()
                if member is None:
                    raise ProjectNotFoundError
                if member["role"] not in ("owner", "editor"):
                    raise ProjectForbiddenError
                fields = [key for key in ("name", "description") if key in changes]
                statement = sql.SQL(
                    "UPDATE agent_platform.projects SET {} WHERE id=%s RETURNING *"
                ).format(
                    sql.SQL(", ").join(
                        sql.SQL("{}=%s").format(sql.Identifier(key)) for key in fields
                    )
                )
                row = await (
                    await db.execute(
                        statement, [changes[key] for key in fields] + [project_id]
                    )
                ).fetchone()
                if row is None:
                    raise ProjectNotFoundError
                return Project(**row, role=member["role"])
