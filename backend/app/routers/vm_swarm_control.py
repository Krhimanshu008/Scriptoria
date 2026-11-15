from __future__ import annotations

import socket
import time
import uuid
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from app.schemas.extraction_contracts import (
    SwarmPortStatus,
    SwarmStatusResponse,
    SwarmTargetNodeStatus,
    VramEvictionState,
    VramLockMode,
    VramLockRequest,
)
from app.schemas.testbench_contracts import (
    ApiErrorBody,
    ApiErrorEnvelope,
    ErrorCode,
    ErrorDetail,
    ErrorStage,
)

router = APIRouter(prefix="/vm", tags=["vm-swarm"])

_VRAM_MUTEX = Lock()

_VRAM_RUNTIME_STATE: dict[str, Any] = {
    "active_mode": "IDLE",
    "lock_holder": None,
    "vram_allocated_mb": 0.0,
    "gpu_device_name": None,
    "lock_acquired_timestamp": None,
}

_SWARM_PORTS_CONFIG: dict[int, str] = {
    8190: "vm-worker-gpu0-primary",
    8191: "vm-worker-gpu1-auxiliary",
    8192: "vm-worker-tpu0-tensor",
    9999: "comfyui-diffusers-daemon",
}

_SWARM_TARGETS_CONFIG: dict[str, dict[str, Any]] = {
    "gpu0": {
        "accelerator_type": "GPU",
        "device_name": "NVIDIA RTX 4090 (24GB)",
        "port": 8190,
    },
    "gpu1": {
        "accelerator_type": "GPU",
        "device_name": "NVIDIA RTX 4090 (24GB)",
        "port": 8191,
    },
    "tpu0": {
        "accelerator_type": "TPU",
        "device_name": "Google Cloud TPU v4-8",
        "port": 8192,
    },
}

_MODE_VRAM_MB: dict[VramLockMode, float] = {
    "IDLE": 0.0,
    "EXTRACTION_SWARM": 14336.0,
    "IMAGE_GEN_COMFYUI": 21504.0,
}


def _resolve_trace_id(request: Request, response: Response | None = None) -> str:
    state_trace = getattr(request.state, "trace_id", None)
    header_trace = request.headers.get("x-trace-id") or request.headers.get(
        "X-Trace-ID"
    )
    trace_id = str(state_trace or header_trace or f"trc-{uuid.uuid4().hex[:16]}")
    if response is not None:
        response.headers["X-Trace-ID"] = trace_id
    return trace_id


def _detect_gpu_name() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return str(torch.cuda.get_device_name(0))
    except Exception:
        pass
    return "NVIDIA RTX 4090 (Dev Swarm Emulated)"


def _probe_tcp_port(
    host: str, port: int, timeout_sec: float = 0.05
) -> tuple[bool, float]:
    start = time.perf_counter()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout_sec)
    try:
        res = sock.connect_ex((host, port))
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        return (res == 0, round(elapsed_ms, 2))
    except Exception:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        return (False, round(elapsed_ms, 2))
    finally:
        sock.close()


def _build_vram_state(trace_id: str) -> VramEvictionState:
    device = _VRAM_RUNTIME_STATE["gpu_device_name"] or _detect_gpu_name()
    return VramEvictionState(
        ok=True,
        trace_id=trace_id,
        active_mode=_VRAM_RUNTIME_STATE["active_mode"],
        lock_holder=_VRAM_RUNTIME_STATE["lock_holder"],
        vram_allocated_mb=_VRAM_RUNTIME_STATE["vram_allocated_mb"],
        gpu_device_name=device,
        lock_acquired_timestamp=_VRAM_RUNTIME_STATE["lock_acquired_timestamp"],
    )


def reset_vram_state_for_tests() -> None:
    """Helper to reset VRAM coordinator state to IDLE."""
    with _VRAM_MUTEX:
        _VRAM_RUNTIME_STATE["active_mode"] = "IDLE"
        _VRAM_RUNTIME_STATE["lock_holder"] = None
        _VRAM_RUNTIME_STATE["vram_allocated_mb"] = 0.0
        _VRAM_RUNTIME_STATE["lock_acquired_timestamp"] = None


@router.get("/swarm/status", response_model=SwarmStatusResponse)
async def get_swarm_status(request: Request, response: Response) -> SwarmStatusResponse:
    trace_id = _resolve_trace_id(request, response)

    ports_report: dict[str, SwarmPortStatus] = {}
    port_reachability: dict[int, tuple[bool, float]] = {}

    for port, service_name in _SWARM_PORTS_CONFIG.items():
        is_open, latency_ms = _probe_tcp_port("127.0.0.1", port)
        port_reachability[port] = (is_open, latency_ms)
        ports_report[str(port)] = SwarmPortStatus(
            port=port,
            service=service_name,
            listening=is_open,
            mode="LIVE_SOCKET" if is_open else "SIMULATED_READY",
        )

    targets_report: dict[str, SwarmTargetNodeStatus] = {}
    for target_id, cfg in _SWARM_TARGETS_CONFIG.items():
        port = int(cfg["port"])
        is_open, latency_ms = port_reachability.get(port, (False, 0.1))
        targets_report[target_id] = SwarmTargetNodeStatus(
            target_id=target_id,
            accelerator_type=cfg["accelerator_type"],
            device_name=cfg["device_name"],
            port=port,
            reachable=True if is_open else False,
            status="ONLINE" if is_open else "STANDBY",
            latency_ms=latency_ms,
        )

    with _VRAM_MUTEX:
        vram_state = _build_vram_state(trace_id)

    return SwarmStatusResponse(
        ok=True,
        trace_id=trace_id,
        targets=targets_report,
        ports=ports_report,
        active_ports=list(_SWARM_PORTS_CONFIG.keys()),
        vram_state=vram_state,
    )


@router.post(
    "/vram/lock",
    response_model=VramEvictionState,
    responses={409: {"model": ApiErrorEnvelope}},
)
async def manage_vram_lock(
    payload: VramLockRequest,
    request: Request,
    response: Response,
) -> VramEvictionState | JSONResponse:
    trace_id = _resolve_trace_id(request, response)

    with _VRAM_MUTEX:
        current_mode: VramLockMode = _VRAM_RUNTIME_STATE["active_mode"]
        current_holder: str | None = _VRAM_RUNTIME_STATE["lock_holder"]

        # Case 1: Explicit release back to IDLE
        if payload.requested_mode == "IDLE":
            _VRAM_RUNTIME_STATE["active_mode"] = "IDLE"
            _VRAM_RUNTIME_STATE["lock_holder"] = None
            _VRAM_RUNTIME_STATE["vram_allocated_mb"] = 0.0
            _VRAM_RUNTIME_STATE["lock_acquired_timestamp"] = None
            return _build_vram_state(trace_id)

        # Case 2: VRAM already locked in a non-IDLE mode and force=False
        if current_mode != "IDLE" and not payload.force:
            error_envelope = ApiErrorEnvelope(
                ok=False,
                error=ApiErrorBody(
                    code=ErrorCode.VRAM_BUSY,
                    stage=ErrorStage.vram_coordinator,
                    message=(
                        f"VRAM lock conflict: currently locked in mode '{current_mode}' "
                        f"by '{current_holder}'. Cannot transition to '{payload.requested_mode}' "
                        f"with force=False."
                    ),
                    trace_id=trace_id,
                    retryable=True,
                    details=[
                        ErrorDetail(
                            field="active_mode",
                            message=f"Locked by {current_holder} in {current_mode}",
                            code="VRAM_LOCK_CONFLICT",
                        )
                    ],
                ),
            )
            return JSONResponse(
                status_code=409,
                content=error_envelope.model_dump(mode="json"),
                headers={"X-Trace-ID": trace_id},
            )

        # Case 3: Acquire lock or force-evict existing workload
        now_iso = datetime.now(timezone.utc).isoformat()
        _VRAM_RUNTIME_STATE["active_mode"] = payload.requested_mode
        _VRAM_RUNTIME_STATE["lock_holder"] = payload.client_id
        _VRAM_RUNTIME_STATE["vram_allocated_mb"] = _MODE_VRAM_MB.get(
            payload.requested_mode, 14336.0
        )
        _VRAM_RUNTIME_STATE["lock_acquired_timestamp"] = now_iso

        return _build_vram_state(trace_id)
