import hashlib
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from core.settings import Settings
from integrations.sandbox.artifacts import ArtifactStorage
from modules.agents.models.error_model import AgentError


def file_fixture(tmp_path, content=b"a,b\n1,2\n", suffix=".csv"):
    settings = Settings(_env_file=None, sandbox_storage_root=str(tmp_path))
    storage = ArtifactStorage(settings)
    session, identifier = uuid4().hex, uuid4().hex + suffix
    path = tmp_path / "sessions" / session / "outputs" / identifier
    path.parent.mkdir(parents=True)
    path.write_bytes(content)
    record = {
        "status": "completed",
        "created_at": datetime.now(timezone.utc),
        "finished_at": datetime.now(timezone.utc),
        "analysis_result": {
            "session_id": session,
            "artifacts": [
                {
                    "id": identifier,
                    "name": "test" + suffix,
                    "size_bytes": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            ],
        },
    }
    return storage, record, path


def test_registered_csv_and_json_previews(tmp_path):
    storage, record, path = file_fixture(tmp_path)
    result = storage.listing(record)
    assert result["items"][0]["availability"] == "available"
    assert "path" not in result["items"][0]
    assert storage.preview(record, path.name)["rows"] == [["1", "2"]]
    path.unlink()
    assert storage.listing(record)["items"][0]["availability"] == "unavailable"


def test_expired_unregistered_and_modified_files_are_not_served(tmp_path):
    storage, record, path = file_fixture(tmp_path)
    with pytest.raises(AgentError) as error:
        storage.read(record, uuid4().hex + ".csv")
    assert error.value.status == 404
    with pytest.raises(AgentError):
        storage.read(record, "../" + path.name)
    path.write_bytes(b"a,b\n9,9\n")
    with pytest.raises(AgentError, match="integrity"):
        storage.read(record, path.name)
    record["finished_at"] -= timedelta(days=8)
    assert storage.listing(record)["items"][0]["availability"] == "expired"
    with pytest.raises(AgentError) as error:
        storage.read(record, path.name)
    assert error.value.status == 410


def test_symlinks_and_html_disguised_as_png_are_rejected(tmp_path):
    storage, record, path = file_fixture(tmp_path)
    path.unlink()
    path.symlink_to("/etc/passwd")
    with pytest.raises(AgentError):
        storage.read(record, path.name)
    storage, record, path = file_fixture(tmp_path, b"<script>alert(1)</script>", ".png")
    assert storage.listing(record)["items"][0]["availability"] == "unavailable"
    with pytest.raises(AgentError) as error:
        storage.read(record, path.name)
    assert error.value.status == 422


def test_preview_is_bounded_and_text_is_inert(tmp_path):
    storage, record, path = file_fixture(
        tmp_path, b"a,b\n" + b"x" * 500 + b",y\n" + b"1,2\n" * 30
    )
    preview = storage.preview(record, path.name)
    assert len(preview["rows"]) == 20 and preview["truncated"]
    assert len(preview["rows"][0][0]) == 200
    storage, record, path = file_fixture(tmp_path, b"<script>alert(1)</script>", ".txt")
    assert storage.preview(record, path.name)["text"] == "<script>alert(1)</script>"
    assert (
        storage.listing(
            {
                "status": "failed",
                "created_at": datetime.now(timezone.utc),
                "finished_at": None,
                "analysis_result": None,
            }
        )["items"]
        == []
    )
