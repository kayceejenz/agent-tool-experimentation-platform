from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

AuthType = Literal["none", "bearer"]


@dataclass(frozen=True)
class McpServer:
    id: UUID
    project_id: UUID
    name: str
    endpoint: str
    transport: Literal["streamable_http"]
    auth_type: AuthType
    enabled: bool
    connection_status: Literal["untested", "connected", "error"]
    last_checked_at: datetime | None
    last_error_code: str | None
    config_version: int
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    credential_configured: bool
