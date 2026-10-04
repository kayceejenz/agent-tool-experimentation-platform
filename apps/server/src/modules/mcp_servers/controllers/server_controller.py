from typing import Annotated
from uuid import UUID

from api.dependencies import current_user
from fastapi import APIRouter, Depends, Query, Request

from modules.auth.models.auth_user_model import AuthenticatedUser
from modules.mcp_servers.dtos.server_request_dto import (
    CreateServerRequest,
    ProbeServerRequest,
    UpdateServerRequest,
)
from modules.mcp_servers.dtos.server_response_dto import (
    ServerInspectionResponse,
    ServerListResponse,
    ServerProbeResponse,
    ServerResponse,
)
from modules.mcp_servers.services.server_service import ServerService

router = APIRouter(prefix="/projects/{project_id}/mcp-servers", tags=["mcp-servers"])
User = Annotated[AuthenticatedUser, Depends(current_user)]


def service(request: Request) -> ServerService:
    return request.app.state.mcp_servers


Service = Annotated[ServerService, Depends(service)]


@router.post("", response_model=ServerResponse, status_code=201)
async def create_server(
    project_id: UUID, body: CreateServerRequest, user: User, servers: Service
):
    return await servers.create(user.id, project_id, body)


@router.post("/probe", response_model=ServerProbeResponse)
async def probe_server(project_id: UUID, body: ProbeServerRequest, user: User, servers: Service):
    return await servers.probe_unsaved(user.id, project_id, body)


@router.get("", response_model=ServerListResponse)
async def list_servers(
    project_id: UUID,
    user: User,
    servers: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
):
    return await servers.list(user.id, project_id, limit, cursor)


@router.get("/{server_id}", response_model=ServerResponse)
async def get_server(project_id: UUID, server_id: UUID, user: User, servers: Service):
    return await servers.get(user.id, project_id, server_id)


@router.patch("/{server_id}", response_model=ServerResponse)
async def update_server(
    project_id: UUID,
    server_id: UUID,
    body: UpdateServerRequest,
    user: User,
    servers: Service,
):
    return await servers.update(user.id, project_id, server_id, body)


@router.post("/{server_id}/check", response_model=ServerInspectionResponse)
async def check_server(project_id: UUID, server_id: UUID, user: User, servers: Service):
    return await servers.inspect(user.id, project_id, server_id)


@router.post("/{server_id}/discover", response_model=ServerInspectionResponse)
async def discover_tools(
    project_id: UUID, server_id: UUID, user: User, servers: Service
):
    return await servers.inspect(user.id, project_id, server_id, discover=True)
