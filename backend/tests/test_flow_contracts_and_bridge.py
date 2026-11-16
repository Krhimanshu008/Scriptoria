import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.schemas.flow_contracts import (
    FlowAspectRatio,
    FlowCompanionStatus,
    FlowConnectionState,
    FlowGenerationTask,
    FlowIngredientCategory,
    FlowIngredientRef,
    FlowIngredientSync,
    FlowIngredientSyncItem,
    FlowMediaCandidate,
    FlowMediaResultEvent,
    FlowMediaType,
    FlowModelEngine,
    FlowQueueAction,
    FlowQueueActionType,
    FlowTaskStatus,
)


@pytest.fixture
def client():
    return TestClient(app)


def test_flow_companion_status_contract():
    status = FlowCompanionStatus()
    assert status.connection_state == FlowConnectionState.DISCONNECTED
    assert status.flow_project_id == "ea1ed436-e578-4327-9c9b-4f6b2e7e551d"
    assert status.queued_tasks_count == 0


def test_flow_ingredient_ref_sanitization():
    ref = FlowIngredientRef(
        ingredient_id="ing_1",
        mention_handle="@Detective_Kael",
        category=FlowIngredientCategory.CHARACTER,
    )
    assert ref.mention_handle == "Detective_Kael"

    with pytest.raises(ValidationError):
        FlowIngredientRef(ingredient_id="ing_2", mention_handle="  @   ")


def test_flow_media_result_event_validation():
    # Success requires candidate
    with pytest.raises(ValidationError):
        FlowMediaResultEvent(
            task_id="t1",
            project_id="p1",
            status="COMPLETED",
            prompt_used="test prompt",
            candidates=(),
        )

    # Success with candidate passes
    cand = FlowMediaCandidate(remote_url="https://lh3.googleusercontent.com/test.png")
    event = FlowMediaResultEvent(
        task_id="t1",
        project_id="p1",
        status="COMPLETED",
        prompt_used="test prompt",
        candidates=(cand,),
    )
    assert len(event.candidates) == 1

    # Failed status requires error message
    with pytest.raises(ValidationError):
        FlowMediaResultEvent(
            task_id="t2",
            project_id="p1",
            status="FAILED",
            prompt_used="failed prompt",
            error_message=None,
        )


def test_flow_queue_action_validation():
    with pytest.raises(ValidationError):
        FlowQueueAction(action=FlowQueueActionType.CANCEL_TASK, target_task_id=None)

    action = FlowQueueAction(action=FlowQueueActionType.CANCEL_TASK, target_task_id="task_123")
    assert action.target_task_id == "task_123"


def test_flow_bridge_status_endpoint(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    response = client.get("/api/v1/flow-bridge/status", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "connection_state" in data
    assert "flow_project_id" in data


def test_flow_bridge_task_queue_and_action(client):
    headers = {"X-Bridge-Secret": "scriptoria-local-dev-secret"}
    task_payload = {
        "project_id": "proj_demo",
        "flow_project_id": "ea1ed436-e578-4327-9c9b-4f6b2e7e551d",
        "prompt": "@Detective_Kael standing in rain in cyberpunk alley",
        "media_type": "IMAGE",
        "model_engine": "NANO_BANANA",
        "aspect_ratio": "16:9",
    }
    create_resp = client.post("/api/v1/flow-bridge/tasks", json=task_payload, headers=headers)
    assert create_resp.status_code == 202
    task_data = create_resp.json()
    assert task_data["status"] == "QUEUED"
    assert "task_id" in task_data

    # Cancel task action
    action_payload = {
        "action": "CANCEL_TASK",
        "target_task_id": task_data["task_id"],
    }
    action_resp = client.post("/api/v1/flow-bridge/queue/action", json=action_payload, headers=headers)
    assert action_resp.status_code == 200
    action_data = action_resp.json()
    assert "connection_state" in action_data
    assert action_data["queued_tasks_count"] == 0
