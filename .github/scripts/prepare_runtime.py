"""Prepare an isolated production login and runtime env without printing secrets.

Run with the server virtualenv: .github/scripts/prepare_runtime.py /path/to/.env.prod /path/to/.env.runtime
Migrations must already have been applied to the separate agent database.
"""

import argparse
import re
import secrets
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg
from core.settings import Settings
from dotenv import dotenv_values, set_key
from migrations import discover_migrations
from pglast import ast, parse_sql
from psycopg import sql


def direct_url(value):
    url = urlsplit(value)
    if url.hostname and url.hostname.endswith(".neon.tech"):
        value = value.replace(url.hostname, url.hostname.replace("-pooler.", "."), 1)
    return value


def prepare(production_path, runtime_path, sandbox_image=None, sandbox_image_id=None):
    production_path = Path(production_path)
    runtime_path = Path(runtime_path)
    config = Settings(_env_file=production_path)
    migration_url = direct_url(
        (config.migration_database_url or config.database_url).get_secret_value()
    )
    runtime_url = urlsplit(direct_url(config.database_url.get_secret_value()))
    # Reuse only a login already created by this tool; never rotate another app's role.
    if re.fullmatch(r"agent_platform_prod_[a-f0-9]{8}", runtime_url.username or ""):
        role = runtime_url.username
        password = runtime_url.password
    else:
        role = "agent_platform_prod_" + secrets.token_hex(4)
        password = secrets.token_urlsafe(36)
    with psycopg.connect(migration_url, connect_timeout=10) as connection:
        if not connection.execute(
            "SELECT to_regclass('agent_platform.schema_migrations') IS NOT NULL"
        ).fetchone()[0]:
            raise RuntimeError(
                "Apply agent migrations before preparing the runtime role"
            )
        exists = connection.execute(
            "SELECT 1 FROM pg_roles WHERE rolname=%s", (role,)
        ).fetchone()
        if not exists:
            connection.execute(
                sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(
                    sql.Identifier(role), sql.Literal(password)
                )
            )
        connection.execute(
            sql.SQL("GRANT USAGE ON SCHEMA agent_platform TO {}").format(
                sql.Identifier(role)
            )
        )
        connection.execute(
            sql.SQL("GRANT SELECT ON agent_platform.schema_migrations TO {}").format(
                sql.Identifier(role)
            )
        )
        # Reapply the reviewed migration GRANT blocks to the isolated runtime role.
        # Do not grant schema ownership or blanket access to unrelated application tables.
        for migration in discover_migrations():
            for statement in parse_sql(migration.sql):
                if isinstance(statement.stmt, ast.DoStmt):
                    start = statement.stmt_location
                    end = (
                        start + statement.stmt_len
                        if statement.stmt_len
                        else len(migration.sql)
                    )
                    grant = migration.sql[start:end]
                    if "agent_platform_api" in grant and "GRANT" in grant:
                        connection.execute(grant.replace("agent_platform_api", role))
    host = runtime_url.hostname
    if runtime_url.port:
        host += ":" + str(runtime_url.port)
    login_url = urlunsplit(
        runtime_url._replace(
            netloc=quote(role, safe="") + ":" + quote(password, safe="") + "@" + host
        )
    )
    production_path.chmod(0o600)
    set_key(production_path, "AGENT_DATABASE_URL", login_url)
    set_key(production_path, "AGENT_MIGRATION_DATABASE_URL", migration_url)
    set_key(production_path, "AGENT_POSTGRES_PASSWORD", password)
    if sandbox_image is not None:
        set_key(production_path, "AGENT_SANDBOX_IMAGE", sandbox_image)
    if sandbox_image_id is not None:
        # Validate before publishing the runtime environment.
        Settings(_env_file=production_path, sandbox_image_id=sandbox_image_id)
        set_key(production_path, "AGENT_SANDBOX_IMAGE_ID", sandbox_image_id)
    values = dotenv_values(production_path)
    runtime_path.touch(mode=0o600)
    runtime_path.write_text("")
    for key, value in values.items():
        if (
            key not in {"AGENT_MIGRATION_DATABASE_URL", "AGENT_POSTGRES_PASSWORD"}
            and value is not None
        ):
            set_key(runtime_path, key, value)
    production_path.chmod(0o600)
    runtime_path.chmod(0o600)
    print(
        "Dedicated production runtime role and protected runtime environment prepared."
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("production_path")
    parser.add_argument("runtime_path")
    parser.add_argument("--sandbox-image")
    parser.add_argument("--sandbox-image-id")
    args = parser.parse_args()
    prepare(
        args.production_path,
        args.runtime_path,
        args.sandbox_image,
        args.sandbox_image_id,
    )
