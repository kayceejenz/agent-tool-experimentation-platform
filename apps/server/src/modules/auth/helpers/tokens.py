from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt

from modules.auth.models.auth_user_model import AuthenticatedUser


class JwtAccessTokenIssuer:
    def __init__(
        self, secret: str, issuer: str, audience: str, lifetime_minutes: int = 15
    ) -> None:
        self.secret, self.issuer, self.audience = secret, issuer, audience
        self.lifetime = timedelta(minutes=lifetime_minutes)

    def issue(self, user: AuthenticatedUser) -> tuple[str, int]:
        now = datetime.now(UTC)
        payload = {
            "sub": str(user.id),
            "email": user.email,
            "ver": user.token_version,
            "jti": str(uuid4()),
            "iss": self.issuer,
            "aud": self.audience,
            "iat": now,
            "exp": now + self.lifetime,
        }
        return jwt.encode(payload, self.secret, algorithm="HS256"), int(
            self.lifetime.total_seconds()
        )

    def verify(self, token: str) -> AuthenticatedUser:
        data = jwt.decode(
            token,
            self.secret,
            algorithms=["HS256"],
            issuer=self.issuer,
            audience=self.audience,
            options={
                "require": ["sub", "jti", "iss", "aud", "iat", "exp", "email", "ver"]
            },
        )
        return AuthenticatedUser(
            UUID(data["sub"]), data["email"], None, int(data["ver"])
        )
