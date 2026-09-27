from ipaddress import ip_address
from secrets import compare_digest
from typing import Annotated

from api.dependencies import auth_rate_limiter, auth_service, current_user, settings
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from modules.auth.dtos.login_dto import LoginRequest
from modules.auth.dtos.register_dto import RegisterRequest
from modules.auth.dtos.token_dto import TokenResponse
from modules.auth.dtos.user_dto import UserResponse
from modules.auth.models.auth_user_model import AuthenticatedUser
from modules.auth.models.error_model import (
    AccountAlreadyExistsError,
    AuthRateLimitExceededError,
    InvalidCredentialsError,
    InvalidInvitationCodeError,
    InvalidRefreshTokenError,
)
from modules.auth.models.token_model import TokenPair
from modules.auth.services.auth_service import AuthenticationService
from modules.auth.services.rate_limit_service import AuthRateLimiter


def reject_foreign_origin(request: Request):
    origin = request.headers.get("origin")
    if origin is not None and origin not in settings(request).auth_origins:
        raise HTTPException(403, "Untrusted request origin")


router = APIRouter(
    prefix="/auth",
    tags=["authentication"],
    dependencies=[Depends(reject_foreign_origin)],
)


async def enforce_auth_rate_limit(
    request: Request,
    limiter: AuthRateLimiter,
    action: str,
) -> None:
    client_identifier = request.client.host if request.client else "unknown"
    proxy_secret = request.headers.get("x-agent-proxy-secret")
    forwarded = request.headers.get("x-agent-client-ip")
    if proxy_secret is not None or forwarded is not None:
        configured = settings(request).auth_proxy_secret
        if (
            not configured
            or not proxy_secret
            or not compare_digest(proxy_secret, configured.get_secret_value())
        ):
            raise HTTPException(403, "Untrusted authentication proxy")
        try:
            client_identifier = str(ip_address(forwarded or ""))
        except ValueError:
            raise HTTPException(400, "Invalid client address") from None
    try:
        await limiter.check(action, client_identifier)
    except AuthRateLimitExceededError as error:
        raise HTTPException(
            429,
            "Too many authentication attempts. Please try again later.",
            headers={"Retry-After": str(error.retry_after_seconds)},
        ) from None


def set_refresh_cookie(request: Request, response: Response, pair: TokenPair) -> None:
    c = settings(request)
    response.set_cookie(
        c.refresh_cookie_name,
        pair.refresh_token,
        max_age=c.refresh_token_days * 86400,
        httponly=True,
        secure=c.app_env == "production",
        samesite="strict",
        path="/api/v1/auth",
    )


def token_response(pair: TokenPair) -> TokenResponse:
    return TokenResponse(
        access_token=pair.access_token,
        token_type=pair.token_type,
        expires_in=pair.access_token_expires_in,
    )


@router.post("/register", response_model=UserResponse, status_code=201)
async def register(
    body: RegisterRequest,
    request: Request,
    service: Annotated[AuthenticationService, Depends(auth_service)],
    limiter: Annotated[AuthRateLimiter, Depends(auth_rate_limiter)],
):
    await enforce_auth_rate_limit(request, limiter, "register")
    try:
        user = await service.register(
            body.email,
            body.password,
            body.display_name,
            body.invitation_code,
        )
    except InvalidInvitationCodeError:
        raise HTTPException(403, "A valid invitation code is required") from None
    except AccountAlreadyExistsError:
        raise HTTPException(409, "Account already exists") from None
    return UserResponse(
        id=str(user.id), email=user.email, display_name=user.display_name
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    service: Annotated[AuthenticationService, Depends(auth_service)],
    limiter: Annotated[AuthRateLimiter, Depends(auth_rate_limiter)],
):
    await enforce_auth_rate_limit(request, limiter, "login")
    try:
        pair = await service.login(
            body.email,
            body.password,
            request.headers.get("user-agent"),
            client_ip(request),
        )
    except InvalidCredentialsError:
        raise HTTPException(401, "Invalid email or password") from None

    set_refresh_cookie(request, response, pair)
    return token_response(pair)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: Request,
    response: Response,
    service: Annotated[AuthenticationService, Depends(auth_service)],
):
    refresh_token = request.cookies.get(settings(request).refresh_cookie_name)
    if not refresh_token:
        raise HTTPException(401, "Missing refresh token")
    try:
        pair = await service.refresh(refresh_token)
    except InvalidRefreshTokenError:
        failed = JSONResponse(
            status_code=401, content={"detail": "Invalid refresh token"}
        )
        failed.delete_cookie(settings(request).refresh_cookie_name, path="/api/v1/auth")
        return failed
    set_refresh_cookie(request, response, pair)
    return token_response(pair)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    service: Annotated[AuthenticationService, Depends(auth_service)],
) -> None:
    refresh_token = request.cookies.get(settings(request).refresh_cookie_name)
    if refresh_token:
        await service.logout(refresh_token)
    response.delete_cookie(settings(request).refresh_cookie_name, path="/api/v1/auth")


@router.get("/me", response_model=UserResponse)
def me(user: Annotated[AuthenticatedUser, Depends(current_user)]) -> UserResponse:
    return UserResponse(
        id=str(user.id), email=user.email, display_name=user.display_name
    )


def client_ip(request: Request) -> str | None:
    try:
        return str(ip_address(request.client.host)) if request.client else None
    except ValueError:
        return None
