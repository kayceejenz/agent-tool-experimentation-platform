"""Apply reviewed, ordered SQL files using a dedicated PostgreSQL connection."""

import argparse
import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import psycopg
from core.settings import Settings
from pglast import ast, parse_sql
from pglast.parser import ParseError
from pydantic import ValidationError

MIGRATION_PATTERN = re.compile(r"^(\d{3})_([a-z][a-z0-9_]*)\.sql$")
LOCK_KEY = int.from_bytes(
    hashlib.sha256(b"agent_platform.schema_migrations").digest()[:8], "big", signed=True
)


class MigrationError(Exception):
    """An actionable migration failure safe to display without credentials or SQL."""


@dataclass(frozen=True)
class Migration:
    version: int
    filename: str
    checksum: str
    sql: str


def migration_directory() -> Path:
    return Path(__file__).resolve().parent


def discover_migrations(directory: Path | None = None) -> list[Migration]:
    root = directory if directory is not None else migration_directory()
    migrations = []
    for path in sorted(root.glob("*.sql")):
        match = MIGRATION_PATTERN.fullmatch(path.name)
        if match is None:
            raise MigrationError(f"Invalid migration filename: {path.name}")
        raw = path.read_bytes()
        try:
            source = raw.decode("utf-8")
            statements = parse_sql(source)
        except (UnicodeDecodeError, ParseError):
            raise MigrationError(f"Invalid SQL in {path.name}") from None
        if not statements:
            raise MigrationError(f"Empty migration: {path.name}")
        # The runner owns transactions. Parse SQL so BEGIN inside a function or
        # comments is distinguished from a command that could commit partial DDL.
        if any(
            isinstance(statement.stmt, ast.TransactionStmt) for statement in statements
        ):
            raise MigrationError(f"Transaction commands are not allowed in {path.name}")
        migrations.append(
            Migration(int(match[1]), path.name, hashlib.sha256(raw).hexdigest(), source)
        )
    if not migrations:
        raise MigrationError("No migrations found")
    if [item.version for item in migrations] != list(range(1, len(migrations) + 1)):
        raise MigrationError(
            "Migration versions must be unique and consecutive, starting at 001"
        )
    return migrations


def applied_migrations(connection: psycopg.Connection) -> dict[int, tuple[str, str]]:
    if (
        connection.execute(
            "SELECT to_regclass('agent_platform.schema_migrations')"
        ).fetchone()[0]
        is None
    ):
        return {}
    rows = connection.execute(
        "SELECT version, filename, checksum FROM agent_platform.schema_migrations ORDER BY version"
    ).fetchall()
    return {version: (filename, checksum) for version, filename, checksum in rows}


def validate_history(
    migrations: list[Migration], applied: dict[int, tuple[str, str]]
) -> None:
    available = {item.version: item for item in migrations}
    for version, (filename, checksum) in applied.items():
        item = available.get(version)
        if item is None:
            raise MigrationError(
                f"Applied migration {version:03d} is missing from this release"
            )
        if (item.filename, item.checksum) != (filename, checksum):
            raise MigrationError(
                f"Applied migration {version:03d} was changed; add a new migration instead"
            )
    if sorted(applied) != [item.version for item in migrations[: len(applied)]]:
        raise MigrationError(
            "Migration history has a gap; refusing to apply out-of-order changes"
        )


def ensure_ledger(connection: psycopg.Connection) -> None:
    connection.execute("CREATE SCHEMA IF NOT EXISTS agent_platform")
    connection.execute("""
        CREATE TABLE IF NOT EXISTS agent_platform.schema_migrations (
            version integer PRIMARY KEY CHECK (version > 0),
            filename text NOT NULL UNIQUE,
            checksum char(64) NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now()
        )
    """)


def migrate(
    *,
    settings: Settings | None = None,
    directory: Path | None = None,
    status_only: bool = False,
) -> list[str]:
    migrations = discover_migrations(directory)
    config = settings if settings is not None else Settings()
    url = config.migration_database_url or config.database_url
    if url is None:
        raise MigrationError("Set AGENT_MIGRATION_DATABASE_URL or AGENT_DATABASE_URL")
    # A session lock belongs to this direct connection and is released on close,
    # including on errors. Do not use a transaction-pooling endpoint here.
    with psycopg.connect(
        url.get_secret_value(),
        autocommit=True,
        connect_timeout=config.database_connect_timeout,
    ) as connection:
        connection.execute("SELECT set_config('statement_timeout', '60000', false)")
        connection.execute("SELECT set_config('lock_timeout', '5000', false)")
        if not connection.execute(
            "SELECT pg_try_advisory_lock(%s)", (LOCK_KEY,)
        ).fetchone()[0]:
            raise MigrationError(
                "Another migration runner is active; retry after it finishes"
            )
        applied = applied_migrations(connection)
        validate_history(migrations, applied)
        if status_only:
            # In particular, do not create a schema or ledger on a fresh database.
            return [
                f"{item.filename}: {'applied' if item.version in applied else 'pending'}"
                for item in migrations
            ]
        messages = []
        for item in migrations:
            if item.version in applied:
                continue
            try:
                with connection.transaction():
                    ensure_ledger(connection)
                    connection.execute(item.sql)
                    connection.execute(
                        "INSERT INTO agent_platform.schema_migrations (version, filename, checksum) VALUES (%s, %s, %s)",
                        (item.version, item.filename, item.checksum),
                    )
            except psycopg.Error as error:
                raise MigrationError(
                    f"Migration {item.filename} failed (SQLSTATE {error.sqlstate or 'unknown'}); "
                    "its changes were rolled back"
                ) from None
            messages.append(f"Applied {item.filename}")
        return messages or ["Database schema is up to date"]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply agent-platform database migrations"
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show applied/pending migrations without changing the database",
    )
    args = parser.parse_args()
    try:
        messages = migrate(status_only=args.status)
    except MigrationError as error:
        print(f"Migration error: {error}", file=sys.stderr)
        return 1
    except ValidationError:
        print("Migration error: invalid database settings", file=sys.stderr)
        return 1
    except psycopg.Error as error:
        print(
            f"Migration error: database operation failed (SQLSTATE {error.sqlstate or 'unknown'}); check connectivity and permissions",
            file=sys.stderr,
        )
        return 1
    except OSError:
        print("Migration error: could not read migration files", file=sys.stderr)
        return 1
    for message in messages:
        print(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
