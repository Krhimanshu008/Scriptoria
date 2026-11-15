from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request

from app.middleware.bridge_guard import resolve_trace_id
from app.schemas.testbench_contracts import (
    ContractLimits,
    ContractManifestResponse,
    DependencyHealth,
    DependencyStatus,
    EchoValidateRequest,
    EchoValidateResponse,
    SystemHealthResponse,
    compute_utf16_span,
)

router = APIRouter(prefix="/testbench", tags=["testbench-system"])

_SERVICE_START_MONOTONIC = time.monotonic()
_DEFAULT_LIMITS = ContractLimits(
    max_payload_bytes=10_485_760,
    max_text_chars=2_000_000,
    max_chapters_per_document=1_000,
    request_timeout_ms=30_000,
)


def _compute_canonical_contract_hash(openapi_schema: dict[str, Any]) -> str:
    """Compute SHA-256 hash matching backend/scripts/export_contracts.py canonicalization."""
    canonical_bytes = json.dumps(
        openapi_schema,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(canonical_bytes).hexdigest()


def _probe_sqlite_fts5() -> DependencyHealth:
    """Verify SQLite query execution and FTS5 virtual table support."""
    started = time.perf_counter()
    checked_at = datetime.now(timezone.utc)
    db_path = os.getenv("SCRIPTORIA_SQLITE_PATH", "").strip()

    try:
        target = db_path if db_path and os.path.exists(db_path) else ":memory:"
        conn = sqlite3.connect(target, timeout=2.0)
        try:
            row = conn.execute("SELECT 1").fetchone()
            if row != (1,):
                raise RuntimeError("Unexpected SQLite SELECT 1 result")

            compile_opts = {
                opt[0] for opt in conn.execute("PRAGMA compile_options").fetchall()
            }
            fts5_enabled = "ENABLE_FTS5" in compile_opts
            if not fts5_enabled:
                # Fallback runtime check in an isolated in-memory connection
                mem_conn = sqlite3.connect(":memory:")
                try:
                    mem_conn.execute(
                        "CREATE VIRTUAL TABLE _probe_fts USING fts5(content)"
                    )
                    fts5_enabled = True
                finally:
                    mem_conn.close()
        finally:
            conn.close()

        latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
        mode = f"file:{db_path}" if target != ":memory:" else "memory"
        return DependencyHealth(
            name="sqlite_fts",
            status=DependencyStatus.healthy if fts5_enabled else DependencyStatus.degraded,
            latency_ms=latency_ms,
            detail=f"SQLite {sqlite3.sqlite_version} ({mode}), FTS5={'enabled' if fts5_enabled else 'missing'}",
            checked_at=checked_at,
        )
    except Exception as exc:
        latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
        return DependencyHealth(
            name="sqlite_fts",
            status=DependencyStatus.unavailable,
            latency_ms=latency_ms,
            detail=f"SQLite probe failed: {type(exc).__name__}",
            checked_at=checked_at,
        )


def _probe_vram_coordinator() -> DependencyHealth:
    """Probe CUDA/MPS GPU availability or report clean CPU/mock development state."""
    started = time.perf_counter()
    checked_at = datetime.now(timezone.utc)

    try:
        try:
            import torch  # type: ignore[import-not-found]
        except ImportError:
            latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
            return DependencyHealth(
                name="vram_coordinator",
                status=DependencyStatus.healthy,
                latency_ms=latency_ms,
                detail="CPU/mock development mode (torch not installed)",
                checked_at=checked_at,
            )

        if torch.cuda.is_available():
            device_index = torch.cuda.current_device()
            device_name = torch.cuda.get_device_name(device_index)
            free_bytes, total_bytes = torch.cuda.mem_get_info(device_index)
            free_gb = free_bytes / (1024**3)
            total_gb = total_bytes / (1024**3)
            latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
            return DependencyHealth(
                name="vram_coordinator",
                status=DependencyStatus.healthy,
                latency_ms=latency_ms,
                detail=f"CUDA ready on {device_name} ({free_gb:.2f}/{total_gb:.2f} GiB free)",
                checked_at=checked_at,
            )

        mps_backend = getattr(torch.backends, "mps", None)
        if mps_backend is not None and mps_backend.is_available():
            latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
            return DependencyHealth(
                name="vram_coordinator",
                status=DependencyStatus.healthy,
                latency_ms=latency_ms,
                detail="Apple MPS backend ready (unified memory)",
                checked_at=checked_at,
            )

        latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
        return DependencyHealth(
            name="vram_coordinator",
            status=DependencyStatus.healthy,
            latency_ms=latency_ms,
            detail="CPU/mock development mode (no GPU device detected)",
            checked_at=checked_at,
        )
    except Exception as exc:
        latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
        return DependencyHealth(
            name="vram_coordinator",
            status=DependencyStatus.degraded,
            latency_ms=latency_ms,
            detail=f"VRAM coordinator probe degraded: {type(exc).__name__}",
            checked_at=checked_at,
        )


@router.get("/health", response_model=SystemHealthResponse)
async def get_system_health(request: Request) -> SystemHealthResponse:
    """Return backend readiness, SQLite/FTS5 probe, and VRAM coordinator status."""
    trace_id = resolve_trace_id(request)
    now = datetime.now(timezone.utc)
    uptime_seconds = round(max(0.0, time.monotonic() - _SERVICE_START_MONOTONIC), 3)

    sqlite_health = _probe_sqlite_fts5()
    vram_health = _probe_vram_coordinator()
    dependencies = {
        "sqlite_fts": sqlite_health,
        "vram_coordinator": vram_health,
    }

    statuses = {dep.status for dep in dependencies.values()}
    if sqlite_health.status == DependencyStatus.unavailable:
        overall_status = DependencyStatus.unavailable
    elif DependencyStatus.unavailable in statuses or DependencyStatus.degraded in statuses:
        overall_status = DependencyStatus.degraded
    else:
        overall_status = DependencyStatus.healthy

    return SystemHealthResponse(
        status=overall_status,
        service="scriptoria-backend",
        version=str(getattr(request.app, "version", "1.0.0") or "1.0.0"),
        trace_id=trace_id,
        uptime_seconds=uptime_seconds,
        timestamp=now,
        dependencies=dependencies,
    )


@router.get("/contracts", response_model=ContractManifestResponse)
async def get_contract_manifest(request: Request) -> ContractManifestResponse:
    """Expose live OpenAPI SHA-256 contract hash and operational bridge limits."""
    trace_id = resolve_trace_id(request)
    openapi_schema = request.app.openapi()
    contract_hash = _compute_canonical_contract_hash(openapi_schema)
    openapi_version = str(openapi_schema.get("openapi") or "3.1.0")

    return ContractManifestResponse(
        contract_hash=contract_hash,
        schema_version="1.0.0",
        openapi_version=openapi_version,
        trace_id=trace_id,
        limits=_DEFAULT_LIMITS,
    )


@router.post("/echo-validate", response_model=EchoValidateResponse)
async def echo_validate(
    req: EchoValidateRequest,
    request: Request,
) -> EchoValidateResponse:
    """Verify round-trip schema validation and Python codepoint <-> JS UTF-16 span parity."""
    trace_id = resolve_trace_id(request)
    codepoint_length = len(req.text)
    full_span = compute_utf16_span(req.text, 0, codepoint_length)
    utf16_length = full_span.utf16_end
    utf8_byte_length = len(req.text.encode("utf-8"))

    probe_span = (
        compute_utf16_span(req.text, req.probe_cp_start, req.probe_cp_end)
        if req.probe_cp_start is not None and req.probe_cp_end is not None
        else None
    )

    return EchoValidateResponse(
        trace_id=trace_id,
        echoed_text=req.text,
        codepoint_length=codepoint_length,
        utf16_length=utf16_length,
        utf8_byte_length=utf8_byte_length,
        full_span=full_span,
        probe_span=probe_span,
        metadata=req.metadata,
    )
