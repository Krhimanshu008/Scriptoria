from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.schemas.scorecard_contracts import (
    E2EPipelineRunRequest,
    E2EPipelineRunResponse,
    EdgeCaseCheckResult,
    ScorecardResponse,
)

AUTH_HEADERS = {
    "X-Trace-ID": "test-trace-scorecard-555",
    "X-Bridge-Secret": "dev-bridge-secret-change-me",
}

client = TestClient(app)


def test_scorecard_contracts_strictness():
    """Verify scorecard models forbid extra fields and enforce types."""
    with pytest.raises(ValidationError):
        E2EPipelineRunRequest.model_validate({
            "book_id": "book-demo",
            "forbidden_extra": True,
        })

    with pytest.raises(ValidationError):
        EdgeCaseCheckResult.model_validate({
            "id": "EC-0.1",
            "name": "Test",
            "stage": "Plumbing",
            "status": "INVALID_STATUS",
            "score": "100%",
            "description": "desc",
            "evidence": "ev",
            "latency_ms": 1.0,
        })


def test_get_scorecard_all_15_invariants():
    """EC-0.1 to EC-4.4: Verify all 15 edge case invariants are evaluated and return PASS."""
    resp = client.get("/api/v1/scorecard/book-demo", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    data = resp.json()

    assert data["ok"] is True
    assert data["total_checks"] == 15
    assert data["passed_checks"] == 15
    assert data["failed_checks"] == 0
    assert data["overall_status"] == "PASSED"
    assert data["overall_score_percent"] == 100.0

    # Ensure all expected edge case IDs are present in order
    expected_ids = [
        "EC-0.1", "EC-0.2", "EC-1.1", "EC-1.2", "EC-2.1", "EC-2.2",
        "EC-2.3", "EC-2.4", "EC-3.1", "EC-3.2", "EC-3.3", "EC-4.1",
        "EC-4.2", "EC-4.3", "EC-4.4",
    ]
    actual_ids = [c["id"] for c in data["checks"]]
    assert actual_ids == expected_ids

    for check in data["checks"]:
        assert check["status"] == "PASS"
        assert len(check["evidence"]) > 10
        assert check["latency_ms"] >= 0


def test_e2e_pipeline_run_5_stages():
    """Task D5.2: Verify full 5-stage sequential E2E pipeline stepper runs to completion."""
    resp = client.post(
        "/api/v1/scorecard/e2e-run",
        headers=AUTH_HEADERS,
        json={"book_id": "book-demo", "force_reparse": True},
    )
    assert resp.status_code == 200
    data = resp.json()

    assert data["ok"] is True
    assert data["book_id"] == "book-demo"
    assert data["total_duration_sec"] > 0
    assert len(data["stages"]) == 5

    stage_names = [s["stage_name"] for s in data["stages"]]
    assert any("Parser" in name for name in stage_names)
    assert any("Extraction" in name for name in stage_names)
    assert any("Compiler" in name for name in stage_names)
    assert any("RAG" in name for name in stage_names)
    assert any("Scorecard" in name or "Invariant" in name for name in stage_names)

    for stage in data["stages"]:
        assert stage["status"] == "COMPLETED"
        assert stage["duration_ms"] > 0

    assert data["scorecard"]["overall_status"] == "PASSED"
    assert data["scorecard"]["passed_checks"] == 15
