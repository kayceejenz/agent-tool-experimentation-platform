from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request

from modules.evaluations.dtos.evaluation_dto import Reevaluate
from modules.executions.controllers.execution_controller import User

router = APIRouter(
    prefix="/projects/{project_id}/executions/{execution_id}/evaluations",
    tags=["evaluations"],
)


@router.get("")
async def history(
    project_id: UUID,
    execution_id: UUID,
    user: User,
    request: Request,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
):
    return await request.app.state.evaluations.list(
        user.id, project_id, execution_id, offset
    )


@router.post("", status_code=202)
async def reevaluate(
    project_id: UUID, execution_id: UUID, body: Reevaluate, user: User, request: Request
):
    result = await request.app.state.evaluations.enqueue(
        user.id, project_id, execution_id, body
    )
    return {"id": result["id"], "status": result["status"]}
