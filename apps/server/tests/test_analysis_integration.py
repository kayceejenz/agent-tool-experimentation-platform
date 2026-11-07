import json
import os
from pathlib import Path
from uuid import uuid4

import pytest
from integrations.agents.langchain_runtime import LangChainRuntime
from langchain_core.messages import AIMessage
from pydantic import SecretStr
from test_agent_runtime import ScriptedModel
from test_projects_integration import create, query, workspace  # noqa: F401

pytestmark = [pytest.mark.integration, pytest.mark.sandbox]


@pytest.fixture
def analysis_workspace(workspace, tmp_path):  # noqa: F811
    if os.environ.get("RUN_SANDBOX_TESTS") != "1":
        pytest.skip("Set RUN_SANDBOX_TESTS=1 with Docker and the analysis image")
    client, config, users = workspace
    config.dataset_storage_root = str(tmp_path / "datasets")
    config.sandbox_storage_root = str(tmp_path / "sandboxes")
    config.openai_api_key = SecretStr("scripted-provider-test-key")
    owner = users[0][1]
    project = create(client, owner)["id"]
    base = f"/api/v1/projects/{project}"
    dataset = client.post(
        base + "/datasets",
        headers=owner,
        data={"name": "Trial"},
        files={
            "files": (
                "events.csv",
                b"Animal_ID,Start_Time,End_Time,Duration_s\n001,2025-03-04 23:59:30,2025-03-05 00:00:30,60\n001,2025-03-05 01:00:00,2025-03-05 01:02:00,120\n",
            )
        },
    )
    assert dataset.status_code == 201, dataset.text
    body = {
        "name": "Analyst",
        "model_settings": {"provider": "openai", "model": "scripted"},
        "evaluation_profile": {"enabled": False},
        "limits": {
            "timeout_seconds": 60,
            "max_turns": 12,
            "max_tool_calls": 10,
            "max_output_tokens": 1000,
        },
    }
    agent = client.post(base + "/agents", headers=owner, json=body)
    assert agent.status_code == 201, agent.text
    agent = agent.json()
    enabled = client.patch(
        base + "/agents/" + agent["id"],
        headers=owner,
        json={"enabled": True, "base_revision": 1},
    )
    assert enabled.status_code == 200, enabled.text
    yield client, config, users, project, agent, dataset.json()


def call(name, arguments, identifier):
    return AIMessage(
        content="",
        tool_calls=[
            {
                "name": "workspace_" + name,
                "args": arguments,
                "id": identifier,
                "type": "tool_call",
            }
        ],
    )


def enqueue(client, project, agent, dataset, headers, request_id=None):
    return client.post(
        f"/api/v1/projects/{project}/agents/{agent['id']}/executions",
        headers=headers,
        json={
            "revision": 1,
            "request_id": request_id or str(uuid4()),
            "input": "Summarise daily duration, splitting bouts at midnight.",
            "analysis": {"dataset_id": dataset["id"]},
        },
    )


def test_analysis_snapshot_tools_real_execution_and_artifacts(analysis_workspace):
    client, config, users, project, agent, dataset = analysis_workspace
    owner = users[0][1]
    request_id = str(uuid4())
    response = enqueue(client, project, agent, dataset, owner, request_id)
    assert response.status_code == 202, response.text
    run_id = response.json()["id"]
    dataset_url = f"/api/v1/projects/{project}/datasets/{dataset['id']}"
    assert client.delete(dataset_url, headers=owner).status_code == 409
    assert (
        enqueue(client, project, agent, dataset, owner, request_id).json()["id"]
        == run_id
    )
    code = """
import pandas as pd, json
from pathlib import Path
frame = pd.read_csv('/input/events.csv')
totals = {}
for row in frame.itertuples():
    start, end = pd.Timestamp(row.Start_Time), pd.Timestamp(row.End_Time)
    while start < end:
        stop = min(end, start.normalize() + pd.Timedelta(days=1))
        day = str(start.date())
        totals[day] = totals.get(day, 0) + (stop - start).total_seconds()
        start = stop
Path('/work/output/daily.json').write_text(json.dumps(totals))
print(json.dumps(totals))
import matplotlib.pyplot as plt
plt.bar(list(totals),list(totals.values()));plt.savefig('/work/output/daily.png')
pd.DataFrame({'Date':list(totals),'Duration_s':list(totals.values())}).to_csv('/work/output/daily.csv',index=False)
"""
    model = ScriptedModel(
        responses=[
            call("list_files", {}, "list"),
            call("read_file", {"path": "/input/events.csv"}, "read"),
            call(
                "execute_python", {"code": "raise ValueError('recoverable')"}, "error"
            ),
            call("execute_python", {"code": code}, "calculate"),
            AIMessage(content="4 March: 30 seconds. 5 March: 150 seconds."),
        ]
    )

    async def execute():
        repo = client.app.state.executions
        run = await repo.claim()
        assert str(run["id"]) == run_id
        from fastapi import HTTPException
        from modules.datasets.repos.dataset_repo import DatasetRepository

        async def unused_cleanup():
            pytest.fail("Active dataset files must not be deleted")

        with pytest.raises(HTTPException) as blocked:
            await DatasetRepository(client.app.state.database).delete(
                users[0][0], project, dataset["id"], unused_cleanup
            )
        assert blocked.value.status_code == 409
        await LangChainRuntime(
            repo, client.app.state.tools, config, lambda _: model
        ).execute(run)

    client.portal.call(execute)
    url = f"/api/v1/projects/{project}/executions/{run_id}"
    detail = client.get(url, headers=owner).json()
    assert detail["status"] == "completed", detail
    assert detail["snapshot"]["analysis"]["image_id"].startswith("sha256:")
    assert (
        detail["snapshot"]["analysis"]["dataset"]["files"][0]["sha256"]
        == dataset["files"][0]["sha256"]
    )
    assert not detail["snapshot"]["evaluation_profile"]["enabled"]
    tools = [span for span in detail["spans"] if span["kind"] == "tool"]
    assert len(tools) == 4 and all(span["tool_id"] is None for span in tools)
    assert tools[2]["status"] == "tool_error" and tools[3]["status"] == "success"
    assert "150" in json.dumps(tools[3]["outputs"])
    assert tools[0]["context_span_ids"] == []
    assert len(tools[3]["context_span_ids"]) == 3
    result = detail["snapshot"]["analysis_result"]
    artifact = next(
        item for item in result["artifacts"] if item["name"] == "daily.json"
    )
    output = (
        Path(config.sandbox_storage_root)
        / "sessions"
        / result["session_id"]
        / "outputs"
        / artifact["id"]
    )
    assert json.loads(output.read_text()) == {"2025-03-04": 30, "2025-03-05": 150}
    assert not (output.parent.parent / "inputs").exists()
    assert "scripted-provider-test-key" not in json.dumps(detail)
    assert client.get(url, headers=users[3][1]).status_code == 404
    files = client.get(url + "/artifacts", headers=owner)
    assert files.status_code == 200, files.text
    listed = files.json()["items"]
    assert len(listed) == 5 and all(
        item["availability"] == "available" for item in listed
    )
    assert client.get(url + "/artifacts", headers=users[3][1]).status_code == 404
    csv_file = next(item for item in listed if item["name"] == "daily.csv")
    csv_url = url + "/artifacts/" + csv_file["id"]
    assert client.get(csv_url + "/preview", headers=owner).json()["rows"] == [
        ["2025-03-04", "30.0"],
        ["2025-03-05", "150.0"],
    ]
    assert client.get(csv_url, headers=users[3][1]).status_code == 404
    downloaded = client.get(csv_url, headers=owner)
    assert downloaded.status_code == 200 and downloaded.headers[
        "content-disposition"
    ].startswith("attachment;")
    png = next(item for item in listed if item["name"] == "daily.png")
    image = client.get(url + "/artifacts/" + png["id"] + "?inline=true", headers=owner)
    assert (
        image.content.startswith(b"\x89PNG")
        and image.headers["content-type"] == "image/png"
    )
    assert image.headers["content-disposition"].startswith("inline;")
    assert image.headers["x-content-type-options"] == "nosniff"
    assert (
        client.get(
            url + "/artifacts/" + uuid4().hex + ".csv", headers=owner
        ).status_code
        == 404
    )
    script = next(item for item in listed if item["kind"] == "code")
    assert (
        client.get(
            url + "/artifacts/" + script["id"] + "/preview", headers=owner
        ).json()["kind"]
        == "text"
    )
    assert client.delete(dataset_url, headers=owner).status_code == 200
    assert not (Path(config.dataset_storage_root) / dataset["id"]).exists()
    assert client.get(url, headers=owner).json()["status"] == "completed"
    assert client.get(csv_url, headers=owner).content == downloaded.content
    query(
        config,
        "UPDATE agent_platform.agent_executions SET snapshot=jsonb_set(snapshot,'{analysis_result,collected_at}',to_jsonb((now()-interval '8 days')::text)) WHERE id=%s",
        (run_id,),
    )
    assert client.get(csv_url, headers=owner).status_code == 410
    assert all(
        item["availability"] == "expired"
        for item in client.get(url + "/artifacts", headers=owner).json()["items"]
    )


def test_analysis_access_idempotency_and_changed_inputs(analysis_workspace):
    client, config, users, project, agent, dataset = analysis_workspace
    owner = users[0][1]
    other = create(client, owner, "Other")["id"]
    foreign = client.post(
        f"/api/v1/projects/{other}/datasets",
        headers=owner,
        data={"name": "Foreign"},
        files={"files": ("x.csv", b"a,b\n1,2\n")},
    ).json()
    assert enqueue(client, project, agent, foreign, owner).status_code == 404
    request = str(uuid4())
    response = enqueue(client, project, agent, dataset, owner, request)
    assert response.status_code == 202
    without = client.post(
        f"/api/v1/projects/{project}/agents/{agent['id']}/executions",
        headers=owner,
        json={
            "revision": 1,
            "request_id": request,
            "input": "Summarise daily duration, splitting bouts at midnight.",
        },
    )
    assert without.status_code == 409
    path = Path(config.dataset_storage_root) / dataset["id"] / dataset["files"][0]["id"]
    path.chmod(0o600)
    path.write_text("tampered")

    async def execute():
        repo = client.app.state.executions
        run = await repo.claim()
        model = ScriptedModel(responses=[AIMessage(content="Must not execute")])
        await LangChainRuntime(
            repo, client.app.state.tools, config, lambda _: model
        ).execute(run)
        assert model.index == 0

    client.portal.call(execute)
    detail = client.get(
        f"/api/v1/projects/{project}/executions/{response.json()['id']}", headers=owner
    ).json()
    assert (
        detail["status"] == "failed"
        and detail["termination_reason"] == "sandbox_unavailable"
    )


def test_failed_run_retains_partial_exports_with_authorized_access(analysis_workspace):
    client, config, users, project, agent, dataset = analysis_workspace
    owner = users[0][1]
    response = enqueue(client, project, agent, dataset, owner)
    assert response.status_code == 202
    run_id = response.json()["id"]
    # The next model turn fails after Python wrote an export. Files remain useful,
    # but the run must still be marked failed rather than claiming success.
    model = ScriptedModel(
        responses=[
            call(
                "execute_python",
                {"code": "open('/work/output/partial.csv','w').write('value\\n42\\n')"},
                "partial",
            )
        ]
    )

    async def execute():
        repo = client.app.state.executions
        run = await repo.claim()
        await LangChainRuntime(
            repo, client.app.state.tools, config, lambda _: model
        ).execute(run)

    client.portal.call(execute)
    path = f"/api/v1/projects/{project}/executions/{run_id}"
    detail = client.get(path, headers=owner).json()
    assert (
        detail["status"] == "failed" and detail["termination_reason"] == "model_error"
    )
    files = client.get(path + "/artifacts", headers=owner).json()["items"]
    assert {item["name"] for item in files} == {"partial.csv", "analysis_step_01.py"}
    assert all(item["availability"] == "available" for item in files)


def test_remote_dataset_analysis_survives_local_workspace_cleanup(
    analysis_workspace, monkeypatch
):
    from integrations.object_storage import R2Storage
    from test_object_storage import MemoryS3

    client, config, users, project, agent, _ = analysis_workspace
    remote = R2Storage(MemoryS3(), "test-private", "agent-platform")
    monkeypatch.setattr("integrations.object_storage._r2", lambda *args: remote)
    config.file_storage_backend = "r2"
    config.r2_endpoint_url = "https://test.r2.cloudflarestorage.com"
    config.r2_bucket_name = "test-private"
    config.r2_access_key_id = SecretStr("fake")
    config.r2_secret_access_key = SecretStr("fake")
    # Exercise the lower memory policy intended for a small cloud prototype.
    config.sandbox_memory_mb = 512
    config.sandbox_cpus = 0.5
    owner = users[0][1]
    base = f"/api/v1/projects/{project}"
    uploaded = client.post(
        base + "/datasets",
        headers=owner,
        data={"name": "Cloud trial"},
        files={"files": ("events.csv", b"animal,value\n001,42\n")},
    )
    assert uploaded.status_code == 201, uploaded.text
    dataset = uploaded.json()
    assert not (Path(config.dataset_storage_root) / dataset["id"]).exists()
    preview = client.get(
        base + f"/datasets/{dataset['id']}/files/{dataset['files'][0]['id']}/preview",
        headers=owner,
    )
    assert preview.json()["rows"] == [["001", "42"]]
    queued = enqueue(client, project, agent, dataset, owner)
    assert queued.status_code == 202, queued.text
    model = ScriptedModel(
        responses=[
            call(
                "execute_python",
                {
                    "code": "import pandas as pd; import matplotlib.pyplot as plt; df=pd.read_csv('/input/events.csv'); print(int(df.value.sum())); df.to_csv('/work/output/result.csv',index=False); plt.bar(['total'],[int(df.value.sum())]); plt.savefig('/work/output/chart.png')"
                },
                "calculate",
            ),
            AIMessage(content="Total is 42."),
        ]
    )

    async def execute():
        repo = client.app.state.executions
        run = await repo.claim()
        await LangChainRuntime(
            repo, client.app.state.tools, config, lambda _: model
        ).execute(run)

    client.portal.call(execute)
    url = base + "/executions/" + queued.json()["id"]
    run = client.get(url, headers=owner).json()
    assert run["status"] == "completed", run
    result = run["snapshot"]["analysis_result"]
    assert not (
        Path(config.sandbox_storage_root) / "sessions" / result["session_id"]
    ).exists()
    files = client.get(url + "/artifacts", headers=owner).json()["items"]
    assert len(files) == 3 and all(
        item["availability"] == "available" for item in files
    )
    csv_file = next(item for item in files if item["name"] == "result.csv")
    assert client.get(
        url + "/artifacts/" + csv_file["id"] + "/preview", headers=owner
    ).json()["rows"] == [["1", "42"]]
    assert (
        client.get(
            url + "/artifacts/" + csv_file["id"], headers=users[3][1]
        ).status_code
        == 404
    )
    assert (
        client.delete(base + "/datasets/" + dataset["id"], headers=owner).status_code
        == 200
    )
    assert (
        client.get(url + "/artifacts/" + csv_file["id"], headers=owner).status_code
        == 200
    )
