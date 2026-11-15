from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    """Immutable, extra-forbidding base schema for all Scriptoria bridge contracts."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=False,
        validate_default=True,
    )


class ErrorCode(str, Enum):
    """Canonical machine-readable error codes shared across Next.js and FastAPI."""

    VALIDATION_ERROR = "VALIDATION_ERROR"
    CONTRACT_MISMATCH = "CONTRACT_MISMATCH"
    VRAM_BUSY = "VRAM_BUSY"
    UPSTREAM_UNAVAILABLE = "UPSTREAM_UNAVAILABLE"
    UPSTREAM_TIMEOUT = "UPSTREAM_TIMEOUT"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ErrorStage(str, Enum):
    """Pipeline stage where a fault originated."""

    nextjs_proxy = "nextjs_proxy"
    fastapi_validation = "fastapi_validation"
    parser = "parser"
    vram_coordinator = "vram_coordinator"
    sqlite_fts = "sqlite_fts"


class ErrorDetail(StrictModel):
    """Structured field-level diagnostic without leaking sensitive raw payloads."""

    field: str | None = Field(default=None, description="Dot-separated field path.")
    message: str = Field(..., min_length=1)
    code: str | None = Field(default=None, description="Underlying validator or parser code.")
    input_type: str | None = Field(
        default=None,
        description="Sanitized Python/JSON type name of the rejected value.",
    )


class ApiErrorBody(StrictModel):
    """Canonical error payload nested inside ApiErrorEnvelope."""

    code: ErrorCode
    stage: ErrorStage
    message: str = Field(..., min_length=1)
    trace_id: str = Field(..., min_length=1)
    retryable: bool = False
    retry_after_ms: int | None = Field(default=None, ge=0)
    details: list[ErrorDetail] = Field(default_factory=list)


class ApiErrorEnvelope(StrictModel):
    """Unified wire error envelope guaranteed on 100% of bridge error responses."""

    ok: Literal[False] = False
    error: ApiErrorBody


class SpanRange(StrictModel):
    """Dual-index character span guaranteeing Python code point <-> JS UTF-16 parity."""

    codepoint_start: int = Field(..., ge=0)
    codepoint_end: int = Field(..., ge=0)
    utf16_start: int = Field(..., ge=0)
    utf16_end: int = Field(..., ge=0)

    @model_validator(mode="after")
    def _validate_monotonic_bounds(self) -> SpanRange:
        if self.codepoint_end < self.codepoint_start:
            raise ValueError(
                f"codepoint_end ({self.codepoint_end}) must be >= codepoint_start ({self.codepoint_start})"
            )
        if self.utf16_end < self.utf16_start:
            raise ValueError(
                f"utf16_end ({self.utf16_end}) must be >= utf16_start ({self.utf16_start})"
            )
        return self


def compute_utf16_span(text: str, cp_start: int, cp_end: int) -> SpanRange:
    """Convert Python Unicode code-point offsets [cp_start, cp_end) to JS UTF-16 code-unit offsets.

    Uses UTF-16 LE encoding (which omits the 2-byte BOM) so every BMP character counts
    as 1 code unit (2 bytes) and every astral character counts as 2 code units (4 bytes),
    matching JavaScript `String.prototype.length` and `.slice()` semantics exactly.
    """
    text_len = len(text)
    if cp_start < 0:
        raise ValueError(f"cp_start must be >= 0, got {cp_start}")
    if cp_end < cp_start:
        raise ValueError(f"cp_end ({cp_end}) must be >= cp_start ({cp_start})")
    if cp_end > text_len:
        raise ValueError(f"cp_end ({cp_end}) exceeds text length ({text_len})")

    prefix_utf16_bytes = text[:cp_start].encode("utf-16-le")
    slice_utf16_bytes = text[cp_start:cp_end].encode("utf-16-le")

    utf16_start = len(prefix_utf16_bytes) // 2
    utf16_end = utf16_start + (len(slice_utf16_bytes) // 2)

    return SpanRange(
        codepoint_start=cp_start,
        codepoint_end=cp_end,
        utf16_start=utf16_start,
        utf16_end=utf16_end,
    )


class DependencyStatus(str, Enum):
    """Operational status for subsystem health probes."""

    healthy = "healthy"
    degraded = "degraded"
    unavailable = "unavailable"


class DependencyHealth(StrictModel):
    """Health report for a single backend dependency."""

    name: str = Field(..., min_length=1)
    status: DependencyStatus
    latency_ms: float | None = Field(default=None, ge=0.0)
    detail: str | None = None
    checked_at: datetime


class SystemHealthResponse(StrictModel):
    """Aggregated backend readiness and subsystem status response."""

    ok: Literal[True] = True
    status: DependencyStatus
    service: str = "scriptoria-backend"
    version: str = Field(..., min_length=1)
    trace_id: str = Field(..., min_length=1)
    uptime_seconds: float = Field(..., ge=0.0)
    timestamp: datetime
    dependencies: dict[str, DependencyHealth] = Field(default_factory=dict)


class ContractLimits(StrictModel):
    """Enforced operational limits advertised by the FastAPI bridge."""

    max_payload_bytes: int = Field(..., gt=0)
    max_text_chars: int = Field(..., gt=0)
    max_chapters_per_document: int = Field(..., gt=0)
    request_timeout_ms: int = Field(..., gt=0)


class ContractManifestResponse(StrictModel):
    """Bridge handshake payload allowing Next.js to detect OpenAPI contract drift."""

    ok: Literal[True] = True
    contract_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    schema_version: str = Field(..., min_length=1)
    openapi_version: str = Field(..., min_length=1)
    trace_id: str = Field(..., min_length=1)
    limits: ContractLimits


PrimitiveValue = Union[str, int, float, bool]


class EchoValidateRequest(StrictModel):
    """Round-trip contract and Unicode span parity verification request."""

    text: str = Field(..., min_length=1, max_length=1_000_000)
    probe_cp_start: int | None = Field(default=None, ge=0)
    probe_cp_end: int | None = Field(default=None, ge=0)
    metadata: dict[str, PrimitiveValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_probe_bounds(self) -> EchoValidateRequest:
        has_start = self.probe_cp_start is not None
        has_end = self.probe_cp_end is not None
        if has_start != has_end:
            raise ValueError("probe_cp_start and probe_cp_end must both be provided together")
        if self.probe_cp_start is not None and self.probe_cp_end is not None:
            if self.probe_cp_end < self.probe_cp_start:
                raise ValueError("probe_cp_end must be >= probe_cp_start")
            if self.probe_cp_end > len(self.text):
                raise ValueError(
                    f"probe_cp_end ({self.probe_cp_end}) exceeds text codepoint length ({len(self.text)})"
                )
        return self


class EchoValidateResponse(StrictModel):
    """Round-trip validation response exposing exact UTF-8, code point, and UTF-16 lengths."""

    ok: Literal[True] = True
    trace_id: str = Field(..., min_length=1)
    echoed_text: str
    codepoint_length: int = Field(..., ge=0)
    utf16_length: int = Field(..., ge=0)
    utf8_byte_length: int = Field(..., ge=0)
    full_span: SpanRange
    probe_span: SpanRange | None = None
    metadata: dict[str, PrimitiveValue] = Field(default_factory=dict)


class DiagnosticSeverity(str, Enum):
    """Severity classification for deterministic parser diagnostics."""

    info = "info"
    warning = "warning"
    error = "error"


class ParseDiagnostic(StrictModel):
    """Non-fatal or structural diagnostic emitted during deterministic parsing."""

    code: str = Field(..., min_length=1)
    severity: DiagnosticSeverity
    message: str = Field(..., min_length=1)
    span: SpanRange | None = None
    line: int | None = Field(default=None, ge=1)
    column: int | None = Field(default=None, ge=1)


class DocumentNodeType(str, Enum):
    """Structural AST node kinds emitted by the deterministic parser."""

    document = "document"
    chapter = "chapter"
    scene = "scene"
    paragraph = "paragraph"
    scene_break = "scene_break"


class DocumentNode(StrictModel):
    """Hierarchical document AST node anchored with dual codepoint/UTF-16 spans."""

    node_id: str = Field(..., min_length=1)
    node_type: DocumentNodeType
    title: str | None = None
    order_index: int = Field(..., ge=0)
    span: SpanRange
    children: list[DocumentNode] = Field(default_factory=list)


class ParsedChunk(StrictModel):
    """Deterministic parser output unit ready for downstream indexing or extraction."""

    chunk_id: str = Field(..., min_length=1)
    chapter_index: int = Field(..., ge=0)
    scene_index: int = Field(..., ge=0)
    chunk_index: int = Field(..., ge=0)
    raw_text: str
    normalized_text: str
    span: SpanRange
    codepoint_length: int = Field(..., ge=0)
    utf16_length: int = Field(..., ge=0)
    sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")


class ParseInspectRequest(StrictModel):
    """Request payload for inspecting deterministic parser normalization and AST spans."""

    raw_text: str = Field(..., min_length=1, max_length=2_000_000)
    source_name: str = Field(default="untitled.md", min_length=1, max_length=255)
    normalize_ligatures: bool = True
    include_ast: bool = True
    include_chunks: bool = True


class ParseInspectResponse(StrictModel):
    """Full deterministic parser inspection payload for the Testbench UI."""

    ok: Literal[True] = True
    trace_id: str = Field(..., min_length=1)
    source_name: str = Field(..., min_length=1)
    normalized_markdown: str
    raw_codepoint_length: int = Field(..., ge=0)
    raw_utf16_length: int = Field(..., ge=0)
    normalized_codepoint_length: int = Field(..., ge=0)
    normalized_utf16_length: int = Field(..., ge=0)
    chapter_count: int = Field(..., ge=0)
    scene_count: int = Field(..., ge=0)
    document_tree: DocumentNode | None = None
    chunks: list[ParsedChunk] = Field(default_factory=list)
    diagnostics: list[ParseDiagnostic] = Field(default_factory=list)


DocumentNode.model_rebuild()

__all__ = [
    "ApiErrorBody",
    "ApiErrorEnvelope",
    "ContractLimits",
    "ContractManifestResponse",
    "DependencyHealth",
    "DependencyStatus",
    "DiagnosticSeverity",
    "DocumentNode",
    "DocumentNodeType",
    "EchoValidateRequest",
    "EchoValidateResponse",
    "ErrorCode",
    "ErrorDetail",
    "ErrorStage",
    "ParseDiagnostic",
    "ParseInspectRequest",
    "ParseInspectResponse",
    "ParsedChunk",
    "PrimitiveValue",
    "SpanRange",
    "StrictModel",
    "SystemHealthResponse",
    "compute_utf16_span",
]
