import asyncio
import os
import subprocess
import sys
from pathlib import Path

import pytest

from integrations.sandbox.runner import (
    SandboxError,
    SandboxPolicy,
    SandboxRunner,
    process,
)


def test_policy_and_cross_process_admission(tmp_path):
    with pytest.raises(ValueError):
        SandboxPolicy(command_seconds=0)
    first = SandboxRunner(tmp_path)
    second = SandboxRunner(tmp_path)
    lock = first.lock()
    try:
        with pytest.raises(SandboxError, match="busy"):
            second.lock()
    finally:
        lock.close()
    second.lock().close()


@pytest.fixture
def docker_enabled():
    if os.environ.get("RUN_SANDBOX_TESTS") != "1":
        pytest.skip("Set RUN_SANDBOX_TESTS=1 with Docker and the built image")


@pytest.mark.sandbox
def test_real_analysis_isolation_persistence_and_artifacts(tmp_path, docker_enabled):
    async def scenario():
        source = tmp_path / "events.csv"
        source.write_text("animal,duration\n001,20\n002,22\n")
        runner = SandboxRunner(tmp_path / "runs", SandboxPolicy(output_bytes=1024))
        async with await runner.open([{"source": source}]) as session:
            result = await session.execute(
                """
import os, socket, pathlib
import pandas as pd
import numpy, duckdb
import matplotlib.pyplot as plt
assert os.getuid() == 10001
assert not any(k.startswith('AGENT_') for k in os.environ)
assert pd.read_csv('/input/events.csv').duration.sum() == 42
try:
    pathlib.Path('/input/events.csv').write_text('changed')
    raise AssertionError('input was writable')
except OSError: pass
try:
    socket.create_connection(('1.1.1.1', 80), timeout=1)
    raise AssertionError('network enabled')
except OSError: pass
assert not pathlib.Path('/var/run/docker.sock').exists()
pathlib.Path('/work/state.txt').write_text('persisted')
plt.plot([1,2],[20,22]); plt.savefig('/work/output/plot.png')
pd.DataFrame({'sum':[42]}).to_csv('/work/output/summary.csv', index=False)
print('sum=42')
"""
            )
            assert result.status == "success", result.stderr
            assert result.stdout.strip() == "sum=42"
            result = await session.execute(
                "print(open('/work/state.txt').read()); print('x'*10000)"
            )
            assert result.stdout.startswith("persisted") and result.stdout_truncated
            assert len(result.stdout.encode()) <= 1024
            result = await session.execute("raise ValueError('recoverable')")
            assert result.status == "python_error" and "recoverable" in result.stderr
            assert (await session.execute("print('recovered')")).status == "success"
            artifacts = await session.artifacts()
            assert {item["name"] for item in artifacts} == {"summary.csv", "plot.png"}
            png = next(
                Path(item["path"]) for item in artifacts if item["name"] == "plot.png"
            )
            assert png.read_bytes().startswith(b"\x89PNG")
            code, out, _ = await process(
                [
                    "inspect",
                    session.name,
                    "--format",
                    "{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.NetworkMode}} {{.HostConfig.PidsLimit}}",
                ]
            )
            assert not code and out[0].strip() == b"true none 64"
        assert source.read_text().endswith("002,22\n")
        assert png.exists()
        assert not session.workspace.inputs.exists()
        code, _, _ = await process(["inspect", session.name])
        assert code != 0

    asyncio.run(scenario())


@pytest.mark.sandbox
def test_timeout_cancellation_and_session_deadline(tmp_path, docker_enabled):
    async def scenario():
        runner = SandboxRunner(tmp_path, SandboxPolicy(command_seconds=0.5))
        session = await runner.open([])
        result = await session.execute("import time; time.sleep(30)")
        assert result.status == "timeout" and session.closed
        assert (await process(["inspect", session.name]))[0] != 0
        runner = SandboxRunner(tmp_path, SandboxPolicy(command_seconds=30))
        session = await runner.open([])
        task = asyncio.create_task(session.execute("import time; time.sleep(30)"))
        await asyncio.sleep(0.3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert session.closed and (await process(["inspect", session.name]))[0] != 0
        session = await SandboxRunner(
            tmp_path, SandboxPolicy(session_seconds=0.5)
        ).open([])
        await asyncio.sleep(0.7)
        # Wait for asynchronous teardown, without accepting an unbounded wait.
        for _ in range(30):
            if session.closed:
                break
            await asyncio.sleep(0.1)
        assert session.closed

    asyncio.run(scenario())


@pytest.mark.sandbox
def test_artifact_links_and_limits_are_rejected(tmp_path, docker_enabled):
    async def scenario():
        async with await SandboxRunner(
            tmp_path, SandboxPolicy(artifact_bytes=100)
        ).open([]) as session:
            await session.execute(
                "import os;os.symlink('/etc/passwd','/work/output/link.txt')"
            )
            with pytest.raises(SandboxError, match="links"):
                await session.artifacts()
            await session.execute(
                "import os;os.unlink('/work/output/link.txt');open('/work/output/large.txt','w').write('x'*101)"
            )
            with pytest.raises(SandboxError, match="limit"):
                await session.artifacts()

    asyncio.run(scenario())


@pytest.mark.sandbox
def test_worker_crash_recovery_and_startup_failure(tmp_path, docker_enabled):
    # os._exit simulates a worker disappearing without closing its session.
    code = """
import asyncio,os
from integrations.sandbox.runner import SandboxRunner
async def main():
 s=await SandboxRunner(%r).open([])
 print(s.name,flush=True)
 os._exit(0)
asyncio.run(main())
""" % str(
        tmp_path
    )
    child = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, timeout=30
    )
    assert child.returncode == 0, child.stderr
    name = child.stdout.strip()

    async def scenario():
        assert (await process(["inspect", name]))[0] == 0
        runner = SandboxRunner(tmp_path)
        await runner.recover()
        assert (await process(["inspect", name]))[0] != 0
        bad = SandboxRunner(
            tmp_path, SandboxPolicy(image="agent-analysis:missing-test-image")
        )
        with pytest.raises(SandboxError, match="image unavailable"):
            await bad.open([])
        # Failed startup must release admission.
        async with await runner.open([]) as session:
            assert (await session.execute("print('ready')")).status == "success"

    asyncio.run(scenario())
