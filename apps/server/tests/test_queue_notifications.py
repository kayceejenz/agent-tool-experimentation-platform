import asyncio
from types import SimpleNamespace

import pytest
from core.settings import Settings
from integrations.queue_notifications import (
    EVALUATION_CHANNEL,
    EXECUTION_CHANNEL,
    QueueNotifications,
    wait_for_work,
)
from modules.evaluations.services.evaluation_service import Evaluator
from psycopg import OperationalError


def test_wait_preserves_notifications_and_has_recovery_timeout():
    async def check():
        event = asyncio.Event()
        event.set()
        await asyncio.wait_for(wait_for_work(event), 0.2)
        assert event.is_set()
        event.clear()
        await asyncio.wait_for(wait_for_work(event, timeout=0.01), 0.2)
        assert not event.is_set()

    asyncio.run(check())


@pytest.mark.parametrize(
    "arrival", ["during_claim", "while_waiting", "during_execution"]
)
def test_evaluator_drains_queue_without_losing_wakeups(arrival):
    async def check():
        wakeup, claimed, processed = asyncio.Event(), asyncio.Event(), asyncio.Event()
        jobs = ["initial"]
        calls = 0

        async def claim():
            nonlocal calls
            calls += 1
            if jobs:
                return jobs.pop(0)
            if arrival == "during_claim" and calls == 2:
                # The empty read happened before this job committed.
                jobs.append("next")
                wakeup.set()
            claimed.set()
            return None

        async def execute(job):
            if job == "next":
                processed.set()
            elif arrival == "during_execution":
                jobs.append("next")
                wakeup.set()

        evaluator = Evaluator(SimpleNamespace(claim=claim), None)
        evaluator.execute = execute
        task = asyncio.create_task(evaluator.serve(wakeup))
        try:
            await asyncio.wait_for(claimed.wait(), 0.5)
            if arrival == "while_waiting":
                jobs.append("next")
                wakeup.set()
            await asyncio.wait_for(processed.wait(), 0.5)
            # No polling while idle: one initial job, one new job, empty reads.
            count = calls
            await asyncio.sleep(0.02)
            assert calls == count
        finally:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

    asyncio.run(check())


def test_listener_reconnects_routes_notifications_and_closes(monkeypatch, caplog):
    async def check():
        messages = asyncio.Queue()
        closed = asyncio.Event()
        statements = []
        attempts = []

        class Connection:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                closed.set()

            async def execute(self, statement):
                statements.append(str(statement))

            async def notifies(self, **kwargs):
                while True:
                    message = await messages.get()
                    if isinstance(message, Exception):
                        raise message
                    yield message

        async def connect(*args, **kwargs):
            attempts.append(kwargs)
            return Connection()

        # Exercise the real reconnect loop without its one-second delay.
        actual_sleep = asyncio.sleep

        async def fast_sleep(delay):
            await actual_sleep(0)

        monkeypatch.setattr(
            "integrations.queue_notifications.AsyncConnection.connect", connect
        )
        monkeypatch.setattr(
            "integrations.queue_notifications.asyncio.sleep", fast_sleep
        )
        settings = Settings(_env_file=None, database_url="postgresql://test/queue_test")
        async with QueueNotifications(settings) as listener:
            await asyncio.wait_for(listener.ready.wait(), 0.5)
            assert listener.executions.is_set() and listener.evaluations.is_set()
            listener.executions.clear()
            listener.evaluations.clear()
            await messages.put(SimpleNamespace(channel=EXECUTION_CHANNEL))
            await asyncio.wait_for(listener.executions.wait(), 0.5)
            assert not listener.evaluations.is_set()
            await messages.put(SimpleNamespace(channel=EVALUATION_CHANNEL))
            await asyncio.wait_for(listener.evaluations.wait(), 0.5)
            await messages.put(OperationalError("private connection credential"))
            await asyncio.wait_for(closed.wait(), 0.5)
            while len(attempts) < 2 or not listener.ready.is_set():
                await actual_sleep(0)
            assert all(attempt["autocommit"] for attempt in attempts)
            assert len(statements) == 4  # Both channels registered after reconnect.
        assert listener.task.cancelled()
        assert "private connection credential" not in caplog.text

    asyncio.run(asyncio.wait_for(check(), 1))
