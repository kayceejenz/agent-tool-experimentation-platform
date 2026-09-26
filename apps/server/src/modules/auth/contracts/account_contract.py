from typing import Protocol
from uuid import UUID

from modules.auth.models.password_account_model import PasswordAccount


class AccountReader(Protocol):
    async def find_by_email(self, email: str) -> PasswordAccount | None: ...
    async def find_by_id(self, user_id: UUID) -> PasswordAccount | None: ...


class AccountWriter(Protocol):
    async def create(
        self, email: str, password_hash: str, display_name: str | None
    ) -> PasswordAccount: ...
