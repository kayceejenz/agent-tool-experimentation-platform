from uuid import UUID, uuid4

import pytest
from modules.evaluations.services.evaluation_service import Evaluator
from modules.evaluations.dtos.evaluation_dto import Reevaluate
from test_evaluations import Judge, good_report
from test_executions_integration import ready
from test_mcp_connections_integration import query

pytest_plugins = ["test_mcp_connections_integration"]
pytestmark = pytest.mark.integration


def start(client, owner, url, **extra):
    response = client.post(
        url,
        headers=owner,
        json={
            "revision": 1,
            "request_id": str(uuid4()),
            "input": "Find sales",
            **extra,
        },
    )
    assert response.status_code == 202, response.text
    return response.json()["id"]


def test_queue_reports_retries_and_permissions(connections, monkeypatch):
    client, config, users, project, agent, tool, url = ready(connections, monkeypatch)
    owner, editor, viewer, outsider = [u[1] for u in users]
    run_id = start(client, owner, url, expectations={"final_answer_contains": ["42"]})
    base = f"/api/v1/projects/{project}/executions/{run_id}/evaluations"
    repo, evaluations = client.app.state.executions, client.app.state.evaluations
    assert client.get(base, headers=viewer).json()["items"] == []

    async def process():
        run = await repo.claim()
        span = await repo.begin_span(
            run["id"],
            kind="tool",
            name="Sales",
            tool_id=UUID(tool["id"]),
            inputs={"month": 10},
        )
        await repo.end_span(span, "success", {"sales": 42})
        await repo.record_observation(span, '{"sales":42}')
        await repo.finish(run["id"], "completed", "final_answer", "Sales are 42")
        await repo.finish(run["id"], "completed", "final_answer", "Sales are 42")
        job = await evaluations.claim()
        _, spans = await evaluations.evidence(job)
        await Evaluator(
            evaluations, config, lambda _: Judge(good_report(spans))
        ).execute(job)

    client.portal.call(process)
    result = client.get(base, headers=viewer).json()["items"]
    assert len(result) == 1 and result[0]["status"] == "completed"
    assert result[0]["report"]["overall_verdict"] == "pass"
    assert result[0]["profile"]["max_output_tokens"] == 6000
    assert isinstance(result[0]["metrics"]["usage_counts"], dict)
    assert result[0]["usage"]["input_count"] == 15
    assert result[0]["expectations"]["final_answer_contains"] == ["42"]
    assert client.get(base, headers=outsider).status_code == 404
    body = {
        "request_id": str(uuid4()),
        "expectations": {"final_answer_contains": ["missing"]},
    }
    assert client.post(base, headers=viewer, json=body).status_code == 403
    assert client.post(base, headers=outsider, json=body).status_code == 404
    queued = client.post(base, headers=editor, json=body)
    assert queued.status_code == 202, queued.text
    assert (
        client.post(base, headers=editor, json=body).json()["id"] == queued.json()["id"]
    )
    assert (
        client.post(
            base, headers=editor, json={**body, "expectations": None}
        ).status_code
        == 409
    )
    assert (
        client.post(base, headers=editor, json={"request_id": str(uuid4())}).status_code
        == 409
    )

    async def retry():
        job = await evaluations.claim()
        assert job["profile"]["max_output_tokens"] == 6000
        _, spans = await evaluations.evidence(job)
        await Evaluator(
            evaluations, config, lambda _: Judge(good_report(spans))
        ).execute(job)

    client.portal.call(retry)
    history = client.get(base, headers=viewer).json()["items"]
    assert [item["attempt"] for item in history] == [2, 1]
    assert history[0]["report"]["overall_verdict"] == "fail"
    assert (
        client.get(base.removesuffix("/evaluations"), headers=owner).json()["status"]
        == "completed"
    )


@pytest.mark.parametrize("terminal", ["cancelled", "interrupted", "failed"])
def test_terminal_paths_enqueue_once(connections, monkeypatch, terminal):
    client, config, users, project, agent, tool, url = ready(connections, monkeypatch)
    owner = users[0][1]
    run_id = start(client, owner, url)
    repo = client.app.state.executions
    if terminal == "cancelled":
        client.post(
            f"/api/v1/projects/{project}/executions/{run_id}/cancel", headers=owner
        )
    else:
        run = client.portal.call(repo.claim)
        if terminal == "failed":
            client.portal.call(repo.finish, run["id"], "failed", "provider_error")
        else:
            query(
                config,
                "UPDATE agent_platform.agent_executions SET heartbeat_at=now()-interval '1 minute' WHERE id=%s",
                (run_id,),
            )
            client.portal.call(repo.claim)
    result = client.get(
        f"/api/v1/projects/{project}/executions/{run_id}/evaluations", headers=owner
    ).json()
    assert len(result["items"]) == 1 and result["items"][0]["status"] == "queued"


def test_pinned_profiles_and_stale_recovery(connections, monkeypatch):
    client, config, users, project, agent, tool, url = ready(connections, monkeypatch)
    owner = users[0][1]
    run_id = start(client, owner, url)
    repo, evaluations = client.app.state.executions, client.app.state.evaluations
    run = client.portal.call(repo.claim)
    client.portal.call(repo.finish, run["id"], "completed", "final_answer", "42")
    job = client.portal.call(evaluations.claim)
    client.portal.call(evaluations.finish, job, "failed", None, None, None)
    prompt = client.post(
        f"/api/v1/projects/{project}/prompts",
        headers=owner,
        json={"name": "Commerce rubric", "type": "evaluation", "content": "Check GBP"},
    ).json()
    base = f"/api/v1/projects/{project}/executions/{run_id}/evaluations"
    body = {
        "request_id": str(uuid4()),
        "profile": {
            "prompt": {"id": prompt["id"], "revision": 1},
            "model": "new-judge",
        },
    }
    response = client.post(base, headers=owner, json=body)
    assert response.status_code == 202, response.text
    pinned = client.get(base, headers=owner).json()["items"][0]
    assert (
        pinned["profile"]["model"] == "new-judge"
        and "Check GBP" in pinned["profile"]["instructions"]
    )
    assert (
        client.post(
            base,
            headers=owner,
            json={
                **body,
                "request_id": str(uuid4()),
                "profile": {
                    "prompt": {"id": agent["system_prompt"]["id"], "revision": 1}
                },
            },
        ).status_code
        == 422
    )
    job = client.portal.call(evaluations.claim)
    query(
        config,
        "UPDATE agent_platform.execution_evaluations SET started_at=now()-interval '3 minutes' WHERE id=%s",
        (job["id"],),
    )
    assert client.portal.call(evaluations.claim) is None
    assert (
        client.get(base, headers=owner).json()["items"][0]["error_code"]
        == "worker_interrupted"
    )
