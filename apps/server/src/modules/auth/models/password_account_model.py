from dataclasses import dataclass
from datetime import datetime

from modules.auth.models.auth_user_model import AuthenticatedUser


@dataclass(frozen=True)
class PasswordAccount:
    user: AuthenticatedUser
    password_hash: str
    is_active: bool
    locked_until: datetime | None
