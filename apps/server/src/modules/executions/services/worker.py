"""Bounded PostgreSQL queue worker. Start with agent-platform-worker."""

import asyncio

from core.settings import Settings
from integrations.agents.langchain_runtime import LangChainRuntime, RuntimeStop
from integrations.database import Database
from integrations.mcp.credential_cipher import CredentialCipher

from modules.agents.models.error_model import AgentError
from modules.executions.repos.execution_repo import ExecutionRepository
from modules.tools.repos.tool_repo import ToolRepository
from modules.tools.services.tool_service import ToolService


async def supervise(runtime, repository, run):
    task = asyncio.create_task(runtime.execute(run))
    try:
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=2)
            if done:
                break
            try:
                if await repository.check(run):
                    raise RuntimeStop("cancelled")
            except (AgentError, RuntimeStop) as error:
                task.cancel()
                await task
                # execute marks cancellation from worker shutdown as interrupted;
                # explicit cancellation/revocation has a distinct terminal reason.
                async with repository.database.connection() as conn:
                    await conn.execute(
                        "UPDATE agent_platform.agent_executions SET status=%s,termination_reason=%s WHERE id=%s AND status='interrupted'",
                        (
                            "cancelled" if isinstance(error, RuntimeStop) else "failed",
                            "cancelled"
                            if isinstance(error, RuntimeStop)
                            else "access_revoked",
                            run["id"],
                        ),
                    )
                return
        await task
    finally:
        if not task.done():
            task.cancel()
            await task


async def serve():
    settings = Settings()
    database = Database(settings)
    repository = ExecutionRepository(
        database,
        settings.openai_api_key.get_secret_value() if settings.openai_api_key else None,
    )
    executor = ToolService(
        ToolRepository(database),
        CredentialCipher(settings.mcp_credential_key),
        settings,
    )
    runtime = LangChainRuntime(repository, executor, settings)
    await database.open()
    try:
        if not await database.is_ready():
            raise RuntimeError("Apply database migrations before starting the worker")
        while True:
            run = await repository.claim()
            if run:
                await supervise(runtime, repository, run)
            else:
                await asyncio.sleep(1)
    finally:
        await database.close()


def main():
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
