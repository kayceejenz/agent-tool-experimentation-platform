from typing import Protocol

from modules.auth.models.password_account_model import PasswordAccount


class AuthenticationRecorder(Protocol):
    async def record_success(self, account: PasswordAccount) -> None: ...
    async def record_failure(self, account: PasswordAccount) -> None: ...
