from typing import Annotated

from core.settings import Settings
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from modules.agents.repos.agent_repo import AgentRepository
from modules.auth.models.auth_user_model import AuthenticatedUser
from modules.auth.models.error_model import InvalidAccessTokenError
from modules.auth.services.auth_service import AuthenticationService
from modules.auth.services.rate_limit_service import AuthRateLimiter
from modules.evaluations.repos.evaluation_repo import EvaluationRepository
from modules.executions.repos.execution_repo import ExecutionRepository
from modules.mcp_servers.services.server_service import ServerService
from modules.projects.services.project_service import ProjectService
from modules.prompts.repos.prompt_repo import PromptRepository
from modules.tools.services.tool_service import ToolService

bearer = HTTPBearer(auto_error=False, scheme_name="JWT Bearer", bearerFormat="JWT")


def settings(request: Request) -> Settings:
    return request.app.state.settings


def auth_service(request: Request) -> AuthenticationService:
    service = request.app.state.auth
    if service is None or request.app.state.database.pool is None:
        raise HTTPException(503, "Authentication temporarily unavailable")
    return service


def auth_rate_limiter(request: Request) -> AuthRateLimiter:
    auth_service(request)
    return request.app.state.auth_rate_limiter


async def current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> AuthenticatedUser:
    error = HTTPException(
        401,
        "Missing, invalid, or expired access token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise error
    try:
        return await auth_service(request).authenticate_access_token(
            credentials.credentials
        )
    except InvalidAccessTokenError:
        raise error from None


User = Annotated[AuthenticatedUser, Depends(current_user)]
Config = Annotated[Settings, Depends(settings)]


def agents(request: Request) -> AgentRepository:
    return request.app.state.agents


Agents = Annotated[AgentRepository, Depends(agents)]


def executions(request: Request) -> ExecutionRepository:
    return request.app.state.executions


Executions = Annotated[ExecutionRepository, Depends(executions)]


def evaluations(request: Request) -> EvaluationRepository:
    return request.app.state.evaluations


Evaluations = Annotated[EvaluationRepository, Depends(evaluations)]


def prompts(request: Request) -> PromptRepository:
    return request.app.state.prompts


Prompts = Annotated[PromptRepository, Depends(prompts)]


def tools(request: Request) -> ToolService:
    return request.app.state.tools


Tools = Annotated[ToolService, Depends(tools)]


def projects(request: Request) -> ProjectService:
    return request.app.state.projects


Projects = Annotated[ProjectService, Depends(projects)]


def mcp_servers(request: Request) -> ServerService:
    return request.app.state.mcp_servers


McpServers = Annotated[ServerService, Depends(mcp_servers)]
