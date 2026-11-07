import asyncio
from typing import Annotated
from uuid import UUID, uuid4

from api.dependencies import Config, User
from fastapi import APIRouter, HTTPException, Query, Request
from integrations.object_storage import object_storage
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException

from modules.datasets.repos.dataset_repo import DatasetRepository
from modules.datasets.services.file_storage import DatasetStorage

router = APIRouter(prefix="/projects/{project_id}/datasets", tags=["datasets"])


def resources(request, config):
    return (
        DatasetRepository(request.app.state.database),
        DatasetStorage(
            config.dataset_storage_root,
            config.dataset_file_limit_bytes,
            object_storage(config),
        ),
    )


@router.get("")
async def list_datasets(
    project_id: UUID,
    request: Request,
    user: User,
    config: Config,
    offset: Annotated[int, Query(ge=0, le=100000)] = 0,
):
    repo, _ = resources(request, config)
    return {"items": await repo.list(user.id, project_id, offset)}


@router.post("", status_code=201)
async def upload(project_id: UUID, request: Request, user: User, config: Config):
    repo, storage = resources(request, config)
    await repo.authorize(user.id, project_id, True)
    # Bound the entire multipart stream, including file spool and form overhead.
    limit = config.dataset_total_limit_bytes + 1024 * 1024
    received = 0

    async def receive():
        nonlocal received
        message = await request.receive()
        received += len(message.get("body", b""))
        if received > limit:
            raise MultiPartException("Dataset exceeds the total upload limit")
        return message

    bounded = Request(request.scope, receive)
    dataset_id = uuid4()
    committed = False
    try:
        async with bounded.form(max_files=20, max_fields=1, max_part_size=1024) as form:
            name = form.get("name", "")
            if (
                not isinstance(name, str)
                or not 1 <= len(name.strip()) <= 160
                or "\x00" in name
            ):
                raise HTTPException(422, "Enter a dataset name up to 160 characters")
            uploads = form.getlist("files")
            if not uploads or any(not isinstance(f, UploadFile) for f in uploads):
                raise HTTPException(422, "Select between 1 and 20 CSV files")
            names, files, total = set(), [], 0
            for item in uploads:
                filename = storage.filename(item.filename)
                if filename in names:
                    raise HTTPException(422, "Duplicate filenames are not supported")
                names.add(filename)
                file_id = uuid4()
                metadata = await storage.save(dataset_id, file_id, item)
                total += metadata["size_bytes"]
                if total > config.dataset_total_limit_bytes:
                    raise HTTPException(413, "Dataset exceeds the total upload limit")
                await asyncio.to_thread(storage.preview, dataset_id, file_id)
                files.append({"id": file_id, "name": filename, **metadata})
            await repo.create(user.id, project_id, dataset_id, name.strip(), files)
            committed = True
        return await repo.get(user.id, project_id, dataset_id)
    except StarletteHTTPException:
        if received > limit:
            raise HTTPException(413, "Dataset exceeds the total upload limit") from None
        raise
    finally:
        if not committed:
            await asyncio.to_thread(storage.remove, dataset_id)


@router.get("/{dataset_id}")
async def detail(
    project_id: UUID, dataset_id: UUID, request: Request, user: User, config: Config
):
    repo, _ = resources(request, config)
    return await repo.get(user.id, project_id, dataset_id)


@router.get("/{dataset_id}/files/{file_id}/preview")
async def preview(
    project_id: UUID,
    dataset_id: UUID,
    file_id: UUID,
    request: Request,
    user: User,
    config: Config,
):
    repo, storage = resources(request, config)
    dataset = await repo.get(user.id, project_id, dataset_id)
    if not any(f["id"] == file_id for f in dataset["files"]):
        raise HTTPException(404, "Dataset file not found")
    return await asyncio.to_thread(storage.preview, dataset_id, file_id)


@router.delete("/{dataset_id}")
async def delete_dataset(
    project_id: UUID, dataset_id: UUID, request: Request, user: User, config: Config
):
    repo, storage = resources(request, config)

    async def remove_files():
        await asyncio.to_thread(storage.remove, dataset_id, strict=True)

    await repo.delete(user.id, project_id, dataset_id, remove_files)
    return {"deleted": True}
