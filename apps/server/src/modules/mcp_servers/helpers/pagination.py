import base64
import binascii
import json
from datetime import datetime
from uuid import UUID

from modules.mcp_servers.models.error_model import McpConnectionError


def decode_cursor(cursor: str | None) -> tuple[datetime, UUID] | None:
    if cursor is None:
        return None
    try:
        values = json.loads(base64.b64decode(cursor, altchars=b"-_", validate=True))
        if (
            not isinstance(values, list)
            or len(values) != 2
            or not all(isinstance(item, str) for item in values)
        ):
            raise ValueError

        timestamp = datetime.fromisoformat(values[0])

        if timestamp.tzinfo is None:
            raise ValueError

        return timestamp, UUID(values[1])
    except (ValueError, TypeError, binascii.Error, UnicodeError):
        raise McpConnectionError(422, "Invalid connection cursor") from None


def encode_cursor(item) -> str:
    return base64.urlsafe_b64encode(
        json.dumps([item.created_at.isoformat(), str(item.id)]).encode()
    ).decode()
