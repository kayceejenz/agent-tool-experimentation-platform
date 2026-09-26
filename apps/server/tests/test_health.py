import asyncio
import socket
import time
from contextlib import asynccontextmanager

from api.main import create_app
from core.settings import Settings
from fastapi.testclient import TestClient
from integrations.database import Database


def test_liveness_available_without_database_configuration():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.get("/health").json() == {"status": "ok"}
        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json() == {"status": "not_ready", "database": "unavailable"}
        assert response.headers["cache-control"] == "no-store"


def test_unreachable_database_is_bounded_redacted_and_pool_closes(caplog):
    # Reserve a local, non-listening TCP port instead of assuming a port is unused.
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        port = reserved.getsockname()[1]
        settings = Settings(
            _env_file=None,
            database_url=f"postgresql://agent:private-password@127.0.0.1:{port}/agent_test",
            database_pool_timeout=0.15,
            database_readiness_timeout=0.3,
        )
        app = create_app(settings)
        with TestClient(app) as client:
            start = time.monotonic()
            response = client.get("/ready")
            assert response.status_code == 503
            assert time.monotonic() - start < 2
            assert "private-password" not in response.text
            assert "postgresql" not in response.text
            assert client.get("/health").status_code == 200
        assert app.state.database.pool.closed
    assert "private-password" not in caplog.text


def test_readiness_deadline_covers_query_not_only_pool_checkout(monkeypatch):
    async def check():
        database = Database(
            Settings(
                _env_file=None,
                database_url="postgresql://agent:unused@127.0.0.1/agent_test",
                database_readiness_timeout=0.05,
            )
        )

        class SlowConnection:
            async def execute(self, query):
                await asyncio.sleep(10)

        released = []

        @asynccontextmanager
        async def slow_connection():
            try:
                yield SlowConnection()
            finally:
                released.append(True)

        class OpenPool:
            closed = False

        monkeypatch.setattr(database, "pool", OpenPool())
        monkeypatch.setattr(database, "connection", slow_connection)
        start = time.monotonic()
        assert await database.is_ready() is False
        assert time.monotonic() - start < 1
        assert released == [True]

    asyncio.run(check())
