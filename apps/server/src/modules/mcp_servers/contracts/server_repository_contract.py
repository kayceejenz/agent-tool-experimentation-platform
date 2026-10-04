from __future__ import annotations

from datetime import datetime
from typing import Protocol
from uuid import UUID

from modules.mcp_servers.models.server_model import McpServer


class ServerRepositoryContract(Protocol):
    async def authorize(self, user_id: UUID, project_id: UUID) -> None: ...
    async def snapshot(
        self, user_id: UUID, project_id: UUID, server_id: UUID
    ) -> tuple[McpServer, bytes | None]: ...
    async def create(
        self,
        user_id: UUID,
        project_id: UUID,
        server_id: UUID,
        fields: dict,
        encrypted: bytes | None,
    ) -> McpServer: ...
    async def get(
        self, user_id: UUID, project_id: UUID, server_id: UUID
    ) -> McpServer: ...
    async def list(
        self,
        user_id: UUID,
        project_id: UUID,
        limit: int,
        after: tuple[datetime, UUID] | None,
    ) -> list[McpServer]: ...
    async def update(
        self,
        user_id: UUID,
        project_id: UUID,
        server_id: UUID,
        version: int,
        changes: dict,
        replace_credential: bool,
        encrypted: bytes | None,
        discovered_tools: list | None = None,
    ) -> McpServer: ...
