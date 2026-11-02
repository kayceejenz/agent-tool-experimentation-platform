import hashlib

import pytest
from integrations.sandbox.workspace import Workspace


def test_workspace_rejects_paths_links_and_changed_hash(tmp_path):
    source = tmp_path / "events.csv"
    source.write_text("animal,duration\n001,42\n")
    workspace = Workspace(tmp_path / "runs")
    for name in ("../escape.csv", "/absolute.csv", "a\\b.csv"):
        with pytest.raises(ValueError):
            workspace.add(source, name)
    with pytest.raises(ValueError, match="checksum"):
        workspace.add(source, expected_hash="wrong")
    assert not (workspace.inputs / source.name).exists()
    workspace.add(source, expected_hash=hashlib.sha256(source.read_bytes()).hexdigest())
    with pytest.raises(FileExistsError):
        workspace.add(source)
    link = tmp_path / "link.csv"
    link.symlink_to(source)
    with pytest.raises(ValueError):
        workspace.add(link)
    assert workspace.manifest[0]["size_bytes"] == source.stat().st_size
    workspace.cleanup_inputs()
    assert source.read_text().endswith("001,42\n")
