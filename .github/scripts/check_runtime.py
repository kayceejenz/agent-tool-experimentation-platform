"""Deployment checks using the container's runtime credentials, never model calls."""

import argparse
import asyncio
import hashlib
import json
import time

import psycopg
from core.settings import Settings
from integrations.database import Database


def ledger(settings):
    with psycopg.connect(
        settings.database_url.get_secret_value(), connect_timeout=8
    ) as connection:
        connection.execute("SET TRANSACTION READ ONLY")
        rows = connection.execute(
            "SELECT version,filename,checksum FROM agent_platform.schema_migrations ORDER BY version"
        ).fetchall()
    return hashlib.sha256(json.dumps(rows).encode()).hexdigest()


def idle(settings, timeout):
    deadline = time.monotonic() + timeout
    while True:
        with psycopg.connect(
            settings.database_url.get_secret_value(), connect_timeout=8
        ) as connection:
            connection.execute("SET TRANSACTION READ ONLY")
            pending = connection.execute(
                "SELECT (SELECT count(*) FROM agent_platform.agent_executions WHERE status IN ('queued','running')) + (SELECT count(*) FROM agent_platform.execution_evaluations WHERE status IN ('queued','running'))"
            ).fetchone()[0]
        if not pending:
            print("Agent queues drained")
            return True
        if time.monotonic() >= deadline:
            print("Agent jobs are still active; deployment deferred")
            return False
        time.sleep(min(2, max(0, deadline - time.monotonic())))


async def ready(settings):
    database = Database(settings)
    try:
        await database.open()
        return await database.is_ready()
    finally:
        await database.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["ledger", "idle", "ready"])
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    settings = Settings(_env_file=None)
    try:
        if args.command == "ledger":
            print(ledger(settings))
            return 0
        if args.command == "idle":
            return 0 if idle(settings, args.timeout) else 1
        return 0 if asyncio.run(ready(settings)) else 1
    except psycopg.Error:
        print("Deployment database check failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
