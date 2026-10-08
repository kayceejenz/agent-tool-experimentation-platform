from typing import Annotated
from uuid import UUID

from api.dependencies import current_user
from fastapi import APIRouter, Depends, Query, Request

from modules.auth.models.auth_user_model import AuthenticatedUser
from modules.prompts.dtos.prompt_dto import (
    CreatePromptRequest,
    CreateRevisionRequest,
    PromptPage,
    PromptResponse,
    PromptType,
)

router = APIRouter(prefix="/projects/{project_id}/prompts", tags=["prompts"])
User = Annotated[AuthenticatedUser, Depends(current_user)]


@router.post("", response_model=PromptResponse, status_code=201)
async def create(
    project_id: UUID, user: User, body: CreatePromptRequest, request: Request
):
    return await request.app.state.prompts.create(user.id, project_id, body)


@router.get("", response_model=PromptPage)
async def list_prompts(
    project_id: UUID,
    user: User,
    request: Request,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
    type: PromptType | None = None,
    q: Annotated[str, Query(max_length=160)] = "",
):
    return await request.app.state.prompts.list(user.id, project_id, offset, type, q)


@router.get("/{prompt_id}", response_model=PromptResponse)
async def get(project_id: UUID, prompt_id: UUID, user: User, request: Request):
    return await request.app.state.prompts.get(user.id, project_id, prompt_id)


@router.get("/{prompt_id}/revisions", response_model=PromptPage)
async def history(
    project_id: UUID,
    prompt_id: UUID,
    user: User,
    request: Request,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
):
    return await request.app.state.prompts.history(
        user.id, project_id, prompt_id, offset
    )


@router.get("/{prompt_id}/revisions/{revision}", response_model=PromptResponse)
async def revision(
    project_id: UUID, prompt_id: UUID, revision: int, user: User, request: Request
):
    return await request.app.state.prompts.get(user.id, project_id, prompt_id, revision)


@router.post("/{prompt_id}/revisions", response_model=PromptResponse)
async def revise(
    project_id: UUID,
    prompt_id: UUID,
    user: User,
    body: CreateRevisionRequest,
    request: Request,
):
    return await request.app.state.prompts.revise(user.id, project_id, prompt_id, body)
