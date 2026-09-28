from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

import uvicorn
from anyio import to_thread
from core.settings import Settings
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from integrations.database import Database
from modules.auth.controllers.auth_controller import router as auth_router
from modules.auth.helpers.passwords import Argon2idPasswordHasher
from modules.auth.helpers.tokens import JwtAccessTokenIssuer
from modules.auth.repos.rate_limit_repo import AuthRateLimitRepository
from modules.auth.repos.refresh_token_repo import RefreshTokenRepository
from modules.auth.repos.user_repo import UserRepository
from modules.auth.services.auth_service import AuthenticationService
from modules.auth.services.rate_limit_service import AuthRateLimiter
from modules.projects.controllers.project_controller import router as project_router
from modules.projects.repos.project_repo import ProjectRepository
from modules.projects.services.project_service import ProjectService
from psycopg import Error as DatabaseError
from psycopg_pool import PoolClosed, PoolTimeout, TooManyRequests
from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    database: Literal["available", "unavailable"]


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(instance: FastAPI) -> AsyncIterator[None]:
        config = settings if settings is not None else Settings()
        instance.state.settings = config
        database = Database(config)
        instance.state.auth = None
        instance.state.auth_rate_limiter = None
        if config.jwt_secret is not None:
            hasher = Argon2idPasswordHasher()
            dummy_hash = await to_thread.run_sync(
                hasher.hash, "agent-dummy-password-for-timing"
            )
            users = UserRepository(database)
            secret = config.jwt_secret.get_secret_value()
            instance.state.auth = AuthenticationService(
                users,
                hasher,
                users,
                JwtAccessTokenIssuer(
                    secret,
                    config.jwt_issuer,
                    config.jwt_audience,
                    config.access_token_minutes,
                ),
                RefreshTokenRepository(users),
                users,
                config.refresh_token_days,
                (
                    config.registration_invitation_code.get_secret_value()
                    if config.registration_invitation_code is not None
                    else None
                ),
                dummy_hash,
            )
            instance.state.auth_rate_limiter = AuthRateLimiter(
                AuthRateLimitRepository(users),
                secret,
                config.registration_rate_limit,
                config.registration_rate_window_seconds,
                config.login_rate_limit,
                config.login_rate_window_seconds,
            )
        instance.state.database = database
        instance.state.projects = ProjectService(ProjectRepository(database))
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
