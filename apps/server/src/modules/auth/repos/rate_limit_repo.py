from dataclasses import dataclass

from modules.auth.repos.user_repo import UserRepository


@dataclass(frozen=True)
class RateLimitUsage:
    attempts: int
    retry_after_seconds: int


class AuthRateLimitRepository:
    def __init__(self, users: UserRepository) -> None:
        self.users = users

    async def consume(
        self, action: str, client_key: str, window_seconds: int
    ) -> RateLimitUsage:
        async with self.users.connect() as db:
            row = await (
                await db.execute(
                    "insert into agent_platform.auth_rate_limits(action,client_key,window_started_at,attempt_count) values(%s,%s,now(),1) on conflict(action,client_key) do update set attempt_count=case when agent_platform.auth_rate_limits.window_started_at <=now()-make_interval(secs=>%s) then 1 else agent_platform.auth_rate_limits.attempt_count+1 end,window_started_at=case when agent_platform.auth_rate_limits.window_started_at <=now()-make_interval(secs=>%s) then now() else agent_platform.auth_rate_limits.window_started_at end returning attempt_count, greatest(1,ceil(extract(epoch from (window_started_at+make_interval(secs=>%s)-now()))))::integer as retry_after_seconds",
                    (
                        action,
                        client_key,
                        window_seconds,
                        window_seconds,
                        window_seconds,
                    ),
                )
            ).fetchone()
        return RateLimitUsage(
            attempts=int(row["attempt_count"]),
            retry_after_seconds=int(row["retry_after_seconds"]),
        )
