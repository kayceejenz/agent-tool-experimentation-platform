from typing import Annotated, Literal
from uuid import UUID

from api.dependencies import Agents, Config, Executions, User
from fastapi import APIRouter, Query
from integrations.agents.model_provider import provider_key

from modules.agents.models.error_model import AgentError
from modules.executions.dtos.execution_dto import StartExecution

router = APIRouter(prefix="/projects/{project_id}", tags=["executions"])


@router.post("/agents/{agent_id}/executions", status_code=202)
async def start(
    project_id: UUID,
    agent_id: UUID,
    body: StartExecution,
    user: User,
    executions: Executions,
    agents: Agents,
    config: Config,
):
    agent = await agents.get(user.id, project_id, agent_id, body.revision)
    provider = agent["model_settings"]["provider"].lower()
    if provider not in ("openai", "google"):
        raise AgentError(422, "The runtime supports OpenAI and Google providers")
    if provider_key(config, provider) is None:
        variable = (
            "AGENT_GOOGLE_API_KEY" if provider == "google" else "AGENT_OPENAI_API_KEY"
        )
        raise AgentError(503, f"Set {variable} on the server to run this agent")
    result = await executions.start(user.id, project_id, agent_id, body)
    return {"id": result["id"], "status": result["status"]}


@router.get("/agents/{agent_id}/executions")
async def history(
    project_id: UUID,
    agent_id: UUID,
    user: User,
    executions: Executions,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
):
    return await executions.list(user.id, project_id, agent_id, offset)


@router.get("/executions/{execution_id}")
async def detail(
    project_id: UUID,
    execution_id: UUID,
    user: User,
    executions: Executions,
    view: Literal["full", "summary", "status"] = "full",
):
    return await executions.get(user.id, project_id, execution_id, view)


@router.post("/executions/{execution_id}/cancel")
async def cancel(
    project_id: UUID,
    execution_id: UUID,
    user: User,
    executions: Executions,
    view: Literal["full", "summary"] = "full",
):
    return await executions.cancel(user.id, project_id, execution_id, view)


@router.get("/executions/{execution_id}/spans")
async def spans(
    project_id: UUID,
    execution_id: UUID,
    user: User,
    executions: Executions,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
):
    return await executions.trace(user.id, project_id, execution_id, offset)


@router.get("/executions/{execution_id}/spans/{span_id}")
async def span(
    project_id: UUID,
    execution_id: UUID,
    span_id: UUID,
    user: User,
    executions: Executions,
):
    return await executions.trace(user.id, project_id, execution_id, span_id=span_id)


@router.get("/executions/{execution_id}/snapshot")
async def snapshot(
    project_id: UUID, execution_id: UUID, user: User, executions: Executions
):
    return await executions.trace(user.id, project_id, execution_id, snapshot=True)
