class InvalidCredentialsError(Exception):
    pass


class InvalidRefreshTokenError(Exception):
    pass


class InvalidAccessTokenError(Exception):
    pass


class AccountAlreadyExistsError(Exception):
    pass


class InvalidInvitationCodeError(Exception):
    pass


class AuthRateLimitExceededError(Exception):
    def __init__(self, retry_after_seconds: int) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__("Authentication rate limit exceeded")
