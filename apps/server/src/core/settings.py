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

    sandbox_storage_root: str = "./var/sandboxes"
    # Download availability window; physical cleanup remains operator-managed.
    sandbox_artifact_retention_days: int = Field(default=7, ge=1, le=365)
    sandbox_image: str = "agent-analysis:phase2"
    # Production pins this after loading the image; the API needs no Docker socket.
    sandbox_image_id: str | None = Field(default=None, pattern=r"^sha256:[0-9a-f]{64}$")
    sandbox_command_seconds: int = Field(default=60, ge=1, le=300)
    sandbox_session_seconds: int = Field(default=300, ge=1, le=900)

    # Explicit selection avoids silently falling back to ephemeral files in production.
    file_storage_backend: Literal["local", "r2"] = "local"
    r2_endpoint_url: str | None = None
    r2_bucket_name: str | None = None
    r2_access_key_id: SecretStr | None = None
    r2_secret_access_key: SecretStr | None = None
    r2_prefix: str = Field(
        default="agent-platform", pattern=r"^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,127}$"
    )
    sandbox_memory_mb: int = Field(default=2048, ge=256, le=8192)
    sandbox_cpus: float = Field(default=2, gt=0, le=8)

    dataset_storage_root: str = "./var/datasets"
    dataset_file_limit_bytes: int = Field(default=128 * 1024 * 1024, ge=1)
    dataset_total_limit_bytes: int = Field(default=128 * 1024 * 1024, ge=1)

    api_host: str = "127.0.0.1"
    api_port: int = Field(default=8001, ge=1, le=65535)
    openai_api_key: SecretStr | None = None
    google_api_key: SecretStr | None = None
    anthropic_api_key: SecretStr | None = None
    ollama_base_url: str = "http://127.0.0.1:11434/v1/"
    ollama_api_key: SecretStr | None = None

    @field_validator(
        "openai_api_key",
        "google_api_key",
        "anthropic_api_key",
        "ollama_api_key",
        mode="before",
    )
    @classmethod
    def empty_openai_key(cls, value):
        return None if value == "" else value

    @field_validator("ollama_base_url")
    @classmethod
    def validate_ollama_url(cls, value):
        url = urlsplit(value)
        if (
            url.scheme not in ("http", "https")
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
        ):
            raise ValueError(
                "Set an absolute Ollama HTTP base URL without credentials or query parameters"
            )
        return value.rstrip("/") + "/"

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
    auth_proxy_secret: SecretStr | None = Field(default=None, min_length=32)
    mcp_credential_key: SecretStr | None = None
    mcp_development_origins: list[str] = []
    refresh_cookie_name: str = "agent_refresh_token"

    @field_validator("mcp_credential_key", mode="before")
    @classmethod
    def empty_mcp_key(cls, value):
        return None if value == "" else value

    @field_validator("mcp_credential_key")
    @classmethod
    def validate_mcp_key(cls, value):
        from integrations.mcp.credential_cipher import CredentialCipher

        CredentialCipher(value)
        return value

    @field_validator("mcp_development_origins")
    @classmethod
    def validate_mcp_origins(cls, values):
        for value in values:
            parsed = urlsplit(value)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError(
                    "MCP development origins must be exact HTTP(S) origins"
                )
        return values

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

        if self.file_storage_backend == "r2":
            if not all(
                (
                    self.r2_endpoint_url,
                    self.r2_bucket_name,
                    self.r2_access_key_id,
                    self.r2_secret_access_key,
                )
            ):
                raise ValueError(
                    "R2 storage requires endpoint, bucket and access credentials"
                )
            endpoint = urlsplit(self.r2_endpoint_url)
            if (
                endpoint.scheme != "https"
                or not endpoint.hostname
                or endpoint.username
                or endpoint.password
                or endpoint.query
                or endpoint.fragment
                or endpoint.path not in ("", "/")
            ):
                raise ValueError(
                    "R2 endpoint must be an HTTPS origin without credentials"
                )
            if ".." in self.r2_prefix.split("/"):
                raise ValueError("Invalid R2 prefix")
        return self
