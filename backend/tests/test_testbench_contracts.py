from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.testbench_contracts import (
    ApiErrorBody,
    ApiErrorEnvelope,
    ErrorCode,
    ErrorDetail,
    ErrorStage,
    SpanRange,
    StrictModel,
    compute_utf16_span,
)


class SampleContract(StrictModel):
    title: str
    count: int


def test_strict_model_forbids_extra_fields():
    with pytest.raises(ValidationError) as exc_info:
        SampleContract.model_validate({"title": "Test", "count": 1, "extra_field": "disallowed"})
    errors = exc_info.value.errors()
    assert any(e["type"] == "extra_forbidden" for e in errors)


def test_strict_model_is_frozen():
    model = SampleContract(title="Test", count=1)
    with pytest.raises(ValidationError):
        model.title = "Modified"  # type: ignore


def test_compute_utf16_span_ascii():
    text = "Hello world"
    span = compute_utf16_span(text, 0, 5)
    assert span.codepoint_start == 0
    assert span.codepoint_end == 5
    assert span.utf16_start == 0
    assert span.utf16_end == 5


def test_compute_utf16_span_astral_emoji_parity():
    # '🚀' (U+1F680) is 1 Unicode code point, but 2 UTF-16 code units (surrogate pair)
    text = "A🚀B"
    # Python code point indices:
    # 0: 'A'
    # 1: '🚀'
    # 2: 'B'
    assert len(text) == 3

    # UTF-16 length in JavaScript:
    # 'A' = 1 unit (offset 0..1)
    # '🚀' = 2 units (offset 1..3)
    # 'B' = 1 unit (offset 3..4)
    # Total UTF-16 code units = 4

    span_b = compute_utf16_span(text, 2, 3)
    assert span_b.codepoint_start == 2
    assert span_b.codepoint_end == 3
    assert span_b.utf16_start == 3
    assert span_b.utf16_end == 4


def test_compute_utf16_span_boundary_checks():
    text = "Short text"
    with pytest.raises(ValueError, match="cp_start must be >= 0"):
        compute_utf16_span(text, -1, 5)

    with pytest.raises(ValueError, match="must be >= cp_start"):
        compute_utf16_span(text, 5, 2)

    with pytest.raises(ValueError, match="exceeds text length"):
        compute_utf16_span(text, 0, 100)


def test_api_error_envelope_structure():
    envelope = ApiErrorEnvelope(
        error=ApiErrorBody(
            code=ErrorCode.VALIDATION_ERROR,
            stage=ErrorStage.fastapi_validation,
            message="Field required",
            trace_id="trace_test_123",
            retryable=False,
            details=[
                ErrorDetail(field="title", message="Field required", code="missing")
            ],
        )
    )
    dumped = envelope.model_dump(mode="json")
    assert dumped["ok"] is False
    assert dumped["error"]["code"] == "VALIDATION_ERROR"
    assert dumped["error"]["trace_id"] == "trace_test_123"
    assert len(dumped["error"]["details"]) == 1
