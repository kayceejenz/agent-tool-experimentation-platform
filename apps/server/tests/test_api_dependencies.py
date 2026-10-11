from types import SimpleNamespace
from uuid import uuid4

from api.dependencies import agents, current_user, evaluations
from api.main import create_app
from core.settings import Settings
from fastapi.testclient import TestClient


def test_controller_dependencies_can_be_overridden_without_database_access():
    app = create_app(Settings(_env_file=None))
    user_id, project_id, agent_id, execution_id = [uuid4() for _ in range(4)]
    calls = []

    class Agents:
        async def get(self, user, project, agent):
            calls.append(("agent", user, project, agent))
            return {"id": str(agent)}

    class Evaluations:
        async def list(self, user, project, execution, offset):
            calls.append(("evaluation", user, project, execution, offset))
            return {"items": [], "next_offset": None}

    app.dependency_overrides[current_user] = lambda: SimpleNamespace(id=user_id)
    app.dependency_overrides[agents] = lambda: Agents()
    app.dependency_overrides[evaluations] = lambda: Evaluations()
    with TestClient(app) as client:
        response = client.get(f"/api/v1/projects/{project_id}/agents/{agent_id}")
        assert response.status_code == 200 and response.json() == {"id": str(agent_id)}
        response = client.get(
            f"/api/v1/projects/{project_id}/executions/{execution_id}/evaluations?offset=20"
        )
        assert response.status_code == 200 and response.json()["items"] == []
    assert calls == [
        ("agent", user_id, project_id, agent_id),
        ("evaluation", user_id, project_id, execution_id, 20),
    ]
