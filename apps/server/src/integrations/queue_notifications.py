"""Queue wake-ups only: persisted rows remain the source of truth."""

import asyncio
import logging
from contextlib import suppress

from psycopg import AsyncConnection, Error, sql

EXECUTION_CHANNEL = "agent_execution_queue"
EVALUATION_CHANNEL = "agent_evaluation_queue"
RECOVERY_INTERVAL = 30
logger = logging.getLogger(__name__)


async def wait_for_work(event: asyncio.Event, timeout: float = RECOVERY_INTERVAL):
    """Also wake periodically for missed notifications and stale-job recovery."""
    try:
        await asyncio.wait_for(event.wait(), timeout)
    except TimeoutError:
        pass


class QueueNotifications:
    """One dedicated autocommit listener per worker, outside its query pool."""

    def __init__(self, settings):
        self.settings = settings
        self.executions = asyncio.Event()
        self.evaluations = asyncio.Event()
        self.ready = asyncio.Event()
        self.task = None

    def wake_all(self):
        self.executions.set()
        self.evaluations.set()

    async def __aenter__(self):
        self.task = asyncio.create_task(self.listen())
        return self

    async def __aexit__(self, *args):
        self.task.cancel()
        with suppress(asyncio.CancelledError):
            await self.task

    async def listen(self):
        retry_delay = 1
        while True:
            try:
                async with await AsyncConnection.connect(
                    self.settings.database_url.get_secret_value(),
                    autocommit=True,
                    connect_timeout=self.settings.database_connect_timeout,
                    options=(
                        f"-c statement_timeout={self.settings.database_statement_timeout_ms} "
                        f"-c lock_timeout={self.settings.database_lock_timeout_ms}"
                    ),
                ) as connection:
                    for channel in (EXECUTION_CHANNEL, EVALUATION_CHANNEL):
                        await connection.execute(
                            sql.SQL("LISTEN {}").format(sql.Identifier(channel))
                        )
                    # LISTEN has committed. Drain both queues after registration,
                    # including jobs committed before or during connection setup.
                    self.ready.set()
                    self.wake_all()
                    retry_delay = 1
                    while True:
                        async for notice in connection.notifies(
                            timeout=RECOVERY_INTERVAL
                        ):
                            if notice.channel == EXECUTION_CHANNEL:
                                self.executions.set()
                            elif notice.channel == EVALUATION_CHANNEL:
                                self.evaluations.set()
                        # Detect quiet broken connections without leaving a
                        # transaction open or sharing the listener with queries.
                        await connection.execute("SELECT 1")
            except (Error, OSError, TimeoutError):
                self.ready.clear()
                self.wake_all()
                # Driver messages may contain connection details; omit them.
                logger.warning("Queue listener disconnected; reconnecting")
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, RECOVERY_INTERVAL)
