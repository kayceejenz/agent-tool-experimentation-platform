from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import (
    Field,
    PostgresDsn,
    SecretStr,
    TypeAdapter,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AGENT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    api_host: str = "127.0.0.1"
    api_port: int = Field(default=8001, ge=1, le=65535)
    database_url: SecretStr | None = None
    migration_database_url: SecretStr | None = None
    database_pool_min_size: int = Field(default=1, ge=0, le=20)
    database_pool_max_size: int = Field(default=5, ge=1, le=20)
    database_pool_timeout: float = Field(default=2.0, gt=0, le=30, allow_inf_nan=False)
    database_connect_timeout: int = Field(default=3, ge=2, le=30)
    database_readiness_timeout: float = Field(
        default=3.0, gt=0, le=30, allow_inf_nan=False
    )

    database_statement_timeout_ms: int = Field(default=10000, ge=1, le=300000)
    database_idle_transaction_timeout_ms: int = Field(default=10000, ge=1, le=300000)
    database_lock_timeout_ms: int = Field(default=2000, ge=1, le=300000)

    app_env: Literal["development", "production"] = "development"
    auth_origins: list[str] = [
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:8001",
    ]
    jwt_secret: SecretStr | None = Field(default=None, min_length=32)
    jwt_issuer: str = "agent-platform"
    jwt_audience: str = "agent-platform-api"
    access_token_minutes: int = Field(default=15, ge=1, le=60)
    refresh_token_days: int = Field(default=30, ge=1, le=90)
    registration_invitation_code: SecretStr | None = None
    registration_rate_limit: int = Field(default=5, ge=1, le=100)
    registration_rate_window_seconds: int = Field(default=3600, ge=60, le=86400)
    login_rate_limit: int = Field(default=10, ge=1, le=1000)
    login_rate_window_seconds: int = Field(default=900, ge=60, le=86400)
    refresh_cookie_name: str = "agent_refresh_token"

    @field_validator("auth_origins")
    @classmethod
    def validate_origins(cls, values: list[str]) -> list[str]:
        if not values:
            raise ValueError("At least one exact authentication origin is required")
        for value in values:
            parsed = urlsplit(value)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.path
                or parsed.query
                or parsed.fragment
                or "*" in value
            ):
                raise ValueError(
                    "Authentication origins must be exact HTTP(S) origins without paths"
                )
        return values

    @field_validator("database_url", "migration_database_url")
    @classmethod
    def validate_database_url(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None:
            return None
        try:
            url = TypeAdapter(PostgresDsn).validate_python(value.get_secret_value())
            if (
                url.scheme not in {"postgres", "postgresql"}
                or not url.path
                or url.path == "/"
            ):
                raise ValueError
        except ValueError:
            raise ValueError(
                "Database URL must be a PostgreSQL URL with an explicit database name"
            ) from None
        return value

    @model_validator(mode="after")
    def validate_pool_sizes(self) -> Self:
        if self.database_pool_min_size > self.database_pool_max_size:
            raise ValueError("Database pool minimum cannot exceed its maximum")

        if self.app_env == "production" and any(
            not origin.startswith("https://") for origin in self.auth_origins
        ):
            raise ValueError("Production authentication origins require HTTPS")

        if self.app_env == "production":
            if self.jwt_secret is None:
                raise ValueError("Production requires AGENT_JWT_SECRET")

            if self.registration_invitation_code is None:
                raise ValueError("Production requires a registration invitation code")

        return self
