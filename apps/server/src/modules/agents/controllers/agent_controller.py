from typing import Annotated
from uuid import UUID

from api.dependencies import Agents, User
from fastapi import APIRouter, Path, Query

from modules.agents.dtos.agent_dto import (
    AgentConfiguration,
    AvailabilityRequest,
    ReviseAgentRequest,
)

router = APIRouter(prefix="/projects/{project_id}/agents", tags=["agents"])
Offset = Annotated[int, Query(ge=0, le=100000)]


@router.post("", status_code=201)
async def create(
    project_id: UUID, user: User, body: AgentConfiguration, agents: Agents
):
    return await agents.create(user.id, project_id, body)


@router.get("")
async def list_agents(project_id: UUID, user: User, agents: Agents, offset: Offset = 0):
    return await agents.list(user.id, project_id, offset)


@router.get("/{agent_id}")
async def get(project_id: UUID, agent_id: UUID, user: User, agents: Agents):
    return await agents.get(user.id, project_id, agent_id)


@router.patch("/{agent_id}")
async def availability(
    project_id: UUID,
    agent_id: UUID,
    user: User,
    body: AvailabilityRequest,
    agents: Agents,
):
    return await agents.availability(user.id, project_id, agent_id, body)


@router.post("/{agent_id}/revisions")
async def revise(
    project_id: UUID,
    agent_id: UUID,
    user: User,
    body: ReviseAgentRequest,
    agents: Agents,
):
    return await agents.revise(user.id, project_id, agent_id, body)


@router.get("/{agent_id}/revisions")
async def history(
    project_id: UUID, agent_id: UUID, user: User, agents: Agents, offset: Offset = 0
):
    return await agents.history(user.id, project_id, agent_id, offset)


@router.get("/{agent_id}/revisions/{revision}")
async def revision(
    project_id: UUID,
    agent_id: UUID,
    revision: Annotated[int, Path(ge=1)],
    user: User,
    agents: Agents,
):
    return await agents.get(user.id, project_id, agent_id, revision)


@router.delete("/{agent_id}")
async def remove(project_id: UUID, agent_id: UUID, user: User, agents: Agents):
    return await agents.remove(user.id, project_id, agent_id)
