from typing import Protocol

from modules.auth.models.auth_user_model import AuthenticatedUser


class TokenIssuer(Protocol):
    def issue(self, user: AuthenticatedUser) -> tuple[str, int]: ...
    def verify(self, token: str) -> AuthenticatedUser: ...
