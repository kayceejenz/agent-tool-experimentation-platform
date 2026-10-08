from typing import Annotated, Literal
from uuid import UUID

from api.dependencies import current_user
from fastapi import APIRouter, Depends, Query, Request

from modules.agents.models.error_model import AgentError
from modules.auth.models.auth_user_model import AuthenticatedUser
from modules.executions.dtos.execution_dto import StartExecution

router = APIRouter(prefix="/projects/{project_id}", tags=["executions"])
User = Annotated[AuthenticatedUser, Depends(current_user)]


@router.post("/agents/{agent_id}/executions", status_code=202)
async def start(
    project_id: UUID, agent_id: UUID, body: StartExecution, user: User, request: Request
):
    if request.app.state.settings.openai_api_key is None:
        raise AgentError(503, "Set AGENT_OPENAI_API_KEY on the server to run agents")
    result = await request.app.state.executions.start(
        user.id, project_id, agent_id, body
    )
    return {"id": result["id"], "status": result["status"]}


@router.get("/agents/{agent_id}/executions")
async def history(
    project_id: UUID,
    agent_id: UUID,
    user: User,
    request: Request,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
):
    return await request.app.state.executions.list(
        user.id, project_id, agent_id, offset
    )


@router.get("/executions/{execution_id}")
async def detail(project_id: UUID, execution_id: UUID, user: User, request: Request,
                 view: Literal["full", "summary", "status"] = "full"):
    return await request.app.state.executions.get(user.id, project_id, execution_id, view)


@router.post("/executions/{execution_id}/cancel")
async def cancel(project_id: UUID, execution_id: UUID, user: User, request: Request,
                 view: Literal["full", "summary"] = "full"):
    return await request.app.state.executions.cancel(user.id, project_id, execution_id, view)


@router.get("/executions/{execution_id}/spans")
async def spans(project_id: UUID, execution_id: UUID, user: User, request: Request,
                offset: Annotated[int, Query(ge=0, le=100000)] = 0):
    return await request.app.state.executions.trace(user.id, project_id, execution_id, offset)


@router.get("/executions/{execution_id}/spans/{span_id}")
async def span(project_id: UUID, execution_id: UUID, span_id: UUID, user: User, request: Request):
    return await request.app.state.executions.trace(user.id, project_id, execution_id, span_id=span_id)


@router.get("/executions/{execution_id}/snapshot")
async def snapshot(project_id: UUID, execution_id: UUID, user: User, request: Request):
    return await request.app.state.executions.trace(user.id, project_id, execution_id, snapshot=True)
