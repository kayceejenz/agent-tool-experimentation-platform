"""Exercise deployment ordering and rollback without Docker, SSH or production data."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]

FAKE = """#!PYTHON
import json, os, sys
from pathlib import Path
cmd = Path(sys.argv[0]).name
args = sys.argv[1:]
state = Path(os.environ['DEPLOY_TEST_STATE'])
with (state / 'calls').open('a') as stream:
    stream.write(json.dumps([cmd, *args]) + '\\n')
if cmd == 'sudo':
    if args[0] == '-n': args = args[1:]
    os.execvp(args[0], args)
if cmd in ('sleep', 'flock'): sys.exit(0)
if cmd == 'curl':
    sys.exit(1 if os.environ.get('DEPLOY_FAIL') == 'public' and 'https://' in args[-1] else 0)
if cmd != 'docker': sys.exit(2)
if 'pull' in args:
    sys.exit(1 if os.environ.get('DEPLOY_FAIL') == 'pull' else 0)
if args[:2] == ['image', 'inspect']:
    print('sha256:' + 'a' * 64); sys.exit(0)
if args[0] == 'inspect':
    print('true:0:false'); sys.exit(0)
if args[0] != 'compose': sys.exit(2)
if 'run' in args:
    if '/release/check_runtime.py' in args:
        mode = args[args.index('/release/check_runtime.py') + 1]
        if mode == 'ledger':
            print(('b' if (state / 'migrated').exists() and os.environ.get('DEPLOY_SCHEMA_CHANGE') else 'a') * 64)
        if mode == 'idle' and os.environ.get('DEPLOY_FAIL') == 'busy': sys.exit(1)
        if mode == 'ready' and os.environ.get('DEPLOY_FAIL') == 'ready' and any('/releases/' in arg and arg.endswith('compose.yml') for arg in args): sys.exit(1)
    elif '/release/prepare_runtime.py' not in args:
        (state / 'migrated').touch()
elif 'ps' in args:
    print('agent-worker-test')
"""


@pytest.fixture
def deploy(tmp_path):
    root = tmp_path / "agent-platform"
    root.mkdir()
    for name in [".env", ".env.prod", ".env.runtime", "compose.yml"]:
        (root / name).write_text("unchanged previous configuration\n")
    release_id = "a" * 40 + "-123-1"
    release = root / "releases" / release_id
    release.mkdir(parents=True)
    (release / "compose.yml").write_text("new compose\n")
    auth = root / "registry-auth" / release_id
    auth.mkdir(parents=True)
    (auth / "config.json").write_text("temporary registry credential")
    script = release / "deploy.sh"
    script.write_text(
        (ROOT / ".github/scripts/deploy.sh")
        .read_text()
        .replace("root=/opt/agent-platform", "root=" + str(root))
    )
    commands = tmp_path / "commands"
    commands.mkdir()
    fake = commands / "fake"
    fake.write_text(FAKE.replace("PYTHON", sys.executable, 1))
    fake.chmod(0o755)
    for command in ["sudo", "docker", "curl", "sleep", "flock"]:
        (commands / command).symlink_to(fake)
    env = {
        **os.environ,
        "PATH": str(commands) + os.pathsep + os.environ["PATH"],
        "DEPLOY_TEST_STATE": str(tmp_path),
    }
    prefix = "339712836282.dkr.ecr.eu-north-1.amazonaws.com/agent-app@sha256:"

    def run(failure="", schema_change=False, invalid=False):
        result = subprocess.run(
            [
                "bash",
                str(script),
                "../bad" if invalid else release_id,
                prefix + "a" * 64,
                prefix + "b" * 64,
            ],
            env={
                **env,
                "DEPLOY_FAIL": failure,
                "DEPLOY_SCHEMA_CHANGE": "1" if schema_change else "",
            },
            capture_output=True,
            text=True,
        )
        calls = (
            [json.loads(line) for line in (tmp_path / "calls").read_text().splitlines()]
            if (tmp_path / "calls").exists()
            else []
        )
        return result, calls

    return run, root, release, auth


def test_deployment_updates_only_agent_services_and_cleans_registry_login(deploy):
    run, root, release, auth = deploy
    result, calls = run()
    assert result.returncode == 0, result.stderr
    assert (root / "current").resolve() == release
    assert (root / ".env.prod").read_text() == "unchanged previous configuration\n"
    assert not auth.exists()
    commands = [" ".join(call) for call in calls]
    assert not any(
        "prune" in call or "caddy" in call or "ragapp" in call for call in commands
    )
    stop_api = next(i for i, call in enumerate(calls) if call[-2:] == ["stop", "api"])
    drain = next(
        i
        for i, call in enumerate(calls)
        if "/release/check_runtime.py" in call and "idle" in call
    )
    stop_worker = next(
        i for i, call in enumerate(calls) if call[-2:] == ["stop", "worker"]
    )
    assert stop_api < drain < stop_worker


def test_failed_pull_does_not_stop_running_services(deploy):
    run, root, _, auth = deploy
    result, calls = run("pull")
    assert result.returncode != 0
    assert not any("stop" in call for call in calls)
    assert not (root / "current").exists()
    assert not auth.exists()


def test_busy_queue_restores_previous_api_without_applying_migrations(deploy):
    run, root, _, _ = deploy
    result, calls = run("busy")
    assert result.returncode != 0
    assert "restoring the previous agent release" in result.stdout
    assert not any("migrate" in call for call in calls)
    assert not any(call[-2:] == ["stop", "worker"] for call in calls)
    assert not (root / "current").exists()


@pytest.mark.parametrize("failure", ["ready", "public"])
def test_failed_health_rolls_back_code_only_release(deploy, failure):
    run, root, _, auth = deploy
    result, calls = run(failure)
    assert result.returncode != 0
    assert "restoring the previous agent release" in result.stdout
    assert any("up" in call and str(root / "compose.yml") in call for call in calls)
    assert not (root / "current").exists()
    assert not auth.exists()


def test_schema_change_requires_forward_fix_instead_of_false_rollback(deploy):
    run, root, _, _ = deploy
    result, calls = run("ready", schema_change=True)
    assert result.returncode != 0
    assert "forward fix required" in result.stdout
    assert not any("up" in call and str(root / "compose.yml") in call for call in calls)
    assert not (root / "current").exists()


def test_invalid_release_id_never_executes_docker(deploy):
    run, _, _, _ = deploy
    result, calls = run(invalid=True)
    assert result.returncode == 2
    assert calls == []


def test_subsequent_deployment_uses_the_current_release_configuration(deploy):
    run, root, release, _ = deploy
    previous = root / "releases" / "previous"
    previous.mkdir()
    for name in [".env", ".env.prod", ".env.runtime", "compose.yml"]:
        (previous / name).write_text("current release settings\n")
    (root / "current").symlink_to(previous)
    result, calls = run()
    assert result.returncode == 0, result.stderr
    assert (release / ".env.prod").read_text() == "current release settings\n"
    assert (root / "current").resolve() == release
    assert any(
        call[-2:] == ["stop", "api"] and str(previous / "compose.yml") in call
        for call in calls
    )
