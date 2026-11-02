import hashlib
import shutil
from pathlib import Path
from uuid import uuid4


class Workspace:
    """Copy only explicit files, with fresh UUID paths and verified input bytes."""

    def __init__(self, root):
        self.id = uuid4().hex
        self.path = Path(root).resolve() / self.id
        self.inputs = self.path / "inputs"
        self.scripts = self.path / "scripts"
        self.outputs = self.path / "outputs"
        for directory in (self.inputs, self.scripts, self.outputs):
            directory.mkdir(parents=True, exist_ok=False)
            directory.chmod(0o755)
        self.manifest = []

    def add(self, source, name=None, expected_hash=None):
        source = Path(source)
        name = name or source.name
        if (
            not name
            or len(name) > 255
            or name in (".", "..")
            or "/" in name
            or "\\" in name
            or any(ord(c) < 32 for c in name)
            or source.is_symlink()
            or not source.is_file()
        ):
            raise ValueError("Inputs must be regular files with plain filenames")
        if (
            sum(item["size_bytes"] for item in self.manifest) + source.stat().st_size
            > 128 * 1024 * 1024
        ):
            raise ValueError("Sandbox inputs exceed 128 MiB")
        target = self.inputs / name
        digest = hashlib.sha256()
        with source.open("rb") as incoming, target.open("xb") as output:
            while chunk := incoming.read(1024 * 1024):
                digest.update(chunk)
                output.write(chunk)
        checksum = digest.hexdigest()
        if expected_hash and checksum != expected_hash:
            target.unlink()
            raise ValueError("Dataset input checksum changed")
        target.chmod(0o444)
        self.manifest.append(
            {"name": name, "sha256": checksum, "size_bytes": target.stat().st_size}
        )

    def cleanup_inputs(self):
        shutil.rmtree(self.inputs)
