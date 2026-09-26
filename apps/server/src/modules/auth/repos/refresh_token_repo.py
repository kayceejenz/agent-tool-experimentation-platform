from modules.auth.models.refresh_token_model import RefreshTokenSession
from modules.auth.repos.user_repo import UserRepository


class RefreshTokenRepository:
    def __init__(self, users: UserRepository) -> None:
        self.users = users

    @staticmethod
    def session(row) -> RefreshTokenSession:
        return RefreshTokenSession(
            row["id"],
            row["user_id"],
            row["family_id"],
            row["token_hash"],
            row["expires_at"],
            row["revoked_at"],
        )

    async def create(
        self, user_id, family_id, token_hash, expires_at, user_agent, ip_address
    ):
        async with self.users.connect() as db:
            row = await (
                await db.execute(
                    "insert into agent_platform.refresh_tokens(user_id,family_id,token_hash,expires_at,user_agent,ip_address) values(%s,%s,%s,%s,%s,%s) returning *",
                    (
                        user_id,
                        family_id,
                        token_hash,
                        expires_at,
                        user_agent,
                        ip_address,
                    ),
                )
            ).fetchone()
        return self.session(row)

    async def find_by_hash(self, token_hash):
        async with self.users.connect() as db:
            row = await (
                await db.execute(
                    "select * from agent_platform.refresh_tokens where token_hash=%s",
                    (token_hash,),
                )
            ).fetchone()
        return self.session(row) if row else None

    async def rotate(self, current, replacement_hash, replacement_expires_at):
        async with self.users.connect() as db:
            await db.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (str(current.family_id),),
            )
            replacement = await (
                await db.execute(
                    "insert into agent_platform.refresh_tokens(user_id,family_id,token_hash,expires_at) values(%s,%s,%s,%s) returning *",
                    (
                        current.user_id,
                        current.family_id,
                        replacement_hash,
                        replacement_expires_at,
                    ),
                )
            ).fetchone()

            result = await db.execute(
                "update agent_platform.refresh_tokens set revoked_at=now(), last_used_at=now(), replaced_by_token_id=%s, revoke_reason='rotated' where id=%s and revoked_at is null",
                (replacement["id"], current.id),
            )
            if result.rowcount != 1:
                raise ValueError("Refresh token already consumed")
        return self.session(replacement)

    async def revoke_family(self, family_id, reason):
        async with self.users.connect() as db:
            await db.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (str(family_id),),
            )
            await db.execute(
                "update agent_platform.refresh_tokens set revoked_at=coalesce(revoked_at,now()), revoke_reason=coalesce(revoke_reason,%s) where family_id=%s",
                (reason, family_id),
            )
