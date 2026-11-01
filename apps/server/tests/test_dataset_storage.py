import asyncio
import hashlib
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from modules.datasets.services.file_storage import DatasetStorage


def test_hash_preview_and_immutable_bytes(tmp_path):
    storage = DatasetStorage(tmp_path)
    dataset, file = uuid4(), uuid4()
    content = b"Animal_ID,Duration_s\r\n001,12\r\n002,24\r\n"
    result = asyncio.run(storage.save(dataset, file, UploadFile(BytesIO(content))))
    assert result == {
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    assert storage.preview(dataset, file)["rows"] == [["001", "12"], ["002", "24"]]
    assert storage.path(dataset, file).read_bytes() == content
    storage.remove(dataset)
    assert not storage.path(dataset, file).exists()


@pytest.mark.parametrize("name", ["../a.csv", "a\\b.csv", "a.xlsx", "", "bad\x00.csv"])
def test_rejects_unsafe_names(name):
    with pytest.raises(HTTPException):
        DatasetStorage.filename(name)


def test_limits_cleanup_and_malformed_preview(tmp_path):
    storage = DatasetStorage(tmp_path, file_limit=10)
    dataset, file = uuid4(), uuid4()
    with pytest.raises(HTTPException) as error:
        asyncio.run(storage.save(dataset, file, UploadFile(BytesIO(b"x" * 11))))
    assert error.value.status_code == 413
    assert not storage.path(dataset, file).exists()
    asyncio.run(storage.save(dataset, file, UploadFile(BytesIO(b"a,b\n1\n"))))
    with pytest.raises(HTTPException):
        storage.preview(dataset, file)


def test_preview_bounded_and_symlink_denied(tmp_path):
    storage = DatasetStorage(tmp_path)
    dataset, file = uuid4(), uuid4()
    asyncio.run(
        storage.save(dataset, file, UploadFile(BytesIO(b"a,b\n" + b"1,2\n" * 100)))
    )
    result = storage.preview(dataset, file)
    assert len(result["rows"]) == 20 and result["truncated"]
    storage.path(dataset, file).unlink()
    storage.path(dataset, file).symlink_to("/etc/passwd")
    with pytest.raises(HTTPException):
        storage.preview(dataset, file)
