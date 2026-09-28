from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ProjectName = Annotated[
    str,
    StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=160),
]
Description = Annotated[str, Field(strict=True, max_length=2000)]


class CreateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: ProjectName
    description: Description | None = None
