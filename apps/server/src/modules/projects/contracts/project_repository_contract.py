from datetime import datetime
from typing import Protocol
from uuid import UUID

from modules.projects.models.project_model import Project


class ProjectRepositoryContract(Protocol):
    async def create(
        self, user_id: UUID, name: str, description: str | None
    ) -> Project: ...
    async def list_for_user(
        self, user_id: UUID, limit: int, after: tuple[datetime, UUID] | None
    ) -> list[Project]: ...
    async def get(self, user_id: UUID, project_id: UUID) -> Project: ...
    async def update(
        self, user_id: UUID, project_id: UUID, changes: dict
    ) -> Project: ...
