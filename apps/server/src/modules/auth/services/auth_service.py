import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from anyio import CapacityLimiter, to_thread

from modules.auth.contracts.account_contract import AccountReader, AccountWriter
from modules.auth.contracts.auth_recorder_contract import AuthenticationRecorder
from modules.auth.contracts.password_hasher_contract import PasswordHasher
from modules.auth.contracts.token_issuer_contract import TokenIssuer
from modules.auth.models.auth_user_model import AuthenticatedUser
from modules.auth.models.error_model import (
    AccountAlreadyExistsError,
    InvalidAccessTokenError,
    InvalidCredentialsError,
    InvalidInvitationCodeError,
    InvalidRefreshTokenError,
)
from modules.auth.models.token_model import TokenPair
from modules.auth.repos.refresh_token_repo import RefreshTokenRepository


class AuthenticationService:
    def __init__(
        self,
        accounts: AccountReader,
        hasher: PasswordHasher,
        recorder: AuthenticationRecorder,
        access_tokens: TokenIssuer,
        refresh_tokens: RefreshTokenRepository,
        account_writer: AccountWriter,
        refresh_token_days: int = 30,
        registration_invitation_code: str | None = None,
        dummy_hash: str = "",
    ) -> None:
        self._accounts = accounts
        self._hasher = hasher
        self._recorder = recorder
        self._access_tokens = access_tokens
        self._refresh_tokens = refresh_tokens
        self._account_writer = account_writer
        self._refresh_token_lifetime = timedelta(days=refresh_token_days)
        self._registration_invitation_code = registration_invitation_code
        self._dummy_hash = dummy_hash
        self._hash_limiter = CapacityLimiter(4)

    async def authenticate_access_token(self, token: str) -> AuthenticatedUser:
        try:
            claim = self._access_tokens.verify(token)
        except Exception as error:
            raise InvalidAccessTokenError from error
        account = await self._accounts.find_by_id(claim.id)
        if (
            not account
            or not account.is_active
            or account.user.token_version != claim.token_version
        ):
            raise InvalidAccessTokenError
        return account.user

    async def register(
        self,
        email: str,
        password: str,
        display_name: str | None,
        invitation_code: str | None = None,
    ) -> AuthenticatedUser:
        if self._registration_invitation_code is not None:
            supplied_code = invitation_code or ""

            if not secrets.compare_digest(
                supplied_code.encode(), self._registration_invitation_code.encode()
            ):
                raise InvalidInvitationCodeError

        normalized_email = email.strip().lower()

        if await self._accounts.find_by_email(normalized_email):
            raise AccountAlreadyExistsError

        if len(password) < 12:
            raise ValueError("Password must contain at least 12 characters")

        return (
            await self._account_writer.create(
                normalized_email,
                await to_thread.run_sync(
                    self._hasher.hash, password, limiter=self._hash_limiter
                ),
                display_name,
            )
        ).user

    async def login(
        self,
        email: str,
        password: str,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> TokenPair:
        account = await self._accounts.find_by_email(email.strip().lower())

        password_matches = await to_thread.run_sync(
            self._hasher.verify,
            password,
            account.password_hash if account else self._dummy_hash,
            limiter=self._hash_limiter,
        )

        if account is None or not password_matches:
            if account:
                await self._recorder.record_failure(account)
            raise InvalidCredentialsError

        if not account.is_active:
            raise InvalidCredentialsError

        if account.locked_until and account.locked_until > datetime.now(UTC):
            raise InvalidCredentialsError

        await self._recorder.record_success(account)

        return await self._new_token_pair(account.user, uuid4(), user_agent, ip_address)

    async def refresh(self, raw_refresh_token: str) -> TokenPair:
        now = datetime.now(UTC)
        current = await self._refresh_tokens.find_by_hash(
            self._hash_token(raw_refresh_token)
        )

        if current is None:
            raise InvalidRefreshTokenError

        if current.revoked_at is not None:
            await self._refresh_tokens.revoke_family(
                current.family_id, "refresh token reuse detected"
            )
            raise InvalidRefreshTokenError

        if current.expires_at <= now:
            await self._refresh_tokens.revoke_family(
                current.family_id, "refresh token expired"
            )
            raise InvalidRefreshTokenError

        account = await self._accounts.find_by_id(current.user_id)
        if account is None or not account.is_active:
            await self._refresh_tokens.revoke_family(
                current.family_id, "account unavailable"
            )
            raise InvalidRefreshTokenError

        replacement = self._generate_refresh_token()
        try:
            await self._refresh_tokens.rotate(
                current,
                self._hash_token(replacement),
                now + self._refresh_token_lifetime,
            )
        except ValueError:
            await self._refresh_tokens.revoke_family(
                current.family_id, "refresh token reuse detected"
            )
            raise InvalidRefreshTokenError from None

        (access_token, expires_in) = self._access_tokens.issue(account.user)

        return TokenPair(access_token, replacement, expires_in)

    async def logout(self, raw_refresh_token: str) -> None:
        current = await self._refresh_tokens.find_by_hash(
            self._hash_token(raw_refresh_token)
        )
        if current:
            await self._refresh_tokens.revoke_family(current.family_id, "user logout")

    async def _new_token_pair(
        self,
        user: AuthenticatedUser,
        family_id,
        user_agent: str | None,
        ip_address: str | None,
    ) -> TokenPair:
        raw_refresh_token = self._generate_refresh_token()

        await self._refresh_tokens.create(
            user.id,
            family_id,
            self._hash_token(raw_refresh_token),
            datetime.now(UTC) + self._refresh_token_lifetime,
            user_agent,
            ip_address,
        )

        (access_token, expires_in) = self._access_tokens.issue(user)
        return TokenPair(access_token, raw_refresh_token, expires_in)

    @staticmethod
    def _generate_refresh_token() -> str:
        return secrets.token_urlsafe(64)

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()
