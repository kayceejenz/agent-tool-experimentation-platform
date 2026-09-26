from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class RefreshTokenSession:
    id: UUID
    user_id: UUID
    family_id: UUID
    token_hash: str
    expires_at: datetime
    revoked_at: datetime | None
