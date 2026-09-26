import pytest
from core.settings import Settings
from pydantic import ValidationError


@pytest.mark.parametrize(
    "values",
    [
        {"database_pool_min_size": 3, "database_pool_max_size": 2},
        {"database_pool_timeout": float("inf")},
        {"database_url": "https://user:secret@example.com/app"},
        {"database_url": "postgresql://user:secret@localhost"},
        {"database_url": ""},
    ],
)
def test_rejects_invalid_database_configuration(values):
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, **values)
    assert "secret" not in str(error.value)


def test_database_url_is_redacted_and_defaults_are_valid():
    settings = Settings(
        _env_file=None,
        database_url="postgresql://agent:private-password@localhost:5433/agent_platform",
    )
    assert "private-password" not in repr(settings)
    assert "private-password" not in settings.model_dump_json()
    assert settings.database_pool_min_size <= settings.database_pool_max_size
