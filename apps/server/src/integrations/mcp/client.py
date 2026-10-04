"""Bounded MCP inspection over a DNS-pinned, non-redirecting HTTP transport."""

import asyncio
import socket
from ipaddress import ip_address

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from modules.mcp_servers.helpers.endpoint import validate_endpoint

MAX_BYTES = 1_048_576


class ProbeFailure(Exception):
    def __init__(self, code="connection_failed"):
        self.code = code


async def resolve_endpoint(endpoint, settings):
    url = httpx.URL(validate_endpoint(endpoint, settings))
    origin = str(url.copy_with(path="/")).rstrip("/")
    development = (
        settings.app_env == "development" and origin in settings.mcp_development_origins
    )
    addresses = await asyncio.get_running_loop().getaddrinfo(
        url.host,
        url.port or (443 if url.scheme == "https" else 80),
        type=socket.SOCK_STREAM,
    )
    ips = [item[4][0] for item in addresses]
    if not ips or (not development and any(not ip_address(ip).is_global for ip in ips)):
        raise ProbeFailure("endpoint_blocked")
    return url, ips[0]


class LimitedStream(httpx.AsyncByteStream):
    def __init__(self, stream, budget):
        self.stream = stream
        self.budget = budget

    async def __aiter__(self):
        async for chunk in self.stream:
            self.budget[0] -= len(chunk)
            if self.budget[0] < 0:
                raise ProbeFailure("response_too_large")
            yield chunk

    async def aclose(self):
        await self.stream.aclose()


class PinnedTransport(httpx.AsyncBaseTransport):
    def __init__(self, url, ip):
        self.url, self.ip = url, ip
        self.inner = httpx.AsyncHTTPTransport(retries=0)
        self.budget = [MAX_BYTES]

    async def handle_async_request(self, request):
        if request.url != self.url:
            raise ProbeFailure("endpoint_blocked")
        request.headers["Host"] = self.url.netloc.decode("ascii")
        request.headers["Accept-Encoding"] = "identity"
        request.extensions["sni_hostname"] = self.url.host
        request.url = request.url.copy_with(host=self.ip)

        response = await self.inner.handle_async_request(request)

        if response.status_code in (401, 403):
            await response.aclose()
            raise ProbeFailure("authentication_failed")

        if 300 <= response.status_code < 400:
            await response.aclose()
            raise ProbeFailure("redirect_blocked")

        if response.headers.get("content-encoding", "identity") != "identity":
            await response.aclose()
            raise ProbeFailure("unsupported_encoding")

        response.stream = LimitedStream(response.stream, self.budget)
        return response

    async def aclose(self):
        await self.inner.aclose()


def failure_code(error):
    if isinstance(error, ProbeFailure):
        return error.code
    if isinstance(error, (TimeoutError, httpx.TimeoutException)):
        return "timeout"
    if isinstance(error, BaseExceptionGroup):  # noqa: F821
        for child in error.exceptions:
            code = failure_code(child)
            if code != "connection_failed":
                return code
    return "connection_failed"


async def probe(endpoint, token, settings, discover=False):
    try:
        async with asyncio.timeout(7):
            url, ip = await resolve_endpoint(endpoint, settings)
            headers = (
                {"Authorization": f"Bearer {token.get_secret_value()}"} if token else {}
            )
            async with (
                httpx.AsyncClient(
                    transport=PinnedTransport(url, ip),
                    headers=headers,
                    follow_redirects=False,
                    trust_env=False,
                    timeout=5,
                ) as client,
                streamable_http_client(str(url), http_client=client) as (
                    read,
                    write,
                    _,
                ),
                ClientSession(read, write) as session,
            ):
                initialized = await session.initialize()
                tools = []
                if discover and initialized.capabilities.tools is not None:
                    cursor = None
                    seen = set()
                    names = set()
                    for _ in range(10):
                        page = await session.list_tools(cursor=cursor)
                        for tool in page.tools:
                            if tool.name in names or len(tools) >= 200:
                                raise ProbeFailure("tool_limit_exceeded")
                            names.add(tool.name)
                            tools.append(
                                {
                                    "name": tool.name,
                                    "description": tool.description,
                                    "input_schema": tool.inputSchema,
                                }
                            )
                        cursor = page.nextCursor
                        if not cursor:
                            break
                        if cursor in seen:
                            raise ProbeFailure("invalid_pagination")
                        seen.add(cursor)
                    else:
                        raise ProbeFailure("tool_limit_exceeded")
                return tools
    except Exception as error:  # noqa: BLE001 - sanitize all third-party transport failures
        # Never surface upstream errors, URLs, headers, or decrypted credentials.
        raise ProbeFailure(failure_code(error)) from None
