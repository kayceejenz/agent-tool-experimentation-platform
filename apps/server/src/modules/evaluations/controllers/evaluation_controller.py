from typing import Annotated
from uuid import UUID

from api.dependencies import Evaluations, User
from fastapi import APIRouter, Query

from modules.evaluations.dtos.evaluation_dto import Reevaluate

router = APIRouter(
    prefix="/projects/{project_id}/executions/{execution_id}/evaluations",
    tags=["evaluations"],
)


@router.get("")
async def history(
    project_id: UUID,
    execution_id: UUID,
    user: User,
    evaluations: Evaluations,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
):
    return await evaluations.list(user.id, project_id, execution_id, offset)


@router.post("", status_code=202)
async def reevaluate(
    project_id: UUID,
    execution_id: UUID,
    body: Reevaluate,
    user: User,
    evaluations: Evaluations,
):
    result = await evaluations.enqueue(user.id, project_id, execution_id, body)
    return {"id": result["id"], "status": result["status"]}
