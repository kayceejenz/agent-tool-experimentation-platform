import re
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    SecretStr,
    StrictBool,
    StringConstraints,
    field_validator,
    model_validator,
)

from modules.mcp_servers.models.server_model import AuthType

Name = Annotated[
    str,
    StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=160),
]
Endpoint = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=2048)]


class CredentialRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    credential: SecretStr | None = None

    @field_validator("credential")
    @classmethod
    def validate_credential(cls, value):
        if value is not None:
            token = value.get_secret_value()
            if not 1 <= len(token) <= 8192 or not re.fullmatch(
                r"[A-Za-z0-9._~+/\-]+=*", token
            ):
                raise ValueError("Invalid bearer credential")
        return value


class CreateServerRequest(CredentialRequest):
    name: Name
    endpoint: Endpoint
    transport: Literal["streamable_http"] = "streamable_http"
    auth_type: AuthType = "none"

    @model_validator(mode="after")
    def credential_matches_auth(self):
        if (self.auth_type == "bearer") != (self.credential is not None):
            raise ValueError(
                "Bearer authentication requires a credential; no authentication must omit it"
            )
        return self


class ProbeServerRequest(CredentialRequest):
    endpoint: Endpoint
    transport: Literal["streamable_http"] = "streamable_http"
    auth_type: AuthType = "none"

    @model_validator(mode="after")
    def credential_matches_auth(self):
        if (self.auth_type == "bearer") != (self.credential is not None):
            raise ValueError(
                "Bearer authentication requires a credential; no authentication must omit it"
            )
        return self


class UpdateServerRequest(CredentialRequest):
    name: Name | None = None
    endpoint: Endpoint | None = None
    auth_type: AuthType | None = None
    enabled: StrictBool | None = None

    @model_validator(mode="after")
    def valid_changes(self):
        if not self.model_fields_set:
            raise ValueError("At least one change is required")
        for field in self.model_fields_set - {"credential"}:
            if getattr(self, field) is None:
                raise ValueError("Connection fields cannot be null")
        return self
