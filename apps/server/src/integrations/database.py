import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from core.settings import Settings
from migrations import discover_migrations
from psycopg import AsyncConnection, Error
from psycopg_pool import AsyncConnectionPool, PoolClosed, PoolTimeout, TooManyRequests


class Database:
    """One pool per application lifespan; no connections are opened at import time."""

    def __init__(self, settings: Settings) -> None:
        self.expected_migrations = [
            (m.version, m.filename, m.checksum) for m in discover_migrations()
        ]
        self.readiness_timeout = settings.database_readiness_timeout
        self.pool: AsyncConnectionPool | None = None
        if settings.database_url is not None:
            self.pool = AsyncConnectionPool(
                settings.database_url.get_secret_value(),
                name="agent-platform",
                open=False,
                min_size=settings.database_pool_min_size,
                max_size=settings.database_pool_max_size,
                timeout=settings.database_pool_timeout,
                max_waiting=20,
                reconnect_timeout=30,
                check=AsyncConnectionPool.check_connection,
                kwargs={
                    "connect_timeout": settings.database_connect_timeout,
                    "options": (
                        f"-c statement_timeout={settings.database_statement_timeout_ms} "
                        f"-c idle_in_transaction_session_timeout={settings.database_idle_transaction_timeout_ms} "
                        f"-c lock_timeout={settings.database_lock_timeout_ms}"
                    ),
                },
            )

    async def open(self) -> None:
        if self.pool is not None:
            # Keep liveness available while PostgreSQL starts or reconnects.
            await self.pool.open(wait=False)

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[AsyncConnection]:
        if self.pool is None:
            raise RuntimeError("Database is not configured")
        async with self.pool.connection() as connection:
            yield connection

    async def is_ready(self) -> bool:
        if self.pool is None or self.pool.closed:
            return False
        try:
            async with asyncio.timeout(self.readiness_timeout):
                async with self.connection() as connection:
                    cursor = await connection.execute(
                        "SELECT version, filename, checksum FROM agent_platform.schema_migrations ORDER BY version"
                    )
                    return await cursor.fetchall() == self.expected_migrations
        except (Error, PoolClosed, PoolTimeout, TooManyRequests, TimeoutError):
            # Never return driver exception details or the connection URL to callers.
            return False
