from __future__ import annotations

from typing import Any, Literal
from pydantic import Field

from app.schemas.testbench_contracts import StrictModel

# ============================================================================
# Sprint 5: E2E Pipeline Stepper & QA Scorecard Contracts
# ============================================================================

class EdgeCaseCheckResult(StrictModel):
    id: str = Field(..., description="Edge case identifier, e.g. EC-0.1")
    name: str
    stage: str
    status: Literal["PASS", "WARN", "FAIL"]
    score: str
    description: str
    evidence: str
    latency_ms: float


class ScorecardResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    book_id: str
    total_checks: int
    passed_checks: int
    warn_checks: int
    failed_checks: int
    overall_score_percent: float
    overall_status: Literal["PASSED", "WARNING", "FAILED"]
    checks: list[EdgeCaseCheckResult]
    evaluated_at_utc: str


class PipelineStageStatus(StrictModel):
    stage_num: int = Field(..., ge=1, le=5)
    stage_name: str
    status: Literal["PENDING", "RUNNING", "COMPLETED", "FAILED"]
    message: str
    duration_ms: float
    output_summary: dict[str, Any] = Field(default_factory=dict)


class E2EPipelineRunRequest(StrictModel):
    book_id: str = Field(default="book-demo", min_length=1)
    force_reparse: bool = True
    force_reextract: bool = True
    force_recompile: bool = True
    force_repackage: bool = True


class E2EPipelineRunResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    book_id: str
    total_duration_sec: float
    stages: list[PipelineStageStatus]
    scorecard: ScorecardResponse
