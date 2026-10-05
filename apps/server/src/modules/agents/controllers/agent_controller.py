from typing import Annotated
from uuid import UUID

from api.dependencies import current_user
from fastapi import APIRouter, Depends, Path, Query, Request

from modules.agents.dtos.agent_dto import (
    AgentConfiguration,
    AvailabilityRequest,
    ReviseAgentRequest,
)
from modules.auth.models.auth_user_model import AuthenticatedUser

router = APIRouter(prefix="/projects/{project_id}/agents", tags=["agents"])
User = Annotated[AuthenticatedUser, Depends(current_user)]
Offset = Annotated[int, Query(ge=0, le=100000)]


@router.post("", status_code=201)
async def create(
    project_id: UUID, user: User, body: AgentConfiguration, request: Request
):
    return await request.app.state.agents.create(user.id, project_id, body)


@router.get("")
async def list_agents(
    project_id: UUID, user: User, request: Request, offset: Offset = 0
):
    return await request.app.state.agents.list(user.id, project_id, offset)


@router.get("/{agent_id}")
async def get(project_id: UUID, agent_id: UUID, user: User, request: Request):
    return await request.app.state.agents.get(user.id, project_id, agent_id)


@router.patch("/{agent_id}")
async def availability(
    project_id: UUID,
    agent_id: UUID,
    user: User,
    body: AvailabilityRequest,
    request: Request,
):
    return await request.app.state.agents.availability(
        user.id, project_id, agent_id, body
    )


@router.post("/{agent_id}/revisions")
async def revise(
    project_id: UUID,
    agent_id: UUID,
    user: User,
    body: ReviseAgentRequest,
    request: Request,
):
    return await request.app.state.agents.revise(user.id, project_id, agent_id, body)


@router.get("/{agent_id}/revisions")
async def history(
    project_id: UUID, agent_id: UUID, user: User, request: Request, offset: Offset = 0
):
    return await request.app.state.agents.history(user.id, project_id, agent_id, offset)


@router.get("/{agent_id}/revisions/{revision}")
async def revision(
    project_id: UUID,
    agent_id: UUID,
    revision: Annotated[int, Path(ge=1)],
    user: User,
    request: Request,
):
    return await request.app.state.agents.get(user.id, project_id, agent_id, revision)
