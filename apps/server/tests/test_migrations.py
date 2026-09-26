import hashlib

import pytest
from core.settings import Settings
from migrations import MigrationError, discover_migrations, migrate, validate_history


def test_discovers_sorted_files_and_hashes_exact_bytes(tmp_path):
    (tmp_path / "002_second.sql").write_text("SELECT 2;\n")
    first = b"-- first migration\nSELECT 1;\n"
    (tmp_path / "001_first.sql").write_bytes(first)
    found = discover_migrations(tmp_path)
    assert [m.version for m in found] == [1, 2]
    assert found[0].checksum == hashlib.sha256(first).hexdigest()


@pytest.mark.parametrize(
    "files",
    [
        {},
        {"bad.sql": "SELECT 1;"},
        {"000_bad.sql": "SELECT 1;"},
        {"002_gap.sql": "SELECT 1;"},
        {"001_a.sql": "SELECT 1;", "001_b.sql": "SELECT 2;"},
        {"001_empty.sql": "-- comment only"},
        {"001_invalid.sql": "CREATE NOT SQL;"},
        {"001_transaction.sql": "BEGIN; SELECT 1; COMMIT;"},
        {"001_transaction.sql": "SELECT 1; /* boundary */ COMMIT;"},
        {"001_transaction.sql": "SAVEPOINT bad;"},
    ],
)
def test_rejects_invalid_migrations(tmp_path, files):
    for name, sql in files.items():
        (tmp_path / name).write_text(sql)
    with pytest.raises(MigrationError):
        discover_migrations(tmp_path)


def test_plpgsql_begin_is_allowed():
    assert discover_migrations()[0].filename == "001_foundation.sql"


def test_history_must_match_and_have_no_gaps(tmp_path):
    (tmp_path / "001_first.sql").write_text("SELECT 1;")
    (tmp_path / "002_second.sql").write_text("SELECT 2;")
    first, second = discover_migrations(tmp_path)
    with pytest.raises(MigrationError, match="changed"):
        validate_history([first, second], {1: (first.filename, "incorrect")})
    with pytest.raises(MigrationError, match="gap"):
        validate_history([first, second], {2: (second.filename, second.checksum)})
    with pytest.raises(MigrationError, match="missing"):
        validate_history([first], {2: (second.filename, second.checksum)})


def test_missing_database_configuration_is_actionable():
    with pytest.raises(MigrationError, match="AGENT_MIGRATION_DATABASE_URL"):
        migrate(settings=Settings(_env_file=None))
