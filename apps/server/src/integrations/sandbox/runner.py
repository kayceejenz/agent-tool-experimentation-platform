"""Restricted local Docker sessions. Never run generated Python on the host."""

import asyncio
import fcntl
import hashlib
import io
import re
import shutil
import tarfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from uuid import uuid4

from integrations.sandbox.workspace import Workspace


class SandboxError(Exception):
    pass


@dataclass(frozen=True)
class SandboxPolicy:
    image: str = "agent-analysis:phase2"
    memory_mb: int = 2048
    cpus: float = 2
    command_seconds: float = 60
    session_seconds: float = 300
    output_bytes: int = 24000
    workspace_mb: int = 128
    artifact_bytes: int = 16 * 1024 * 1024
    artifact_count: int = 32

    def __post_init__(self):
        if any(value <= 0 for key, value in asdict(self).items() if key != "image"):
            raise ValueError("Sandbox limits must be positive")


@dataclass
class CommandResult:
    status: str
    exit_code: int | None
    stdout: str
    stderr: str
    stdout_truncated: bool
    stderr_truncated: bool
    duration_ms: int


async def process(args, limit=24000, timeout=15):
    """Drain both pipes even after truncation; never buffer unlimited child output."""
    try:
        child = await asyncio.create_subprocess_exec(
            "docker",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as error:
        raise SandboxError("Docker executable unavailable") from error

    async def drain(stream):
        result, total = bytearray(), 0
        while chunk := await stream.read(8192):
            total += len(chunk)
            result.extend(chunk[: max(0, limit - len(result))])
        return bytes(result), total > limit

    readers = [
        asyncio.create_task(drain(child.stdout)),
        asyncio.create_task(drain(child.stderr)),
    ]
    try:
        async with asyncio.timeout(timeout):
            await child.wait()
            stdout, stderr = await asyncio.gather(*readers)
        return child.returncode, stdout, stderr
    finally:
        if child.returncode is None:
            child.kill()
            await child.wait()
        for reader in readers:
            if not reader.done():
                reader.cancel()
        await asyncio.gather(*readers, return_exceptions=True)


class SandboxRunner:
    """One active session per root across API/worker processes on this machine."""

    def __init__(self, root, policy=None):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.policy = policy or SandboxPolicy()
        self.owner = hashlib.sha256(str(self.root).encode()).hexdigest()[:24]

    def lock(self):
        handle = (self.root / ".lock").open("a")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.close()
            raise SandboxError(
                "Sandbox busy; retry when the active session finishes"
            ) from None
        return handle

    async def recover(self):
        handle = self.lock()
        try:
            await self._recover()
        finally:
            handle.close()

    async def _recover(self):
        code, out, _ = await process(
            ["ps", "-aq", "--filter", f"label=agent.sandbox.owner={self.owner}"]
        )
        if code:
            raise SandboxError("Docker engine unavailable")
        for container in out[0].decode().split():
            code, _, _ = await process(["rm", "-f", container])
            if code:
                raise SandboxError("Orphan container cleanup failed")

        sessions = self.root / "sessions"
        if sessions.exists():
            for directory in sessions.iterdir():
                if directory.is_symlink() or not re.fullmatch(
                    r"[0-9a-f]{32}", directory.name
                ):
                    continue
                inputs = directory / "inputs"
                if inputs.is_dir() and not inputs.is_symlink():
                    shutil.rmtree(inputs)

    async def open(self, files):
        handle = self.lock()
        session = None
        try:
            await self._recover()
            session = SandboxSession(self, handle)
            for item in files:
                session.workspace.add(**item)
            await session.start()
            return session
        except BaseException:
            if session:
                await asyncio.shield(session.close())
            else:
                handle.close()
            raise


class SandboxSession:
    def __init__(self, runner, handle):
        self.runner, self.handle = runner, handle
        self.policy = runner.policy
        self.workspace = Workspace(runner.root / "sessions")
        self.name = "agent-analysis-" + self.workspace.id
        self.image_id = None
        self.deadline = time.monotonic() + self.policy.session_seconds
        self.closed = False
        self.watchdog = None
        self.command_lock = asyncio.Lock()
        self.close_lock = asyncio.Lock()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await asyncio.shield(self.close())

    async def start(self):
        code, out, _ = await process(
            ["image", "inspect", self.policy.image, "--format", "{{.Id}}"]
        )
        if code:
            raise SandboxError(
                "Analysis image unavailable; build the sandbox image first"
            )
        self.image_id = out[0].decode().strip()
        args = [
            "create",
            "--name",
            self.name,
            "--label",
            f"agent.sandbox.owner={self.runner.owner}",
            "--network",
            "none",
            "--read-only",
            "--user",
            "10001:10001",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--pids-limit",
            "64",
            "--cpus",
            str(self.policy.cpus),
            "--memory",
            f"{self.policy.memory_mb}m",
            "--memory-swap",
            f"{self.policy.memory_mb}m",
            "--ulimit",
            "nofile=256:256",
            "--log-driver",
            "none",
            "--tmpfs",
            f"/work:rw,noexec,nosuid,size={self.policy.workspace_mb}m,uid=10001,gid=10001,mode=700",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=64m,uid=10001,gid=10001,mode=700",
            "--mount",
            f"type=bind,source={self.workspace.inputs},target=/input,readonly",
            "--mount",
            f"type=bind,source={self.workspace.scripts},target=/scripts,readonly",
            "--workdir",
            "/work",
            "--env",
            "HOME=/tmp",
            "--env",
            "MPLCONFIGDIR=/tmp/matplotlib",
            "--env",
            "MPLBACKEND=Agg",
            "--env",
            "OPENBLAS_NUM_THREADS=1",
            "--env",
            "OMP_NUM_THREADS=1",
            self.image_id,
            "python",
            "-I",
            "-u",
            "-c",
            "import os,time;os.makedirs('/work/output',exist_ok=True);time.sleep(86400)",
        ]
        code, _, _ = await process(args)
        if code:
            raise SandboxError("Sandbox container creation failed")
        code, _, _ = await process(["start", self.name])
        if code:
            raise SandboxError("Sandbox container startup failed")
        code, _, _ = await process(
            [
                "exec",
                self.name,
                "python",
                "-I",
                "-c",
                "import os;os.makedirs('/work/output',exist_ok=True)",
            ]
        )
        if code:
            raise SandboxError("Sandbox workspace initialisation failed")
        self.watchdog = asyncio.create_task(self._expire())

    async def _expire(self):
        await asyncio.sleep(max(0, self.deadline - time.monotonic()))
        await self.close()

    async def execute(self, code):
        async with self.command_lock:
            if self.closed or time.monotonic() >= self.deadline:
                raise SandboxError("Sandbox session expired or closed")
            if len(code.encode()) > 65536:
                raise ValueError("Python source exceeds 64 KiB")
            script = self.workspace.scripts / (uuid4().hex + ".py")
            script.write_text(code)
            script.chmod(0o444)
            started = time.monotonic()
            try:
                exit_code, stdout, stderr = await process(
                    [
                        "exec",
                        self.name,
                        "python",
                        "-I",
                        "-u",
                        "/scripts/" + script.name,
                    ],
                    self.policy.output_bytes,
                    min(self.policy.command_seconds, self.deadline - started),
                )
                status = "success" if exit_code == 0 else "python_error"
                if exit_code:
                    state, running, _ = await process(
                        ["inspect", self.name, "--format", "{{.State.Running}}"]
                    )
                    if state or running[0].strip() != b"true":
                        raise SandboxError("Sandbox container stopped during execution")
            except TimeoutError:
                await asyncio.shield(self.close())
                return CommandResult(
                    "timeout",
                    None,
                    "",
                    "Execution deadline exceeded",
                    False,
                    False,
                    int((time.monotonic() - started) * 1000),
                )
            except asyncio.CancelledError:
                await asyncio.shield(self.close())
                raise
            return CommandResult(
                status,
                exit_code,
                stdout[0].decode(errors="replace"),
                stderr[0].decode(errors="replace"),
                stdout[1],
                stderr[1],
                int((time.monotonic() - started) * 1000),
            )

    async def artifacts(self):
        async with self.command_lock:
            return await self._artifacts()

    async def _artifacts(self):
        """Copy a bounded tar stream into fresh host paths; never extract links."""
        if self.closed:
            raise SandboxError("Collect artifacts before closing the sandbox")
        limit = self.policy.artifact_bytes + 1024 * 1024
        code, archive, _ = await process(
            ["exec", self.name, "tar", "-C", "/work/output", "-cf", "-", "."],
            limit=limit,
        )
        if code or archive[1]:
            raise SandboxError("Artifact copy failed or exceeded the output limit")
        records, total = [], 0
        with tarfile.open(fileobj=io.BytesIO(archive[0])) as bundle:
            for member in bundle:
                if member.isdir():
                    continue
                relative = PurePosixPath(member.name)
                if (
                    not member.isfile()
                    or relative.is_absolute()
                    or ".." in relative.parts
                ):
                    raise SandboxError(
                        "Artifacts must be regular relative files; links are rejected"
                    )
                if relative.suffix.lower() not in {
                    ".csv",
                    ".json",
                    ".png",
                    ".txt",
                    ".py",
                }:
                    continue
                total += member.size
                if (
                    total > self.policy.artifact_bytes
                    or len(records) >= self.policy.artifact_count
                ):
                    raise SandboxError("Artifact count or byte limit exceeded")
                destination = self.workspace.outputs / (
                    uuid4().hex + relative.suffix.lower()
                )
                with bundle.extractfile(member) as source, destination.open(
                    "xb"
                ) as output:
                    output.write(source.read(member.size))
                records.append(
                    {
                        "name": str(relative),
                        "path": str(destination),
                        "size_bytes": member.size,
                    }
                )
        return records

    async def close(self):
        async with self.close_lock:
            await self._close()

    async def _close(self):
        if self.closed:
            return
        code, _, stderr = await process(["rm", "-f", self.name])
        # A failed create may leave no container. Distinguish that from a dead daemon.
        if code and b"No such container" not in stderr[0]:
            raise SandboxError(
                "Container cleanup failed; run sandbox recovery before continuing"
            )
        self.closed = True
        if self.watchdog and self.watchdog is not asyncio.current_task():
            self.watchdog.cancel()
        self.workspace.cleanup_inputs()
        self.handle.close()
