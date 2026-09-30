from ipaddress import ip_address
from urllib.parse import urlsplit, urlunsplit

from core.settings import Settings

from modules.mcp_servers.models.error_model import McpConnectionError


def validate_endpoint(value: str, config: Settings) -> str:
    """Configuration validation only; transport must also validate resolved IPs at dial time."""
    try:
        if any(ord(char) <= 32 or ord(char) == 127 for char in value) or "\\" in value:
            raise ValueError

        url = urlsplit(value)

        if (
            url.scheme not in {"https", "http"}
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.query
            or url.fragment
        ):
            raise ValueError

        host = url.hostname.lower()

        if "%" in host:
            raise ValueError

        port = url.port

        if port == 0:
            raise ValueError

        authority = f"[{host}]" if ":" in host else host

        if port is not None:
            authority += f":{port}"

        origin = f"{url.scheme}://{authority}"

        development = (
            config.app_env == "development" and origin in config.mcp_development_origins
        )

        if not development:
            if (
                url.scheme != "https"
                or host == "localhost"
                or host.endswith((".localhost", ".local", ".internal"))
            ):
                raise ValueError

            try:
                address = ip_address(host)
            except ValueError:
                if "." not in host or not all(
                    part
                    and all(c.isascii() and (c.isalnum() or c == "-") for c in part)
                    for part in host.split(".")
                ):
                    raise ValueError
            else:
                if not address.is_global:
                    raise ValueError

        return urlunsplit((url.scheme, authority, url.path or "/", "", ""))
    except ValueError:
        raise McpConnectionError(
            422,
            "Use an HTTPS endpoint without URL credentials, query parameters, or fragments; local development endpoints must be explicitly allowed.",
        ) from None
