"""Manual Phase 2 harness; does not call a model or require a database."""

import argparse
import asyncio
import json
from dataclasses import asdict
from pathlib import Path

from core.settings import Settings

from integrations.sandbox.runner import SandboxError, SandboxPolicy, SandboxRunner


async def run(args):
    settings = Settings()
    policy = SandboxPolicy(
        image=args.image or settings.sandbox_image,
        memory_mb=settings.sandbox_memory_mb,
        cpus=settings.sandbox_cpus,
        command_seconds=(
            args.timeout
            if args.timeout is not None
            else settings.sandbox_command_seconds
        ),
        session_seconds=settings.sandbox_session_seconds,
    )
    runner = SandboxRunner(args.root or settings.sandbox_storage_root, policy)
    if args.recover:
        await runner.recover()
        print(json.dumps({"status": "recovered"}))
        return 0
    if not args.code:
        raise ValueError("Supply at least one --code Python script, or --recover")
    codes = []
    for path in args.code:
        with Path(path).open("rb") as source:
            raw = source.read(65537)
        if len(raw) > 65536:
            raise ValueError("Python source exceeds 64 KiB")
        codes.append(raw.decode("utf-8"))
    results, artifacts = [], []
    async with await runner.open([{"source": path} for path in args.input]) as session:
        for code in codes:
            result = await session.execute(code)
            results.append(asdict(result))
            if result.status == "timeout":
                break
        if not session.closed:
            artifacts = await session.artifacts()
        report = {
            "session_id": session.workspace.id,
            "image_id": session.image_id,
            "inputs": session.workspace.manifest,
            "commands": results,
            "artifacts": artifacts,
        }
        destination = session.workspace.path / "report.json"
        destination.write_text(json.dumps(report, indent=2))
        print(json.dumps({**report, "report_path": str(destination)}, indent=2))
    return 0 if all(r["status"] == "success" for r in results) else 1


def main():
    parser = argparse.ArgumentParser(
        description="Run Python against explicit files in a local sandbox"
    )
    parser.add_argument(
        "--input",
        action="append",
        default=[],
        help="Only these files become visible under /input",
    )
    parser.add_argument(
        "--code",
        action="append",
        default=[],
        help="Python script; repeat for multiple commands in one session",
    )
    parser.add_argument(
        "--root", help="Host directory for session metadata and retained outputs"
    )
    parser.add_argument("--image", help="Prebuilt local analysis image")
    parser.add_argument("--timeout", type=float, help="Per-command timeout in seconds")
    parser.add_argument(
        "--recover",
        action="store_true",
        help="Remove abandoned containers for this workspace root",
    )
    args = parser.parse_args()
    try:
        status = asyncio.run(run(args))
    except (SandboxError, ValueError, OSError) as error:
        parser.exit(2, f"Sandbox unavailable: {error}\n")
    except KeyboardInterrupt:
        parser.exit(130, "Sandbox execution cancelled\n")
    raise SystemExit(status)


if __name__ == "__main__":
    main()
