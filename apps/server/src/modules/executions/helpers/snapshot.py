"""Pin and redact an agent configuration without changing schema property names."""

import json

from core.serialization import json_value
from integrations.agents.runtime_messages import runtime_instructions

from modules.evaluations.helpers.rubric import profile_snapshot
from modules.tools.helpers.validation import redact, redact_text


def execution_snapshot(detail: dict, expectations: dict | None, secrets=None) -> dict:
    snapshot = json_value(detail)
    snapshot["evaluation_profile"] = profile_snapshot(detail)
    snapshot.pop("evaluation_prompt", None)
    snapshot["runtime_instructions"] = redact(runtime_instructions(snapshot), secrets)
    snapshot["expectations"] = redact(json_value(expectations), secrets)
    for key in ("system_prompt", "agent_prompt", "name", "description"):
        snapshot[key] = redact(snapshot[key], secrets)
    snapshot["evaluation_profile"]["instructions"] = redact(
        snapshot["evaluation_profile"]["instructions"], secrets
    )
    # Preserve schema keys such as "token" while removing credential values.
    if secrets:
        snapshot["tools"] = json.loads(
            redact_text(json.dumps(snapshot["tools"]), secrets)
        )
    return snapshot
