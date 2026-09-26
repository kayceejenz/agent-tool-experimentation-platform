import hashlib
import hmac

from modules.auth.models.error_model import AuthRateLimitExceededError


class AuthRateLimiter:
    def __init__(
        self,
        repository,
        secret: str,
        registration_limit: int,
        registration_window_seconds: int,
        login_limit: int,
        login_window_seconds: int,
    ) -> None:
        self.repository = repository
        self.secret = secret.encode()
        self.policies = {
            "register": (registration_limit, registration_window_seconds),
            "login": (login_limit, login_window_seconds),
        }

    async def check(self, action: str, client_identifier: str) -> None:
        (limit, window_seconds) = self.policies[action]

        client_key = hmac.new(
            self.secret, client_identifier.encode(), hashlib.sha256
        ).hexdigest()

        usage = await self.repository.consume(action, client_key, window_seconds)
        if usage.attempts > limit:
            raise AuthRateLimitExceededError(usage.retry_after_seconds)
