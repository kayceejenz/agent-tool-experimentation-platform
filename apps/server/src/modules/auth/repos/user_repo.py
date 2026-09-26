from contextlib import asynccontextmanager
from uuid import UUID

from integrations.database import Database
from psycopg.errors import UniqueViolation
from psycopg.rows import dict_row

from modules.auth.models.auth_user_model import AuthenticatedUser
from modules.auth.models.error_model import AccountAlreadyExistsError
from modules.auth.models.password_account_model import PasswordAccount


class UserRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    @asynccontextmanager
    async def connect(self):
        async with self.database.connection() as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                yield cursor

    @staticmethod
    def account(row) -> PasswordAccount:
        user = AuthenticatedUser(
            row["id"], row["email"], row["display_name"], row["token_version"]
        )
        return PasswordAccount(
            user, row["password_hash"], row["is_active"], row["locked_until"]
        )

    async def find_by_email(self, email: str) -> PasswordAccount | None:
        async with self.connect() as db:
            row = await (
                await db.execute(
                    "select * from agent_platform.users where email=%s and deleted_at is null",
                    (email,),
                )
            ).fetchone()
        return self.account(row) if row else None

    async def find_by_id(self, user_id: UUID) -> PasswordAccount | None:
        async with self.connect() as db:
            row = await (
                await db.execute(
                    "select * from agent_platform.users where id=%s and deleted_at is null",
                    (user_id,),
                )
            ).fetchone()
        return self.account(row) if row else None

    async def create(
        self, email: str, password_hash: str, display_name: str | None
    ) -> PasswordAccount:
        try:
            async with self.connect() as db:
                row = await (
                    await db.execute(
                        "insert into agent_platform.users(email,password_hash,display_name) values(%s,%s,%s) returning *",
                        (email, password_hash, display_name),
                    )
                ).fetchone()
        except UniqueViolation:
            raise AccountAlreadyExistsError from None
        return self.account(row)

    async def record_success(self, account: PasswordAccount) -> None:
        async with self.connect() as db:
            await db.execute(
                "update agent_platform.users set failed_login_attempts=0, locked_until=null, last_login_at=now() where id=%s",
                (account.user.id,),
            )

    async def record_failure(self, account: PasswordAccount) -> None:
        async with self.connect() as db:
            await db.execute(
                "update agent_platform.users set failed_login_attempts=failed_login_attempts+1, locked_until=case when failed_login_attempts+1>=5 then now()+interval '15 minutes' else locked_until end where id=%s",
                (account.user.id,),
            )
