from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Reference(StrictModel):
    id: UUID
    revision: int = Field(ge=1, strict=True)


class ModelSettings(StrictModel):
    provider: str = Field(default="", max_length=80, pattern=r"^[a-zA-Z0-9_.-]*$")
    model: str = Field(default="", max_length=160, pattern=r"^[a-zA-Z0-9_./:-]*$")
    temperature: float | None = Field(default=None, ge=0, le=2, allow_inf_nan=False)


class Limits(StrictModel):
    max_turns: int = Field(default=8, ge=1, le=50, strict=True)
    max_tool_calls: int = Field(default=10, ge=0, le=100, strict=True)
    timeout_seconds: int = Field(default=60, ge=1, le=300, strict=True)
    max_output_tokens: int = Field(default=2048, ge=1, le=32000, strict=True)


class AgentConfiguration(StrictModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    system_prompt: Reference | None = None
    agent_prompt: Reference | None = None
    model_settings: ModelSettings = Field(default_factory=ModelSettings)
    tools: list[Reference] = Field(default_factory=list, max_length=200)
    limits: Limits = Field(default_factory=Limits)

    @field_validator("name", "description")
    @classmethod
    def clean_text(cls, value):
        if "\x00" in value:
            raise ValueError("Null character")
        return value.strip()

    @field_validator("name")
    @classmethod
    def nonempty(cls, value):
        if not value:
            raise ValueError("Name required")
        return value

    @model_validator(mode="after")
    def unique_tools(self):
        if len({tool.id for tool in self.tools}) != len(self.tools):
            raise ValueError("Select each tool once")
        self.tools.sort(key=lambda tool: str(tool.id))
        return self


class ReviseAgentRequest(AgentConfiguration):
    base_revision: int = Field(ge=1, strict=True)


class AvailabilityRequest(StrictModel):
    enabled: bool = Field(strict=True)
    base_revision: int = Field(ge=1, strict=True)
