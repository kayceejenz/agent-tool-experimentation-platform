"""Run browser tests with disposable database and private API/web processes."""
import base64
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen
from uuid import uuid4

import psycopg
from psycopg import sql
from dotenv import dotenv_values
from core.settings import Settings
from migrations import migrate

apps = Path(__file__).resolve().parents[2]
server = apps / 'server'
demo = apps / 'mcps' / 'ecommerce'
demo_data = TemporaryDirectory(prefix='agent-mcp-browser-')
base = os.environ.get('AGENT_TEST_DATABASE_URL') or dotenv_values(server / '.env').get('AGENT_TEST_DATABASE_URL')
if not base or not urlsplit(base).path.endswith('_test'):
    raise SystemExit('Set AGENT_TEST_DATABASE_URL to a dedicated database ending in _test.')
name = f'agent_browser_{uuid4().hex}_test'
url = urlunsplit(urlsplit(base)._replace(path='/' + name))
children = []
tools_request = Request(
    'http://127.0.0.1:8013/mcp', method='POST',
    headers={'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'},
    data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}).encode())


def stop(_signum, _frame):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
with psycopg.connect(base, autocommit=True) as admin:
    admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
try:
    migrate(settings=Settings(_env_file=None, database_url=url, migration_database_url=None))
    env = {k: v for k, v in os.environ.items() if not k.startswith('AGENT_')}
    proxy_secret = secrets.token_urlsafe(48)
    env.update({
        'AGENT_DATABASE_URL': url, 'AGENT_JWT_SECRET': secrets.token_urlsafe(48),
        'AGENT_AUTH_PROXY_SECRET': proxy_secret, 'AUTH_PROXY_SECRET': proxy_secret,
        'AUTH_CLIENT_IP_HEADER': 'X-Test-Client-IP',
        'AGENT_REGISTRATION_INVITATION_CODE': 'BETA',
        'AGENT_REGISTRATION_RATE_LIMIT': '5', 'AGENT_LOGIN_RATE_LIMIT': '10',
        'AGENT_MCP_CREDENTIAL_KEY': base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
        'AGENT_MCP_DEVELOPMENT_ORIGINS': json.dumps([
            'http://localhost:8012', 'http://127.0.0.1:8013',
        ]),
        'SERVER_API_URL': 'http://127.0.0.1:8011', 'APP_ORIGIN': 'http://127.0.0.1:3101',
    })
    demo_server = subprocess.Popen(
        [str(demo / '.venv' / 'bin' / 'python'), '-m', 'ecommerce_mcp.server'],
        env={**env, 'ECOMMERCE_PORT': '8013', 'ECOMMERCE_DATA_DIR': demo_data.name, 'PYTHONPATH': str(demo / 'src')},
        cwd=demo, start_new_session=True)
    children.append(demo_server)
    api = subprocess.Popen([sys.executable, '-c',
        'from api.main import create_app; from core.settings import Settings; import uvicorn; '
        'uvicorn.run(create_app(Settings(_env_file=None)), host="127.0.0.1", port=8011, proxy_headers=False, access_log=False)'],
        env=env, start_new_session=True)
    children.append(api)
    for _ in range(100):
        if api.poll() is not None:
            raise RuntimeError('Test API stopped before readiness')
        try:
            with urlopen('http://127.0.0.1:8011/ready', timeout=1) as response:
                if response.status == 200:
                    break
        except OSError:
            time.sleep(0.1)
    else:
        raise RuntimeError('Test API did not become ready')
    for _ in range(100):
        if demo_server.poll() is not None:
            raise RuntimeError('Demo MCP server stopped before readiness')
        try:
            with urlopen(tools_request, timeout=1) as response:
                if response.status == 200:
                    break
        except OSError:
            time.sleep(0.1)
    else:
        raise RuntimeError('Demo MCP server did not become ready')
    web = subprocess.Popen(['node', str(apps / 'web-client' / 'node_modules' / 'next' / 'dist' / 'bin' / 'next'), 'start', '--hostname', '127.0.0.1', '--port', '3101'], env=env, start_new_session=True)
    children.append(web)
    while all(child.poll() is None for child in children):
        time.sleep(0.5)
except KeyboardInterrupt:
    pass
finally:
    for child in reversed(children):
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))

    demo_data.cleanup()
