import asyncio
import socket

import httpx
import pytest
from mcp.server.fastmcp import FastMCP

from core.settings import Settings
from integrations.mcp.client import (
    LimitedStream,
    PinnedTransport,
    ProbeFailure,
    probe,
    resolve_endpoint,
)


def settings():
    return Settings(_env_file=None, mcp_development_origins=["http://127.0.0.1:8012"])


def test_real_mcp_handshake_and_discovery(monkeypatch):
    async def run():
        server = FastMCP("Test", stateless_http=True, json_response=True)

        @server.tool()
        def inspect_dataset(dataset_id: str) -> dict[str, str]:
            """Inspect a dataset."""
            raise AssertionError("Discovery must not execute tools")

        app = server.streamable_http_app()
        original = PinnedTransport.__init__

        def init(self, url, ip):
            original(self, url, ip)
            self.inner = httpx.ASGITransport(app=app)

        monkeypatch.setattr(PinnedTransport, "__init__", init)
        async with server.session_manager.run():
            assert await probe("http://127.0.0.1:8012/mcp", None, settings()) == []
            tools = await probe("http://127.0.0.1:8012/mcp", None, settings(), True)
            assert tools[0]["name"] == "inspect_dataset"
            assert "dataset_id" in tools[0]["input_schema"]["properties"]

    asyncio.run(run())


def test_private_dns_is_blocked(monkeypatch):
    async def run():
        async def resolve(*args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]

        monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolve)
        with pytest.raises(ProbeFailure, match="endpoint_blocked"):
            await resolve_endpoint("https://public.example/mcp", settings())

    asyncio.run(run())


def test_transport_pins_address_and_preserves_tls_host():
    async def run():
        url = httpx.URL("https://mcp.example/mcp")
        transport = PinnedTransport(url, "93.184.216.34")

        def respond(request):
            assert request.url.host == "93.184.216.34"
            assert request.headers["Host"] == "mcp.example"
            assert request.extensions["sni_hostname"] == "mcp.example"
            return httpx.Response(200, json={})

        transport.inner = httpx.MockTransport(respond)
        async with httpx.AsyncClient(transport=transport) as client:
            assert (await client.post(url)).status_code == 200

    asyncio.run(run())


@pytest.mark.parametrize(
    "status,code",
    [
        (302, "redirect_blocked"),
        (401, "authentication_failed"),
        (403, "authentication_failed"),
    ],
)
def test_transport_rejects_redirects_and_auth_failures(status, code):
    async def run():
        url = httpx.URL("https://mcp.example/mcp")
        transport = PinnedTransport(url, "93.184.216.34")
        transport.inner = httpx.MockTransport(lambda request: httpx.Response(status))
        async with httpx.AsyncClient(transport=transport) as client:
            with pytest.raises(ProbeFailure, match=code):
                await client.post(url)

    asyncio.run(run())


def test_response_byte_limit():
    async def run():
        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b"12345"

        with pytest.raises(ProbeFailure, match="response_too_large"):
            async for _ in LimitedStream(Stream(), [4]):
                pass

    asyncio.run(run())
