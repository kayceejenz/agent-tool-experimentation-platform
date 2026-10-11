from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

import uvicorn
from core.settings import Settings
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from modules.agents.controllers.agent_controller import router as agents_router
from modules.agents.models.error_model import AgentError
from modules.auth.controllers.auth_controller import router as auth_router
from modules.evaluations.controllers.evaluation_controller import (
    router as evaluations_router,
)
from modules.executions.controllers.execution_controller import (
    router as executions_router,
)
from modules.mcp_servers.controllers.server_controller import router as mcp_router
from modules.mcp_servers.models.error_model import McpConnectionError
from modules.projects.controllers.project_controller import router as project_router
from modules.prompts.controllers.prompt_controller import router as prompts_router
from modules.prompts.models.error_model import PromptError
from modules.tools.controllers.tool_controller import router as tools_router
from psycopg import Error as DatabaseError
from psycopg_pool import PoolClosed, PoolTimeout, TooManyRequests
from pydantic import BaseModel

from api.bootstrap import configure_dependencies


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    database: Literal["available", "unavailable"]


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(instance: FastAPI) -> AsyncIterator[None]:
        config = settings if settings is not None else Settings()
        database = await configure_dependencies(instance, config)
        try:
            await database.open()
            yield
        finally:
            await database.close()

    instance = FastAPI(
        title="Agent Tool Experiment Platform", version="0.1.0", lifespan=lifespan
    )

    instance.include_router(auth_router, prefix="/api/v1")
    instance.include_router(project_router, prefix="/api/v1")
    instance.include_router(mcp_router, prefix="/api/v1")
    instance.include_router(tools_router, prefix="/api/v1")
    instance.include_router(prompts_router, prefix="/api/v1")
    instance.include_router(agents_router, prefix="/api/v1")
    instance.include_router(executions_router, prefix="/api/v1")
    instance.include_router(evaluations_router, prefix="/api/v1")

    @instance.exception_handler(AgentError)
    @instance.exception_handler(PromptError)
    @instance.exception_handler(McpConnectionError)
    async def mcp_failure(request: Request, error: McpConnectionError):
        return JSONResponse(
            status_code=error.status,
            content={"detail": str(error)},
            headers={"Cache-Control": "no-store"},
        )

    @instance.middleware("http")
    async def auth_cache_control(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith(("/api/v1/auth/", "/api/v1/projects")):
            response.headers["Cache-Control"] = "no-store"
        return response

    @instance.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        return JSONResponse(
            status_code=422, content={"detail": "Invalid request fields"}
        )

    async def database_unavailable(request: Request, error: Exception):
        return JSONResponse(
            status_code=503, content={"detail": "Service temporarily unavailable"}
        )

    for error_type in (DatabaseError, PoolTimeout, PoolClosed, TooManyRequests):
        instance.add_exception_handler(error_type, database_unavailable)

    @instance.get("/health", response_model=HealthResponse, tags=["health"])
    def health() -> HealthResponse:
        """Process liveness; independent of PostgreSQL availability."""
        return HealthResponse()

    @instance.get(
        "/ready",
        response_model=ReadinessResponse,
        tags=["health"],
        responses={
            503: {"model": ReadinessResponse, "description": "Database unavailable"}
        },
    )
    async def ready(request: Request, response: Response) -> ReadinessResponse:
        """Database connectivity and exact migration history compatibility."""
        response.headers["Cache-Control"] = "no-store"
        if await request.app.state.database.is_ready():
            return ReadinessResponse(status="ready", database="available")
        response.status_code = 503
        return ReadinessResponse(status="not_ready", database="unavailable")

    return instance


app = create_app()


def run() -> None:
    settings = Settings()
    uvicorn.run(
        create_app(settings),
        host=settings.api_host,
        port=settings.api_port,
        proxy_headers=False,
    )


if __name__ == "__main__":
    run()
