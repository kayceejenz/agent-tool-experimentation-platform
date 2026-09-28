from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from modules.projects.models.project_member_model import ProjectRole


@dataclass(frozen=True)
class Project:
    id: UUID
    name: str
    description: str | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    role: ProjectRole
