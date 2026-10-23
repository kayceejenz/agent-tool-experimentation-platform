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


@router.get("/performance")
async def performance(project_id: UUID, user: User, benchmarks: Benchmarks):
    return await benchmarks.performance(user.id, project_id)


@router.get("/captures/{capture_id}")
async def capture(
    project_id: UUID, capture_id: UUID, user: User, benchmarks: Benchmarks
):
    return await benchmarks.get_capture(user.id, project_id, capture_id)


@router.get("/runs/{execution_id}")
async def run(project_id: UUID, execution_id: UUID, user: User, benchmarks: Benchmarks):
    return await benchmarks.run(user.id, project_id, execution_id)


@router.get("/{benchmark_id}/runs")
async def history(
    project_id: UUID, benchmark_id: UUID, user: User, benchmarks: Benchmarks
):
    return await benchmarks.history(user.id, project_id, benchmark_id)


@router.delete("/{benchmark_id}")
async def delete(
    project_id: UUID, benchmark_id: UUID, user: User, benchmarks: Benchmarks
):
    return await benchmarks.delete(user.id, project_id, benchmark_id)


@router.delete("/runs/{execution_id}")
async def remove_run(
    project_id: UUID, execution_id: UUID, user: User, benchmarks: Benchmarks
):
    return await benchmarks.remove_run(user.id, project_id, execution_id)
