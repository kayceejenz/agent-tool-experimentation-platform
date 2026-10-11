import asyncio
from uuid import uuid4

import pytest
from integrations.queue_notifications import QueueNotifications
from psycopg import AsyncConnection
from test_executions_integration import ready

pytest_plugins = ["test_mcp_connections_integration"]
pytestmark = pytest.mark.integration


def test_persisted_queues_commit_notifications_and_startup_drain(
    connections, monkeypatch
):
    client, config, users, project, agent, tool, url = ready(connections, monkeypatch)
    owner = users[0][1]

    def start():
        result = client.post(
            url,
            headers=owner,
            json={"revision": 1, "request_id": str(uuid4()), "input": "Queue test"},
        )
        assert result.status_code == 202
        return result.json()["id"]

    start()  # Existing queued work has no notification for a new listener.

    async def check():
        async with QueueNotifications(config) as listener:
            await asyncio.wait_for(listener.ready.wait(), 3)
            assert listener.executions.is_set() and listener.evaluations.is_set()
            first = await client.app.state.executions.claim()
            assert first is not None
            listener.executions.clear()
            listener.evaluations.clear()

            # Notifications must not escape an uncommitted or rolled-back insert.
            async with await AsyncConnection.connect(
                config.database_url.get_secret_value()
            ) as writer:
                await writer.execute(
                    "INSERT INTO agent_platform.agent_executions "
                    "(id,project_id,agent_id,agent_revision,user_id,request_id,input,input_hash,snapshot) "
                    "SELECT %s,project_id,agent_id,agent_revision,user_id,%s,input,input_hash,snapshot "
                    "FROM agent_platform.agent_executions WHERE id=%s",
                    (uuid4(), uuid4(), first["id"]),
                )
                with pytest.raises(TimeoutError):
                    await asyncio.wait_for(listener.executions.wait(), 0.1)
                await writer.rollback()
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(listener.executions.wait(), 0.1)

            await asyncio.to_thread(start)
            await asyncio.wait_for(listener.executions.wait(), 3)
            assert not listener.evaluations.is_set()
            # Contending claimers still admit each queued execution only once.
            claims = await asyncio.gather(
                client.app.state.executions.claim(), client.app.state.executions.claim()
            )
            assert sum(item is not None for item in claims) == 1

            await client.app.state.executions.finish(
                first["id"], "completed", "final_answer", "Done"
            )
            await asyncio.wait_for(listener.evaluations.wait(), 3)
            evaluation = await client.app.state.evaluations.claim()
            assert evaluation["execution_id"] == first["id"]
            listener.evaluations.clear()
            # Manual attempts use the same insert trigger as automatic evaluation.
            async with await AsyncConnection.connect(
                config.database_url.get_secret_value(), autocommit=True
            ) as writer:
                await writer.execute(
                    "INSERT INTO agent_platform.execution_evaluations "
                    "(execution_id,attempt,request_id,requested_by,profile,expectations) "
                    "SELECT execution_id,attempt+1,%s,requested_by,profile,expectations "
                    "FROM agent_platform.execution_evaluations WHERE id=%s",
                    (uuid4(), evaluation["id"]),
                )
            await asyncio.wait_for(listener.evaluations.wait(), 3)
            assert (await client.app.state.evaluations.claim())["attempt"] == 2

    client.portal.call(check)
