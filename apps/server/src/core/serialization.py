"""JSON normalization for persisted snapshots and stable evidence hashes."""

import json


def compact(value):
    return json.dumps(
        value, default=str, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def json_value(value):
    return json.loads(json.dumps(value, default=str, allow_nan=False))
