"""Serve only registered run outputs; never expose host paths or follow links."""

import csv
import hashlib
import io
import json
import os
import re
import stat
import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path

from modules.agents.models.error_model import AgentError

from integrations.object_storage import StorageUnavailable, object_storage

TYPES = {
    ".png": "image/png",
    ".csv": "text/csv",
    ".json": "application/json",
    ".txt": "text/plain",
    ".py": "text/x-python",
}
IDENTIFIER = re.compile(r"^[0-9a-f]{32}\.(png|csv|json|txt|py)$")
MAX_BYTES = 16 * 1024 * 1024


class ArtifactStorage:
    def __init__(self, settings):
        self.root = Path(settings.sandbox_storage_root).resolve() / "sessions"
        self.remote = object_storage(settings)
        self.retention = settings.sandbox_artifact_retention_days

    def expiry(self, execution):
        collected = (execution.get("analysis_result") or {}).get("collected_at")
        timestamp = (
            datetime.fromisoformat(collected)
            if collected
            else execution["finished_at"] or execution["created_at"]
        )
        return timestamp + timedelta(days=self.retention)

    def registered(self, execution, identifier):
        result = execution.get("analysis_result") or {}
        item = next(
            (
                item
                for item in result.get("artifacts", [])
                if item.get("id") == identifier
            ),
            None,
        )
        session = result.get("session_id", "")
        if (
            not IDENTIFIER.fullmatch(identifier)
            or not re.fullmatch(r"[0-9a-f]{32}", session)
            or not item
        ):
            raise AgentError(404, "Generated file not found")
        if datetime.now(timezone.utc) >= self.expiry(execution):
            raise AgentError(
                410, "This generated file has expired; run the analysis again"
            )
        path = self.root / session / "outputs" / identifier
        if any(
            part.is_symlink()
            for part in (self.root, path.parent.parent, path.parent, path)
        ):
            raise AgentError(404, "Generated file unavailable")
        return item, path

    def read(self, execution, identifier):
        item, path = self.registered(execution, identifier)
        if self.remote is not None:
            session = execution["analysis_result"]["session_id"]
            try:
                data = self.remote.read(
                    "artifacts/" + session + "/" + identifier, MAX_BYTES
                )
            except FileNotFoundError:
                raise AgentError(404, "Generated file unavailable") from None
            except StorageUnavailable:
                raise AgentError(503, "File storage unavailable") from None
        else:
            try:
                descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(descriptor, "rb") as source:
                    info = os.fstat(source.fileno())
                    if (
                        not stat.S_ISREG(info.st_mode)
                        or info.st_size != item["size_bytes"]
                        or info.st_size > MAX_BYTES
                    ):
                        raise AgentError(404, "Generated file unavailable")
                    data = source.read(MAX_BYTES + 1)
            except OSError:
                raise AgentError(404, "Generated file unavailable") from None
        if len(data) != item["size_bytes"] or (
            item.get("sha256") and hashlib.sha256(data).hexdigest() != item["sha256"]
        ):
            raise AgentError(404, "Generated file integrity check failed")
        if path.suffix == ".png":
            self.png_dimensions(data)
        return item, data, TYPES[path.suffix]

    @staticmethod
    def png_dimensions(data):
        if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
            raise AgentError(422, "Generated image is not a supported PNG")
        width, height = struct.unpack(">II", data[16:24])
        if (
            not width
            or not height
            or width > 10000
            or height > 10000
            or width * height > 24000000
        ):
            raise AgentError(422, "Generated image exceeds preview dimensions")
        return width, height

    def listing(self, execution):
        result = execution.get("analysis_result") or {}
        items = []
        for record in result.get("artifacts", []):
            item = {key: record[key] for key in ("id", "name", "size_bytes")}
            item["kind"] = record.get("kind", "generated")
            item["media_type"] = TYPES.get(
                Path(record["id"]).suffix, "application/octet-stream"
            )
            try:
                _, data, _ = self.read(execution, record["id"])
                item["availability"] = "available"
                if item["media_type"] == "image/png":
                    item["width"], item["height"] = self.png_dimensions(data)
            except AgentError as error:
                item["availability"] = (
                    "expired" if error.status == 410 else "unavailable"
                )
            items.append(item)
        return {
            "items": items,
            "expires_at": self.expiry(execution).isoformat(),
            "warnings": result.get("warnings", []),
            "status": execution["status"],
        }

    def preview(self, execution, identifier):
        _, data, media_type = self.read(execution, identifier)
        if media_type == "image/png":
            raise AgentError(422, "Use the image preview endpoint")
        if media_type == "text/csv":
            sample = data[: 256 * 1024].decode("utf-8-sig", errors="replace")
            if len(data) > 256 * 1024:
                sample = sample[: sample.rfind("\n") + 1]
            try:
                try:
                    dialect = csv.Sniffer().sniff(sample[:8192], delimiters=",;\t|")
                except csv.Error:
                    dialect = csv.excel
                reader = csv.reader(
                    io.StringIO(sample, newline=""), dialect, strict=True
                )
                headers = next(reader)
                rows = []
                cells_truncated = False
                for row in reader:
                    cells_truncated = (
                        cells_truncated
                        or len(row) > 20
                        or any(len(cell) > 200 for cell in row)
                    )
                    rows.append([cell[:200] for cell in row[:20]])
                    if len(rows) == 21:
                        break
            except (csv.Error, StopIteration):
                raise AgentError(
                    422, "This CSV cannot be previewed; download it to inspect"
                ) from None
            return {
                "kind": "table",
                "headers": [cell[:200] for cell in headers[:20]],
                "rows": rows[:20],
                "truncated": cells_truncated
                or len(data) > 256 * 1024
                or len(rows) > 20
                or len(headers) > 20
                or any(len(cell) > 200 for cell in headers),
            }
        text = data[:32768].decode("utf-8-sig", errors="replace")
        if media_type == "application/json" and len(data) <= 32768:
            try:
                text = json.dumps(json.loads(text), indent=2, ensure_ascii=False)
            except (ValueError, RecursionError):
                pass
        return {"kind": "text", "text": text, "truncated": len(data) > 32768}
