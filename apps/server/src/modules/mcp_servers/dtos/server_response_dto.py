from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from modules.mcp_servers.models.server_model import AuthType


class ServerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
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


class ServerListResponse(BaseModel):
    items: list[ServerResponse]
    next_cursor: str | None


class DiscoveredToolResponse(BaseModel):
    name: str
    description: str | None
    input_schema: dict


class ServerInspectionResponse(BaseModel):
    server: ServerResponse
    tools: list[DiscoveredToolResponse] | None


class ServerProbeResponse(BaseModel):
    reachable: bool
    error_code: str | None = None
