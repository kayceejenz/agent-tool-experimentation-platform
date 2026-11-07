"""Immutable UUID-addressed inputs; original filenames are display metadata only."""

import asyncio
import csv
import hashlib
import io
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import HTTPException


class DatasetStorage:
    def __init__(self, root, file_limit=64 * 1024 * 1024, remote=None):
        self.root = Path(root).resolve()
        self.file_limit = file_limit
        self.remote = remote

    @staticmethod
    def filename(name):
        if (
            not name
            or len(name) > 255
            or "/" in name
            or "\\" in name
            or any(ord(c) < 32 for c in name)
            or not name.lower().endswith(".csv")
        ):
            raise HTTPException(422, "Use plain CSV filenames, up to 255 characters")
        return name

    def path(self, dataset_id, file_id):
        # Callers pass validated UUIDs, never filenames or request path fragments.
        from uuid import UUID

        path = self.root / str(UUID(str(dataset_id))) / str(UUID(str(file_id)))
        if path.is_symlink() or path.parent.is_symlink():
            raise HTTPException(404, "Dataset file unavailable")
        return path

    @staticmethod
    def key(dataset_id, file_id=None):
        from uuid import UUID

        key = "datasets/" + str(UUID(str(dataset_id)))
        return key if file_id is None else key + "/" + str(UUID(str(file_id)))

    @asynccontextmanager
    async def materialize(self, dataset_id, file_id):
        if self.remote is None:
            yield self.path(dataset_id, file_id)
            return
        with tempfile.TemporaryDirectory(prefix="agent-input-") as directory:
            path = Path(directory) / str(file_id)
            await asyncio.to_thread(
                self.remote.download,
                self.key(dataset_id, file_id),
                path,
                self.file_limit,
            )
            yield path

    async def save(self, dataset_id, file_id, upload):
        path = self.path(dataset_id, file_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        digest, size = hashlib.sha256(), 0
        try:
            with path.open("xb") as output:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.file_limit:
                        raise HTTPException(
                            413, "CSV exceeds the per-file upload limit"
                        )
                    digest.update(chunk)
                    output.write(chunk)
            if not size:
                raise HTTPException(422, "Empty CSV files are not supported")
            path.chmod(0o400)
            if self.remote is not None:
                # Validate before publishing; never keep a cloud upload as local truth.
                await asyncio.to_thread(self.preview_path, path)
                await asyncio.to_thread(
                    self.remote.upload, self.key(dataset_id, file_id), path, "text/csv"
                )
                path.unlink()
                path.parent.rmdir()
            return {"size_bytes": size, "sha256": digest.hexdigest()}
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    def remove(self, dataset_id, strict=False):
        from uuid import UUID

        if self.remote is not None:
            self.remote.delete_prefix(self.key(dataset_id))
        directory = self.root / str(UUID(str(dataset_id)))
        if directory.is_symlink():
            raise HTTPException(404, "Dataset unavailable")
        if strict:
            try:
                shutil.rmtree(directory)
            except FileNotFoundError:
                pass
            except OSError:
                raise HTTPException(
                    503, "Dataset files could not be removed. Please retry"
                ) from None
        else:
            shutil.rmtree(directory, ignore_errors=True)

    def preview(self, dataset_id, file_id):
        if self.remote is not None:
            try:
                raw = self.remote.read(
                    self.key(dataset_id, file_id), 256 * 1024 + 1, preview=True
                )
            except FileNotFoundError:
                raise HTTPException(404, "Dataset file unavailable") from None
            return self.parse_preview(raw)
        return self.preview_path(self.path(dataset_id, file_id))

    @staticmethod
    def preview_path(path):
        try:
            with path.open("rb") as source:
                raw = source.read(256 * 1024 + 1)
        except FileNotFoundError:
            raise HTTPException(404, "Dataset file unavailable") from None
        return DatasetStorage.parse_preview(raw)

    @staticmethod
    def parse_preview(raw):
        truncated = len(raw) > 256 * 1024
        raw = raw[: 256 * 1024]
        if truncated:
            raw = raw[: raw.rfind(b"\n") + 1]
        try:
            text = raw.decode("utf-8-sig")
            if "\x00" in text:
                raise ValueError
            dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
            reader = csv.reader(io.StringIO(text, newline=""), dialect, strict=True)
            headers = next(reader)
            if not headers or len(headers) > 100 or any(not h.strip() for h in headers):
                raise ValueError
            if len(set(headers)) != len(headers):
                raise ValueError
            rows = []
            for row in reader:
                if not row:
                    continue
                if len(row) != len(headers):
                    raise ValueError
                rows.append(row)
                if len(rows) == 21:
                    break
        except (UnicodeError, csv.Error, ValueError, StopIteration):
            raise HTTPException(
                422,
                "Preview requires UTF-8 CSV with unique headers and consistent columns",
            ) from None
        return {
            "headers": headers,
            "rows": rows[:20],
            "truncated": truncated or len(rows) > 20,
            "delimiter": dialect.delimiter,
            "validated_scope": "preview_only",
        }
