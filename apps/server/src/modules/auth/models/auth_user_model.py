from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class AuthenticatedUser:
    id: UUID
    email: str
    display_name: str | None
    token_version: int
