from typing import Annotated
from uuid import UUID

from api.dependencies import Tools, User
from fastapi import APIRouter, Query

from modules.tools.dtos.tool_request_dto import ExecuteToolRequest, ToggleToolRequest

router = APIRouter(prefix="/projects/{project_id}/tools", tags=["tools"])


@router.get("")
async def list_tools(
    project_id: UUID,
    user: User,
    tools: Tools,
    server_id: UUID | None = None,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
    q: Annotated[str, Query(max_length=160)] = "",
    summary: bool = False,
):
    return await tools.repository.list(
        user.id, project_id, server_id, offset, q, summary
    )


@router.patch("/{tool_id}")
async def toggle_tool(
    project_id: UUID,
    tool_id: UUID,
    user: User,
    body: ToggleToolRequest,
    tools: Tools,
):
    return await tools.repository.toggle(user.id, project_id, tool_id, body)


@router.post("/{tool_id}/executions")
async def execute_tool(
    project_id: UUID,
    tool_id: UUID,
    user: User,
    body: ExecuteToolRequest,
    tools: Tools,
):
    return await tools.execute(user.id, project_id, tool_id, body)


@router.get("/{tool_id}/executions")
async def execution_history(project_id: UUID, tool_id: UUID, user: User, tools: Tools):
    return await tools.repository.history(user.id, project_id, tool_id)


@router.get("/{tool_id}/executions/requests/{request_id}")
async def operation(
    project_id: UUID, tool_id: UUID, request_id: UUID, user: User, tools: Tools
):
    return await tools.repository.operation(user.id, project_id, tool_id, request_id)


@router.get("/{tool_id}")
async def tool_detail(project_id: UUID, tool_id: UUID, user: User, tools: Tools):
    return await tools.repository.get(user.id, project_id, tool_id)
