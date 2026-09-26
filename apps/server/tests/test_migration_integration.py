import time
from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest
from core.settings import Settings
from migrations import MigrationError, discover_migrations, migrate

pytestmark = pytest.mark.integration


def query(settings, text):
    with psycopg.connect(settings.database_url.get_secret_value()) as connection:
        return connection.execute(text).fetchall()


def test_status_does_not_initialize_database_and_rerun_is_safe(migration_settings):
    config = migration_settings
    assert migrate(settings=config, status_only=True) == [
        f"{m.filename}: pending" for m in discover_migrations()
    ]
    assert query(config, "SELECT to_regnamespace('agent_platform')") == [(None,)]
    assert migrate(settings=config) == [
        f"Applied {m.filename}" for m in discover_migrations()
    ]
    assert migrate(settings=config) == ["Database schema is up to date"]
    assert migrate(settings=config, status_only=True) == [
        f"{m.filename}: applied" for m in discover_migrations()
    ]
    assert query(config, "SELECT count(*) FROM agent_platform.schema_migrations") == [
        (len(discover_migrations()),)
    ]
    with psycopg.connect(config.database_url.get_secret_value()) as connection:
        connection.execute(
            "CREATE TEMP TABLE stamp_test (id int, updated_at timestamptz)"
        )
        connection.execute(
            "CREATE TRIGGER stamp BEFORE UPDATE ON stamp_test FOR EACH ROW EXECUTE FUNCTION agent_platform.set_updated_at()"
        )
        connection.execute("INSERT INTO stamp_test VALUES (1, '2000-01-01')")
        connection.execute("UPDATE stamp_test SET id = 2")
        assert connection.execute(
            "SELECT updated_at = now() FROM stamp_test"
        ).fetchone() == (True,)


def test_modified_missing_and_renamed_applied_files_are_rejected(
    migration_settings, tmp_path
):
    first = tmp_path / "001_first.sql"
    first.write_text("SELECT 1;")
    migrate(settings=migration_settings, directory=tmp_path)
    first.write_text("SELECT 2;")
    with pytest.raises(MigrationError, match="changed"):
        migrate(settings=migration_settings, directory=tmp_path)
    first.write_text("SELECT 1;")
    first.rename(tmp_path / "001_renamed.sql")
    with pytest.raises(MigrationError, match="changed"):
        migrate(settings=migration_settings, directory=tmp_path, status_only=True)
    (tmp_path / "001_renamed.sql").unlink()
    with pytest.raises(MigrationError, match="No migrations"):
        migrate(settings=migration_settings, directory=tmp_path)


def test_failed_migration_rolls_back_ddl_and_ledger_then_can_retry(
    migration_settings, tmp_path
):
    (tmp_path / "001_first.sql").write_text(
        "CREATE TABLE agent_platform.kept (id int);"
    )
    second = tmp_path / "002_second.sql"
    second.write_text("CREATE TABLE agent_platform.rolled_back (id int); SELECT 1/0;")
    with pytest.raises(MigrationError, match="002_second.sql failed"):
        migrate(settings=migration_settings, directory=tmp_path)
    assert query(
        migration_settings, "SELECT to_regclass('agent_platform.rolled_back')"
    ) == [(None,)]
    assert query(
        migration_settings, "SELECT version FROM agent_platform.schema_migrations"
    ) == [(1,)]
    second.write_text("CREATE TABLE agent_platform.rolled_back (id int);")
    assert migrate(settings=migration_settings, directory=tmp_path) == [
        "Applied 002_second.sql"
    ]


def test_failed_first_migration_leaves_no_bootstrap_schema(
    migration_settings, tmp_path
):
    (tmp_path / "001_bad.sql").write_text(
        "CREATE TABLE agent_platform.rolled_back (id int); SELECT 1/0;"
    )
    with pytest.raises(MigrationError, match="rolled back"):
        migrate(settings=migration_settings, directory=tmp_path)
    assert query(migration_settings, "SELECT to_regnamespace('agent_platform')") == [
        (None,)
    ]


def test_concurrent_runner_is_rejected_before_bootstrap_and_lock_released(
    migration_settings, tmp_path
):
    (tmp_path / "001_slow.sql").write_text(
        "SELECT pg_sleep(2); CREATE TABLE agent_platform.once_only (id int);"
    )
    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(
            migrate, settings=migration_settings, directory=tmp_path
        )
        deadline = time.monotonic() + 5
        while not query(
            migration_settings,
            "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'PgSleep'",
        ):
            if time.monotonic() >= deadline:
                pytest.fail("First migration runner never entered the slow migration")
            time.sleep(0.02)
        with pytest.raises(MigrationError, match="Another migration runner"):
            migrate(settings=migration_settings, directory=tmp_path)
        assert first.result(timeout=5) == ["Applied 001_slow.sql"]
    assert migrate(settings=migration_settings, directory=tmp_path) == [
        "Database schema is up to date"
    ]
    assert query(
        migration_settings, "SELECT count(*) FROM agent_platform.schema_migrations"
    ) == [(1,)]


def test_direct_migration_url_takes_precedence(migration_settings):
    config = Settings(
        _env_file=None,
        database_url="postgresql://unused:unused@127.0.0.1:1/unreachable",
        migration_database_url=migration_settings.database_url,
    )
    assert migrate(settings=config) == [
        f"Applied {m.filename}" for m in discover_migrations()
    ]
