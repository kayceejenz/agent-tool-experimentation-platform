from fastapi import HTTPException
from psycopg.rows import dict_row


class DatasetRepository:
    def __init__(self, database):
        self.database = database

    @staticmethod
    async def member(db, user_id, project_id, write=False):
        row = await (
            await db.execute(
                "SELECT role FROM agent_platform.project_members WHERE project_id=%s AND user_id=%s FOR SHARE",
                (project_id, user_id),
            )
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Project not found")
        if write and row["role"] not in ("owner", "editor"):
            raise HTTPException(403, "Your role cannot upload datasets")

    async def authorize(self, user_id, project_id, write=False):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, write)

    async def create(self, user_id, project_id, dataset_id, name, files):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, True)
                await db.execute(
                    "INSERT INTO agent_platform.datasets(id,project_id,name,created_by) VALUES (%s,%s,%s,%s)",
                    (dataset_id, project_id, name, user_id),
                )
                for file in files:
                    await db.execute(
                        "INSERT INTO agent_platform.dataset_files(id,dataset_id,name,size_bytes,sha256) VALUES (%s,%s,%s,%s,%s)",
                        (
                            file["id"],
                            dataset_id,
                            file["name"],
                            file["size_bytes"],
                            file["sha256"],
                        ),
                    )

    async def list(self, user_id, project_id, offset=0):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id)
                return await (
                    await db.execute(
                        "SELECT id,name,created_at FROM agent_platform.datasets WHERE project_id=%s ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET %s",
                        (project_id, offset),
                    )
                ).fetchall()

    async def get(self, user_id, project_id, dataset_id):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id)
                row = await (
                    await db.execute(
                        "SELECT id,name,created_at FROM agent_platform.datasets WHERE project_id=%s AND id=%s",
                        (project_id, dataset_id),
                    )
                ).fetchone()
                if row is None:
                    raise HTTPException(404, "Dataset not found")
                row["files"] = await (
                    await db.execute(
                        "SELECT id,name,size_bytes,sha256 FROM agent_platform.dataset_files WHERE dataset_id=%s ORDER BY name",
                        (dataset_id,),
                    )
                ).fetchall()
                return row
