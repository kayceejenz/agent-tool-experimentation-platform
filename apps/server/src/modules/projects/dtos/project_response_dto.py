from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from modules.projects.models.project_member_model import ProjectRole


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: str | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    role: ProjectRole


class ProjectListResponse(BaseModel):
    items: list[ProjectResponse]
    next_cursor: str | None
