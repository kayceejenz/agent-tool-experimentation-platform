"""Bounded PostgreSQL queue worker. Start with agent-platform-worker."""

import asyncio
import logging

from core.settings import Settings
from integrations.agents.langchain_runtime import LangChainRuntime
from integrations.agents.model_provider import configured_secrets
from integrations.agents.runtime_errors import RuntimeStop
from integrations.database import Database
from integrations.mcp.credential_cipher import CredentialCipher
from integrations.queue_notifications import QueueNotifications, wait_for_work

from modules.agents.models.error_model import AgentError
from modules.evaluations.repos.evaluation_repo import EvaluationRepository
from modules.evaluations.services.evaluation_service import Evaluator
from modules.executions.repos.execution_repo import ExecutionRepository
from modules.tools.repos.tool_repo import ToolRepository
from modules.tools.services.tool_service import ToolService


logger = logging.getLogger("agent.worker")


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
                run["_worker_stop"] = (
                    "cancelled" if isinstance(error, RuntimeStop) else "access_revoked"
                )
                logger.info("Run %s stopping: %s", run["id"], run["_worker_stop"])
                task.cancel()
                await task
                return
        await task
    finally:
        if not task.done():
            task.cancel()
            await task


async def serve():
    logger.info("Worker starting")
    settings = Settings()
    database = Database(settings)
    repository = ExecutionRepository(
        database,
        configured_secrets(settings),
        settings=settings,
    )
    executor = ToolService(
        ToolRepository(database),
        CredentialCipher(settings.mcp_credential_key),
        settings,
    )
    runtime = LangChainRuntime(repository, executor, settings)
    await database.open()
    logger.info("Database connected")
    evaluation_task = None
    try:
        if not await database.is_ready():
            raise RuntimeError("Apply database migrations before starting the worker")
        evaluator = Evaluator(
            EvaluationRepository(database, repository.secret), settings
        )
        async with QueueNotifications(settings) as notifications:
            evaluation_task = asyncio.create_task(
                evaluator.serve(notifications.evaluations)
            )
            # Surface evaluator failure even when the execution queue is idle.
            evaluation_task.add_done_callback(lambda _: notifications.executions.set())
            logger.info("Worker ready; waiting for execution and evaluation jobs")
            while True:
                notifications.executions.clear()
                if evaluation_task.done():
                    await evaluation_task
                if notifications.task.done():
                    await notifications.task
                run = await repository.claim()
                if run:
                    logger.info("Run %s picked up", run["id"])
                    await supervise(runtime, repository, run)
                else:
                    await wait_for_work(notifications.executions)
    finally:
        if evaluation_task:
            evaluation_task.cancel()
            try:
                await evaluation_task
            except asyncio.CancelledError:
                pass
        await database.close()
        logger.info("Worker stopped")


def main():
    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    logger.setLevel(logging.INFO)
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
