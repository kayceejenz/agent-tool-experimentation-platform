from uuid import UUID

from pydantic import BaseModel, Field


class DatasetFile(BaseModel):
    id: UUID
    name: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
