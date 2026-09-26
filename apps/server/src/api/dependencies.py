from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from modules.auth.models.error_model import InvalidAccessTokenError

bearer = HTTPBearer(auto_error=False, scheme_name="JWT Bearer", bearerFormat="JWT")


def settings(request: Request):
    return request.app.state.settings


def auth_service(request: Request):
    service = request.app.state.auth
    if service is None or request.app.state.database.pool is None:
        raise HTTPException(503, "Authentication temporarily unavailable")
    return service


def auth_rate_limiter(request: Request):
    auth_service(request)
    return request.app.state.auth_rate_limiter


async def current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
):
    error = HTTPException(
        401,
        "Missing, invalid, or expired access token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise error
    try:
        return await auth_service(request).authenticate_access_token(
            credentials.credentials
        )
    except InvalidAccessTokenError:
        raise error from None
