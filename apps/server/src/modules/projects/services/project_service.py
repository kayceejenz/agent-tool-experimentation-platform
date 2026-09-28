import base64
import binascii
import json
from datetime import datetime
from uuid import UUID

from modules.projects.contracts.project_repository_contract import (
    ProjectRepositoryContract,
)
from modules.projects.dtos.create_project_dto import CreateProjectRequest
from modules.projects.dtos.update_project_dto import UpdateProjectRequest


class ProjectService:
    def __init__(self, repository: ProjectRepositoryContract):
        self.repository = repository

    async def create(self, user_id: UUID, body: CreateProjectRequest):
        return await self.repository.create(user_id, body.name, body.description)

    async def get(self, user_id: UUID, project_id: UUID):
        return await self.repository.get(user_id, project_id)

    async def update(self, user_id: UUID, project_id: UUID, body: UpdateProjectRequest):
        return await self.repository.update(
            user_id, project_id, body.model_dump(exclude_unset=True)
        )

    async def list(self, user_id: UUID, limit: int, cursor: str | None):
        after = None
        if cursor is not None:
            try:
                value = json.loads(
                    base64.b64decode(cursor, altchars=b"-_", validate=True)
                )
                if (
                    not isinstance(value, list)
                    or len(value) != 2
                    or not all(isinstance(part, str) for part in value)
                ):
                    raise ValueError
                timestamp = datetime.fromisoformat(value[0])
                if timestamp.tzinfo is None:
                    raise ValueError
                after = (timestamp, UUID(value[1]))
            except (ValueError, TypeError, binascii.Error, UnicodeError) as error:
                raise ValueError("Invalid project cursor") from error
        rows = await self.repository.list_for_user(user_id, limit + 1, after)
        items = rows[:limit]
        next_cursor = None
        if len(rows) > limit:
            last = items[-1]
            next_cursor = base64.urlsafe_b64encode(
                json.dumps([last.created_at.isoformat(), str(last.id)]).encode()
            ).decode()
        return {"items": items, "next_cursor": next_cursor}
