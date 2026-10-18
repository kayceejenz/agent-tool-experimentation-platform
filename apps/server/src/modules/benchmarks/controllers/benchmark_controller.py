from uuid import UUID

from api.dependencies import Benchmarks, User
from fastapi import APIRouter

from modules.benchmarks.dtos.benchmark_dto import SaveBenchmark

router = APIRouter(prefix="/projects/{project_id}/benchmarks", tags=["benchmarks"])


@router.get("")
async def list_examples(
    project_id: UUID, user: User, benchmarks: Benchmarks, agent_id: UUID | None = None
):
    return await benchmarks.list(user.id, project_id, agent_id)


@router.post("", status_code=201)
async def save_example(
    project_id: UUID, body: SaveBenchmark, user: User, benchmarks: Benchmarks
):
    return await benchmarks.save(user.id, project_id, body)


@router.get("/captures/{capture_id}")
async def capture(
    project_id: UUID, capture_id: UUID, user: User, benchmarks: Benchmarks
):
    return await benchmarks.get_capture(user.id, project_id, capture_id)


@router.get("/runs/{execution_id}")
async def run(project_id: UUID, execution_id: UUID, user: User, benchmarks: Benchmarks):
    return await benchmarks.run(user.id, project_id, execution_id)
