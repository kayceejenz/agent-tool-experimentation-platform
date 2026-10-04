import json
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ToggleToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool
    revision: int = Field(ge=1)


class ExecuteToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1)
    request_id: UUID
    arguments: dict

    @field_validator("arguments")
    @classmethod
    def bounded_arguments(cls, value):
        if len(json.dumps(value, allow_nan=False).encode()) > 65536:
            raise ValueError("Arguments exceed 64 KB")
        return value
