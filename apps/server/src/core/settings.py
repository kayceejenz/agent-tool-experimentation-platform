from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AGENT_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    api_host: str = "127.0.0.1"
    api_port: int = Field(default=8001, ge=1, le=65535)
