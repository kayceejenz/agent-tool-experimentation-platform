from typing import Annotated
from uuid import UUID

from api.dependencies import current_user
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from modules.auth.models.auth_user_model import AuthenticatedUser
from modules.projects.dtos.create_project_dto import CreateProjectRequest
from modules.projects.dtos.project_response_dto import (
    ProjectListResponse,
    ProjectResponse,
)
from modules.projects.dtos.update_project_dto import UpdateProjectRequest
from modules.projects.models.error_model import (
    ProjectForbiddenError,
    ProjectNotFoundError,
)
from modules.projects.services.project_service import ProjectService

router = APIRouter(prefix="/projects", tags=["projects"])
User = Annotated[AuthenticatedUser, Depends(current_user)]


def service(request: Request) -> ProjectService:
    return request.app.state.projects


Service = Annotated[ProjectService, Depends(service)]


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(body: CreateProjectRequest, user: User, projects: Service):
    return await projects.create(user.id, body)


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    user: User,
    projects: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
):
    try:
        return await projects.list(user.id, limit, cursor)
    except ValueError:
        raise HTTPException(422, "Invalid project cursor") from None


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: UUID, user: User, projects: Service):
    try:
        return await projects.get(user.id, project_id)
    except ProjectNotFoundError:
        raise HTTPException(404, "Project not found") from None


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID, body: UpdateProjectRequest, user: User, projects: Service
):
    try:
        return await projects.update(user.id, project_id, body)
    except ProjectNotFoundError:
        raise HTTPException(404, "Project not found") from None
    except ProjectForbiddenError:
        raise HTTPException(403, "Project cannot be edited") from None
