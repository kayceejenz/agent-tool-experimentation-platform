"""Construct shared application dependencies independently of HTTP routing."""

from anyio import to_thread
from core.settings import Settings
from fastapi import FastAPI
from integrations.agents.model_provider import configured_secrets
from integrations.database import Database
from integrations.mcp.credential_cipher import CredentialCipher
from modules.agents.repos.agent_repo import AgentRepository
from modules.auth.helpers.passwords import Argon2idPasswordHasher
from modules.auth.helpers.tokens import JwtAccessTokenIssuer
from modules.auth.repos.rate_limit_repo import AuthRateLimitRepository
from modules.auth.repos.refresh_token_repo import RefreshTokenRepository
from modules.auth.repos.user_repo import UserRepository
from modules.auth.services.auth_service import AuthenticationService
from modules.auth.services.rate_limit_service import AuthRateLimiter
from modules.evaluations.repos.evaluation_repo import EvaluationRepository
from modules.executions.repos.execution_repo import ExecutionRepository
from modules.mcp_servers.repos.server_repo import ServerRepository
from modules.mcp_servers.services.server_service import ServerService
from modules.projects.repos.project_repo import ProjectRepository
from modules.projects.services.project_service import ProjectService
from modules.prompts.repos.prompt_repo import PromptRepository
from modules.tools.repos.tool_repo import ToolRepository
from modules.tools.services.tool_service import ToolService


async def configure_dependencies(instance: FastAPI, config: Settings) -> Database:
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
    instance.state.agents = AgentRepository(database)
    instance.state.executions = ExecutionRepository(
        database, configured_secrets(config)
    )
    instance.state.evaluations = EvaluationRepository(
        database, configured_secrets(config)
    )
    instance.state.prompts = PromptRepository(database)
    instance.state.database = database
    instance.state.projects = ProjectService(ProjectRepository(database))
    instance.state.mcp_servers = ServerService(
        ServerRepository(database),
        CredentialCipher(config.mcp_credential_key),
        config,
    )
    instance.state.tools = ToolService(
        ToolRepository(database),
        CredentialCipher(config.mcp_credential_key),
        config,
    )
    return database
