from uuid import UUID, uuid4

from core.settings import Settings
from integrations.mcp.credential_cipher import (
    CredentialCipher,
    CredentialStorageUnavailable,
)

from modules.mcp_servers.contracts.server_repository_contract import (
    ServerRepositoryContract,
)
from modules.mcp_servers.dtos.server_request_dto import (
    CreateServerRequest,
    UpdateServerRequest,
)
from modules.mcp_servers.helpers.endpoint import validate_endpoint
from modules.mcp_servers.helpers.pagination import decode_cursor, encode_cursor
from modules.mcp_servers.models.error_model import McpConnectionError


class ServerService:
    def __init__(
        self,
        repository: ServerRepositoryContract,
        cipher: CredentialCipher,
        settings: Settings,
    ):
        self.repository = repository
        self.cipher = cipher
        self.settings = settings

    def encrypt(self, credential, project_id, server_id, endpoint):
        try:
            return self.cipher.encrypt(credential, project_id, server_id, endpoint)
        except CredentialStorageUnavailable:
            raise McpConnectionError(
                503, "Credential storage is not configured. Contact the administrator."
            ) from None

    async def create(self, user_id: UUID, project_id: UUID, body: CreateServerRequest):
        await self.repository.authorize(user_id, project_id)
        endpoint = validate_endpoint(body.endpoint, self.settings)
        server_id = uuid4()
        encrypted = (
            self.encrypt(body.credential, project_id, server_id, endpoint)
            if body.credential
            else None
        )
        return await self.repository.create(
            user_id,
            project_id,
            server_id,
            {"name": body.name, "endpoint": endpoint, "auth_type": body.auth_type},
            encrypted,
        )

    async def get(self, user_id: UUID, project_id: UUID, server_id: UUID):
        return await self.repository.get(user_id, project_id, server_id)

    async def list(
        self, user_id: UUID, project_id: UUID, limit: int, cursor: str | None
    ):
        rows = await self.repository.list(
            user_id, project_id, limit + 1, decode_cursor(cursor)
        )
        return {
            "items": rows[:limit],
            "next_cursor": (
                encode_cursor(rows[limit - 1]) if len(rows) > limit else None
            ),
        }

    async def update(
        self,
        user_id: UUID,
        project_id: UUID,
        server_id: UUID,
        body: UpdateServerRequest,
    ):
        await self.repository.authorize(user_id, project_id)

        current = await self.repository.get(user_id, project_id, server_id)

        changes = body.model_dump(exclude_unset=True, exclude={"credential"})

        endpoint = (
            validate_endpoint(body.endpoint, self.settings)
            if body.endpoint is not None
            else current.endpoint
        )

        if "endpoint" in changes:
            changes["endpoint"] = endpoint

        auth_type = body.auth_type or current.auth_type

        credential_supplied = "credential" in body.model_fields_set
        
        endpoint_changed = endpoint != current.endpoint
        
        auth_changed = auth_type != current.auth_type
        
        if auth_type == "none" and body.credential is not None:
            raise McpConnectionError(422, "Credentials require bearer authentication")
        
        if auth_type == "bearer":
            if credential_supplied and body.credential is None:
                raise McpConnectionError(
                    422, "Switch authentication to none to remove the credential"
                )
            if (
                endpoint_changed or auth_changed or not current.credential_configured
            ) and body.credential is None:
                raise McpConnectionError(
                    422,
                    "Provide a new credential when changing the endpoint or enabling bearer authentication",
                )
        replace = credential_supplied or auth_changed
        encrypted = (
            self.encrypt(body.credential, project_id, server_id, endpoint)
            if body.credential is not None
            else None
        )
        if endpoint_changed or auth_changed or credential_supplied:
            changes.update(
                enabled=False,
                connection_status="untested",
                last_checked_at=None,
                last_error_code=None,
            )
        return await self.repository.update(
            user_id,
            project_id,
            server_id,
            current.config_version,
            changes,
            replace,
            encrypted,
        )
