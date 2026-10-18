from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SaveBenchmark(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    capture_id: UUID
    input: str = Field(min_length=1, max_length=16000)

    @field_validator("input")
    @classmethod
    def clean_input(cls, value):
        if not value.strip() or "\x00" in value:
            raise ValueError("A question is required")
        return value.strip()
