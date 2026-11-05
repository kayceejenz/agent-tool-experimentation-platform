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
            raise HTTPException(403, "Your role cannot modify datasets")

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
                return await self.read(db, project_id, dataset_id)

    @staticmethod
    async def read(db, project_id, dataset_id):
        await db.execute(
            "SELECT pg_advisory_xact_lock_shared(hashtextextended(%s,0))",
            ("dataset:" + str(dataset_id),),
        )
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

    async def delete(self, user_id, project_id, dataset_id, remove_files):
        async with self.database.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as db:
                await self.member(db, user_id, project_id, True)
                await db.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                    ("dataset:" + str(dataset_id),),
                )
                row = await (
                    await db.execute(
                        "SELECT id FROM agent_platform.datasets WHERE project_id=%s AND id=%s",
                        (project_id, dataset_id),
                    )
                ).fetchone()
                if row is None:
                    raise HTTPException(404, "Dataset not found")
                # Enqueue holds a shared dataset lock until its run is recorded.
                active = await (
                    await db.execute(
                        "SELECT id FROM agent_platform.agent_executions WHERE project_id=%s AND status IN ('queued','running') AND snapshot#>>'{analysis,dataset,id}'=%s LIMIT 1",
                        (project_id, str(dataset_id)),
                    )
                ).fetchone()
                if active:
                    raise HTTPException(
                        409,
                        "Wait for analyses using this dataset to finish or cancel them before deleting it",
                    )
                await remove_files()
                await db.execute(
                    "DELETE FROM agent_platform.datasets WHERE id=%s", (dataset_id,)
                )
