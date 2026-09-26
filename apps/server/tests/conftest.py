import os
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import psycopg
import pytest
from core.settings import Settings
from psycopg import sql


@pytest.fixture(autouse=True)
def isolate_agent_environment(monkeypatch):
    """Unit settings never inherit application credentials; retain explicit test URL."""
    for name in tuple(os.environ):
        if name.startswith("AGENT_") and name != "AGENT_TEST_DATABASE_URL":
            monkeypatch.delenv(name)


@pytest.fixture
def migration_settings():
    base = os.environ.get("AGENT_TEST_DATABASE_URL")
    if not base:
        pytest.skip("Set AGENT_TEST_DATABASE_URL to a dedicated test database")

    url = urlsplit(base)

    if not url.path.endswith("_test"):
        pytest.fail("Migration tests require a dedicated database ending in _test")

    name = f"agent_migration_{uuid4().hex}_test"
    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))

    try:
        yield Settings(
            _env_file=None, database_url=urlunsplit(url._replace(path=f"/{name}"))
        )
    finally:
        with psycopg.connect(base, autocommit=True) as admin:
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
            )
