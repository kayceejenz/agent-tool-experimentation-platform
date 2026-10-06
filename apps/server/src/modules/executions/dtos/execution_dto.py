from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StartExecution(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1, strict=True)
    request_id: UUID
    input: str = Field(min_length=1, max_length=16000)

    @field_validator("input")
    @classmethod
    def clean_input(cls, value):
        if not value.strip() or "\x00" in value:
            raise ValueError("Task required")
        return value.strip()
