from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

PromptType = Literal["system", "agent", "evaluation"]


class PromptFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    content: str = Field(min_length=1, max_length=32000)

    @field_validator("name", "description", "content")
    @classmethod
    def no_null_characters(cls, value):
        if "\x00" in value:
            raise ValueError("Null characters are unsupported")
        return value

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError("Name is required")
        return value.strip()

    @field_validator("content")
    @classmethod
    def nonempty_content(cls, value):
        if not value.strip() or "\x00" in value:
            raise ValueError(
                "Instructions are required and cannot contain null characters"
            )
        return value


class CreatePromptRequest(PromptFields):
    type: PromptType


class CreateRevisionRequest(PromptFields):
    base_revision: int = Field(ge=1, strict=True)


class PromptSummary(BaseModel):
    id: UUID
    type: PromptType
    revision: int
    name: str
    description: str
    created_by: UUID
    created_at: datetime


class PromptResponse(PromptSummary):
    content: str


class PromptPage(BaseModel):
    items: list[PromptSummary]
    next_offset: int | None
