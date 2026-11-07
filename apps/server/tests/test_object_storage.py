import asyncio
import hashlib
from datetime import datetime, timedelta, timezone
from io import BytesIO
from uuid import uuid4

import boto3
import pytest
from botocore.response import StreamingBody
from botocore.stub import Stubber
from core.settings import Settings
from fastapi import HTTPException, UploadFile
from integrations.object_storage import R2Storage, StorageUnavailable, object_storage
from integrations.sandbox.artifacts import ArtifactStorage
from modules.agents.models.error_model import AgentError
from modules.datasets.services.file_storage import DatasetStorage
from pydantic import ValidationError


class MemoryS3:
    def __init__(self):
        self.objects = {}
        self.ranges = []

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.objects[Key] = Body.read()

    def get_object(self, Bucket, Key, Range=None):
        if Key not in self.objects:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        data = self.objects[Key]
        if Range:
            self.ranges.append(Range)
            data = data[: int(Range.split("-")[1]) + 1]
        return {"Body": BytesIO(data), "ContentLength": len(data)}

    def get_paginator(self, name):
        return self

    def paginate(self, Bucket, Prefix):
        yield {
            "Contents": [{"Key": key} for key in self.objects if key.startswith(Prefix)]
        }

    def delete_objects(self, Bucket, Delete):
        for obj in Delete["Objects"]:
            self.objects.pop(obj["Key"], None)
        return {}


@pytest.fixture
def remote():
    return R2Storage(MemoryS3(), "private-test", "agent-platform")


def test_local_default_and_r2_configuration_required():
    assert object_storage(Settings(_env_file=None)) is None
    with pytest.raises(ValidationError):
        Settings(_env_file=None, file_storage_backend="r2")
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            file_storage_backend="r2",
            r2_endpoint_url="http://unsafe",
            r2_bucket_name="test",
            r2_access_key_id="test",
            r2_secret_access_key="test",
        )


def test_remote_upload_preview_materialize_cleanup_and_scoped_delete(tmp_path, remote):
    storage = DatasetStorage(tmp_path, remote=remote)
    dataset, file = uuid4(), uuid4()
    data = b"Animal_ID,Duration_s\n001,24\n"

    async def exercise():
        meta = await storage.save(dataset, file, UploadFile(BytesIO(data)))
        assert meta["sha256"] == hashlib.sha256(data).hexdigest()
        assert not storage.path(dataset, file).exists()
        assert storage.preview(dataset, file)["rows"] == [["001", "24"]]
        async with storage.materialize(dataset, file) as path:
            assert path.read_bytes() == data
        assert not path.exists()

    asyncio.run(exercise())
    # Another application and a neighbouring dataset must never be removed.
    remote.client.objects["rag/sources/keep"] = b"keep"
    remote.client.objects[f"agent-platform/datasets/{dataset}-other/keep"] = b"keep"
    storage.remove(dataset, strict=True)
    assert len(remote.client.objects) == 2
    assert remote.client.ranges == ["bytes=0-262144"]


def test_remote_artifact_integrity_expiry_and_no_local_fallback(
    tmp_path, remote, monkeypatch
):
    monkeypatch.setattr(
        "integrations.sandbox.artifacts.object_storage", lambda _: remote
    )
    session, identifier = uuid4().hex, uuid4().hex + ".csv"
    data = b"a,b\n1,2\n"
    key = f"agent-platform/artifacts/{session}/{identifier}"
    remote.client.objects[key] = data
    record = {
        "status": "completed",
        "created_at": datetime.now(timezone.utc),
        "finished_at": datetime.now(timezone.utc),
        "analysis_result": {
            "session_id": session,
            "artifacts": [
                {
                    "id": identifier,
                    "name": "results.csv",
                    "size_bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            ],
        },
    }
    storage = ArtifactStorage(
        Settings(_env_file=None, sandbox_storage_root=str(tmp_path))
    )
    assert storage.preview(record, identifier)["rows"] == [["1", "2"]]
    remote.client.objects[key] = b"a,b\n9,9\n"
    with pytest.raises(AgentError, match="integrity"):
        storage.read(record, identifier)
    del remote.client.objects[key]
    local = tmp_path / "sessions" / session / "outputs" / identifier
    local.parent.mkdir(parents=True)
    local.write_bytes(data)
    with pytest.raises(AgentError):
        storage.read(record, identifier)
    remote.client.objects[key] = data
    record["finished_at"] -= timedelta(days=8)
    with pytest.raises(AgentError) as error:
        storage.read(record, identifier)
    assert error.value.status == 410


def test_sdk_errors_are_sanitized_and_reads_are_bounded():
    client = boto3.client(
        "s3",
        endpoint_url="https://example.r2.cloudflarestorage.com",
        region_name="auto",
        aws_access_key_id="fake",
        aws_secret_access_key="fake",
    )
    store = R2Storage(client, "test", "agent-platform")
    with Stubber(client) as stub:
        stub.add_client_error(
            "get_object",
            service_error_code="AccessDenied",
            service_message="private credential detail",
            expected_params={"Bucket": "test", "Key": "agent-platform/test"},
        )
        with pytest.raises(StorageUnavailable) as error:
            store.read("test", 10)
        assert "private credential detail" not in str(error.value)
        stub.add_response(
            "get_object",
            {"Body": StreamingBody(BytesIO(b"abc"), 3), "ContentLength": 3},
            {"Bucket": "test", "Key": "agent-platform/test"},
        )
        with pytest.raises(StorageUnavailable):
            store.read("test", 2)
        stub.assert_no_pending_responses()


def test_remote_download_limit_and_failed_upload_cleanup(tmp_path, remote):
    remote.client.objects["agent-platform/large"] = b"x" * 100
    with pytest.raises(StorageUnavailable):
        remote.download("large", tmp_path / "large", 10)
    storage = DatasetStorage(tmp_path, remote=remote)
    dataset, file = uuid4(), uuid4()
    # Invalid data is rejected before it becomes a durable object.
    with pytest.raises(HTTPException):
        asyncio.run(storage.save(dataset, file, UploadFile(BytesIO(b"\xff"))))
    assert not storage.path(dataset, file).exists()
    assert not any(str(dataset) in key for key in remote.client.objects)


def test_pinned_image_does_not_require_api_docker_access(monkeypatch):
    from integrations.sandbox.tools import image_identity

    async def unexpected(*args, **kwargs):
        pytest.fail("API must not need Docker when a production image ID is pinned")

    monkeypatch.setattr("integrations.sandbox.tools.process", unexpected)
    image = "sha256:" + "a" * 64
    assert (
        asyncio.run(image_identity(Settings(_env_file=None, sandbox_image_id=image)))
        == image
    )
