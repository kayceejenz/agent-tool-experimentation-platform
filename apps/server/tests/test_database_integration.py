import asyncio
import time
from urllib.parse import urlsplit

import psycopg
import pytest
from api.main import create_app
from core.settings import Settings
from fastapi.testclient import TestClient
from integrations.database import Database

pytestmark = pytest.mark.integration


@pytest.fixture
def database_url(migration_settings):
    from migrations import migrate

    migrate(settings=migration_settings)
    return migration_settings.database_url.get_secret_value()


def test_readiness_connects_to_intended_database_and_recovers_stale_connection(
    database_url,
):
    app = create_app(Settings(_env_file=None, database_url=database_url))

    async def identity():
        async with app.state.database.connection() as connection:
            cursor = await connection.execute(
                "SELECT current_database(), pg_backend_pid()"
            )
            return await cursor.fetchone()

    with TestClient(app) as client:
        assert client.get("/ready").json() == {
            "status": "ready",
            "database": "available",
        }
        name, pid = client.portal.call(identity)
        assert name == urlsplit(database_url).path.lstrip("/")

        # Terminate only our own checked-out-and-returned connection in the test database.
        with psycopg.connect(database_url, autocommit=True) as connection:
            connection.execute("SELECT pg_terminate_backend(%s)", (pid,))
        assert client.get("/ready").status_code == 200
        assert client.get("/health").status_code == 200
    assert app.state.database.pool.closed


def test_pool_exhaustion_is_bounded_and_recovers(database_url):
    async def check():
        database = Database(
            Settings(
                _env_file=None,
                database_url=database_url,
                database_pool_min_size=1,
                database_pool_max_size=1,
                database_pool_timeout=0.15,
            )
        )
        try:
            await database.open()
            await database.pool.wait(timeout=5)
            async with database.connection():
                start = time.monotonic()
                assert await database.is_ready() is False
                assert time.monotonic() - start < 1
            assert await database.is_ready() is True
        finally:
            await database.close()
        assert database.pool.closed

    asyncio.run(check())


def test_readiness_rejects_missing_pending_changed_and_extra_history(
    migration_settings,
):
    from migrations import migrate

    config = migration_settings
    with TestClient(create_app(config)) as client:
        assert client.get("/ready").status_code == 503
        migrate(settings=config)
        assert client.get("/ready").status_code == 200
        with psycopg.connect(
            config.database_url.get_secret_value(), autocommit=True
        ) as conn:
            conn.execute(
                "UPDATE agent_platform.schema_migrations SET checksum = repeat('0', 64)"
            )
            assert client.get("/ready").status_code == 503
            from migrations import discover_migrations

            for migration in discover_migrations():
                conn.execute(
                    "UPDATE agent_platform.schema_migrations SET checksum = %s WHERE version = %s",
                    (migration.checksum, migration.version),
                )
            conn.execute(
                "INSERT INTO agent_platform.schema_migrations VALUES (999, '999_future.sql', repeat('0',64), now())"
            )
            assert client.get("/ready").status_code == 503
            conn.execute(
                "DELETE FROM agent_platform.schema_migrations WHERE version = 999"
            )
            assert client.get("/ready").status_code == 200
            conn.execute("DELETE FROM agent_platform.schema_migrations")
            assert client.get("/ready").status_code == 503
        assert client.get("/health").status_code == 200


def test_query_timeout_rolls_back_and_pool_recovers(database_url):
    async def check():
        database = Database(
            Settings(
                _env_file=None,
                database_url=database_url,
                database_statement_timeout_ms=100,
                database_idle_transaction_timeout_ms=2000,
                database_lock_timeout_ms=100,
            )
        )
        await database.open()
        try:
            with pytest.raises(psycopg.errors.QueryCanceled):
                async with database.connection() as conn:
                    await conn.execute("SELECT pg_sleep(2)")
            assert await database.is_ready()
            async with database.connection() as conn:
                cursor = await conn.execute("SHOW idle_in_transaction_session_timeout")
                assert await cursor.fetchone() == ("2s",)
                cursor = await conn.execute("SHOW lock_timeout")
                assert await cursor.fetchone() == ("100ms",)
        finally:
            await database.close()

    asyncio.run(check())
