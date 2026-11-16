# backend/app/routers/flow_bridge.py
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import mimetypes
import re
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from app.schemas.flow_contracts import (
    FlowCompanionStatus,
    FlowConnectionState,
    FlowGenerationTask,
    FlowIngredientSync,
    FlowMediaCandidate,
    FlowMediaResultEvent,
    FlowMediaType,
    FlowQueueAction,
    FlowQueueActionType,
    FlowSavedAssetRecord,
    FlowTaskStatus,
    FlowWsEnvelope,
    utc_now_iso,
)

logger = logging.getLogger("scriptoria.flow_bridge")

router = APIRouter(prefix="/api/v1/flow-bridge", tags=["Google AI Flow Bridge"])

OUTPUT_BASE_DIR = Path("output/flow_assets")
STALE_HEARTBEAT_SECONDS = 30.0


def _sanitize_path_segment(value: str) -> str:
    """Prevent path traversal by restricting project/asset segments to safe characters."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", value.strip())
    return cleaned or "default_project"


def _extension_for_mime(mime_type: str, media_type: FlowMediaType) -> str:
    mime_clean = (mime_type or "").split(";")[0].strip().lower()
    explicit_map = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
    }
    if mime_clean in explicit_map:
        return explicit_map[mime_clean]
    guessed = mimetypes.guess_extension(mime_clean)
    if guessed:
        return guessed
    return ".mp4" if media_type == FlowMediaType.VIDEO else ".png"


class FlowBridgeOrchestrator:
    """
    Stateful manager for the Chrome Companion WebSocket session, task queue,
    reconnection recovery, and asynchronous streaming media persistence.
    """

    def __init__(self, output_root: Path = OUTPUT_BASE_DIR) -> None:
        self.output_root = output_root
        self.output_root.mkdir(parents=True, exist_ok=True)

        self._lock = asyncio.Lock()
        self._active_ws: WebSocket | None = None
        self._companion_status: FlowCompanionStatus = FlowCompanionStatus()
        self._queue_paused: bool = False

        # Pending queue and task state maps
        self._pending_queue: deque[FlowGenerationTask] = deque()
        self._in_flight_task: FlowGenerationTask | None = None
        self._completed_results: dict[str, FlowMediaResultEvent] = {}
        self._failed_tasks: dict[str, FlowGenerationTask] = {}
        self._recent_events: deque[FlowMediaResultEvent] = deque(maxlen=100)

    # ==========================================================================
    # WebSocket Connection Lifecycle & Reconnection Recovery
    # ==========================================================================
    async def connect_companion(
        self,
        websocket: WebSocket,
        session_id: str,
        flow_project_id: str,
    ) -> None:
        await websocket.accept()
        async with self._lock:
            self._active_ws = websocket
            self._companion_status = self._companion_status.model_copy(
                update={
                    "session_id": session_id,
                    "connection_state": (
                        FlowConnectionState.PAUSED
                        if self._queue_paused
                        else FlowConnectionState.IDLE
                    ),
                    "flow_project_id": flow_project_id,
                    "queued_tasks_count": len(self._pending_queue),
                    "completed_tasks_count": len(self._completed_results),
                    "failed_tasks_count": len(self._failed_tasks),
                    "last_heartbeat_at": utc_now_iso(),
                }
            )
            logger.info(
                "Chrome Flow Companion connected: session=%s flow_project=%s",
                session_id,
                flow_project_id,
            )

        # If a task was interrupted when the browser tab refreshed, re-queue it at the front
        async with self._lock:
            if self._in_flight_task is not None and self._in_flight_task.retry_count < 2:
                recovered = self._in_flight_task.model_copy(
                    update={
                        "status": FlowTaskStatus.QUEUED,
                        "retry_count": self._in_flight_task.retry_count + 1,
                    }
                )
                self._pending_queue.appendleft(recovered)
                self._in_flight_task = None
                logger.info(
                    "Recovered interrupted in-flight task %s for re-dispatch",
                    recovered.task_id,
                )

        await self._try_dispatch_next()

    async def disconnect_companion(self, websocket: WebSocket) -> None:
        async with self._lock:
            if self._active_ws is websocket:
                self._active_ws = None
                self._companion_status = self._companion_status.model_copy(
                    update={
                        "connection_state": FlowConnectionState.DISCONNECTED,
                        "last_heartbeat_at": utc_now_iso(),
                    }
                )
                logger.warning("Chrome Flow Companion WebSocket disconnected.")

    async def update_companion_status(self, payload: dict[str, Any]) -> FlowCompanionStatus:
        async with self._lock:
            merged = {
                **self._companion_status.model_dump(),
                **payload,
                "queued_tasks_count": len(self._pending_queue),
                "completed_tasks_count": len(self._completed_results),
                "failed_tasks_count": len(self._failed_tasks),
                "last_heartbeat_at": utc_now_iso(),
            }
            if self._queue_paused:
                merged["connection_state"] = FlowConnectionState.PAUSED
            self._companion_status = FlowCompanionStatus.model_validate(merged)
            return self._companion_status

    async def get_status(self) -> FlowCompanionStatus:
        async with self._lock:
            # Check for stale heartbeat if socket appears open
            if (
                self._active_ws is not None
                and self._companion_status.connection_state != FlowConnectionState.DISCONNECTED
            ):
                try:
                    last_dt = datetime.fromisoformat(self._companion_status.last_heartbeat_at)
                    elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
                    if elapsed > STALE_HEARTBEAT_SECONDS:
                        self._companion_status = self._companion_status.model_copy(
                            update={"connection_state": FlowConnectionState.DISCONNECTED}
                        )
                except ValueError:
                    pass

            return self._companion_status.model_copy(
                update={
                    "queued_tasks_count": len(self._pending_queue),
                    "completed_tasks_count": len(self._completed_results),
                    "failed_tasks_count": len(self._failed_tasks),
                    "active_task_id": (
                        self._in_flight_task.task_id if self._in_flight_task else None
                    ),
                }
            )

    # ==========================================================================
    # Task Queue & Dispatch Orchestration
    # ==========================================================================
    async def enqueue_task(self, task: FlowGenerationTask) -> FlowGenerationTask:
        async with self._lock:
            queued_task = task.model_copy(update={"status": FlowTaskStatus.QUEUED})
            self._pending_queue.append(queued_task)
            # Sort deque by priority (1 = highest priority)
            sorted_tasks = sorted(self._pending_queue, key=lambda t: t.priority)
            self._pending_queue = deque(sorted_tasks)

        await self._try_dispatch_next()
        return queued_task

    async def _try_dispatch_next(self) -> None:
        async with self._lock:
            if (
                self._queue_paused
                or self._active_ws is None
                or self._in_flight_task is not None
                or not self._pending_queue
            ):
                return

            next_task = self._pending_queue.popleft()
            dispatched_task = next_task.model_copy(
                update={"status": FlowTaskStatus.DISPATCHED}
            )
            self._in_flight_task = dispatched_task
            ws = self._active_ws

        envelope = FlowWsEnvelope(
            event_type="DISPATCH_TASK",
            correlation_id=dispatched_task.task_id,
            payload=dispatched_task.model_dump(),
        )
        try:
            await ws.send_json(envelope.model_dump())
            logger.info("Dispatched FlowGenerationTask %s to Companion", dispatched_task.task_id)
        except Exception as exc:
            logger.error("Failed to dispatch task %s over WS: %s", dispatched_task.task_id, exc)
            async with self._lock:
                self._pending_queue.appendleft(
                    dispatched_task.model_copy(update={"status": FlowTaskStatus.QUEUED})
                )
                self._in_flight_task = None

    async def sync_ingredients(self, sync_req: FlowIngredientSync) -> dict[str, Any]:
        async with self._lock:
            ws = self._active_ws
        if ws is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google Flow Chrome Companion is not currently connected.",
            )

        envelope = FlowWsEnvelope(
            event_type="INGREDIENT_SYNC",
            correlation_id=sync_req.sync_id,
            payload=sync_req.model_dump(),
        )
        await ws.send_json(envelope.model_dump())
        return {
            "sync_id": sync_req.sync_id,
            "status": "DISPATCHED_TO_COMPANION",
            "ingredients_count": len(sync_req.ingredients),
        }

    async def execute_queue_action(self, action_req: FlowQueueAction) -> FlowCompanionStatus:
        ws_to_notify: WebSocket | None = None

        async with self._lock:
            act = action_req.action
            if act == FlowQueueActionType.PAUSE:
                self._queue_paused = True
            elif act == FlowQueueActionType.RESUME:
                self._queue_paused = False
            elif act == FlowQueueActionType.FLUSH_ALL:
                self._pending_queue.clear()
            elif act == FlowQueueActionType.CLEAR_FAILED:
                self._failed_tasks.clear()
            elif act == FlowQueueActionType.CANCEL_TASK:
                target_id = action_req.target_task_id
                self._pending_queue = deque(
                    t for t in self._pending_queue if t.task_id != target_id
                )
                if self._in_flight_task and self._in_flight_task.task_id == target_id:
                    ws_to_notify = self._active_ws
            elif act == FlowQueueActionType.RETRY_TASK:
                target_id = action_req.target_task_id
                if target_id and target_id in self._failed_tasks:
                    failed_task = self._failed_tasks.pop(target_id)
                    retried = failed_task.model_copy(
                        update={
                            "status": FlowTaskStatus.QUEUED,
                            "retry_count": min(failed_task.retry_count + 1, 5),
                        }
                    )
                    self._pending_queue.appendleft(retried)
            elif act == FlowQueueActionType.PING_COMPANION:
                ws_to_notify = self._active_ws

        if ws_to_notify is not None:
            envelope = FlowWsEnvelope(
                event_type="QUEUE_ACTION",
                correlation_id=action_req.action_id,
                payload=action_req.model_dump(),
            )
            try:
                await ws_to_notify.send_json(envelope.model_dump())
            except Exception:
                pass

        if not self._queue_paused:
            await self._try_dispatch_next()

        return await self.get_status()

    # ==========================================================================
    # Asynchronous Media Streaming & Atomic Disk Persistence
    # ==========================================================================
    async def handle_media_result(self, raw_payload: dict[str, Any]) -> FlowMediaResultEvent:
        event = FlowMediaResultEvent.model_validate(raw_payload)
        saved_records: list[FlowSavedAssetRecord] = []

        if event.status == "COMPLETED":
            for candidate in event.candidates:
                try:
                    record = await self._download_and_persist_candidate(
                        project_id=event.project_id,
                        task_id=event.task_id,
                        media_type=event.media_type,
                        candidate=candidate,
                        metadata_context=event,
                    )
                    saved_records.append(record)
                except Exception as exc:
                    logger.error(
                        "Failed to download candidate %s for task %s: %s",
                        candidate.candidate_index,
                        event.task_id,
                        exc,
                    )

        enriched_event = event.model_copy(update={"saved_assets": tuple(saved_records)})

        async with self._lock:
            if (
                self._in_flight_task is not None
                and self._in_flight_task.task_id == enriched_event.task_id
            ):
                if enriched_event.status == "FAILED":
                    self._failed_tasks[enriched_event.task_id] = self._in_flight_task.model_copy(
                        update={"status": FlowTaskStatus.FAILED}
                    )
                self._in_flight_task = None

            if enriched_event.status == "COMPLETED":
                self._completed_results[enriched_event.task_id] = enriched_event

            self._recent_events.appendleft(enriched_event)

        await self._try_dispatch_next()
        return enriched_event

    async def _download_and_persist_candidate(
        self,
        project_id: str,
        task_id: str,
        media_type: FlowMediaType,
        candidate: FlowMediaCandidate,
        metadata_context: FlowMediaResultEvent,
    ) -> FlowSavedAssetRecord:
        safe_project = _sanitize_path_segment(project_id)
        safe_task = _sanitize_path_segment(task_id)
        ext = _extension_for_mime(candidate.mime_type, media_type)

        project_dir = self.output_root / safe_project
        project_dir.mkdir(parents=True, exist_ok=True)

        timestamp_slug = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp_slug}_{safe_task}_c{candidate.candidate_index}{ext}"
        final_path = project_dir / filename
        part_path = project_dir / f".{filename}.{uuid4().hex[:8]}.part"

        hasher = hashlib.sha256()
        total_bytes = 0

        # Strategy 1: If companion already captured Base64 in-browser (cookie/blob safe), decode it
        if candidate.base64_data:
            raw_b64 = candidate.base64_data
            if "," in raw_b64 and raw_b64.startswith("data:"):
                raw_b64 = raw_b64.split(",", 1)[1]
            decoded_bytes = base64.b64decode(raw_b64)
            hasher.update(decoded_bytes)
            total_bytes = len(decoded_bytes)
            await asyncio.to_thread(part_path.write_bytes, decoded_bytes)
        else:
            # Strategy 2: Stream directly from *.googleusercontent.com / storage.googleapis.com
            if not candidate.remote_url.startswith(("http://", "https://")):
                raise ValueError(
                    f"Unsupported non-HTTP URL without base64 fallback: {candidate.remote_url}"
                )

            timeout = httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=15.0)
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                ),
                "Referer": "https://flow.google.com/",
            }
            async with httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=True,
                headers=headers,
            ) as client:
                async with client.stream("GET", candidate.remote_url) as response:
                    response.raise_for_status()
                    with part_path.open("wb") as file_handle:
                        async for chunk in response.aiter_bytes(chunk_size=65_536):
                            if chunk:
                                file_handle.write(chunk)
                                hasher.update(chunk)
                                total_bytes += len(chunk)

        part_path.replace(final_path)
        sha256_hex = hasher.hexdigest()
        relative_path = final_path.relative_to(self.output_root.parent).as_posix()

        # Write JSON metadata sidecar
        sidecar_path = final_path.with_suffix(f"{final_path.suffix}.meta.json")
        sidecar_payload = {
            "task_id": task_id,
            "project_id": project_id,
            "flow_project_id": metadata_context.flow_project_id,
            "scene_id": metadata_context.scene_id,
            "character_profile_id": metadata_context.character_profile_id,
            "beat_id": metadata_context.beat_id,
            "prompt_used": metadata_context.prompt_used,
            "model_engine": metadata_context.model_engine,
            "media_type": media_type,
            "candidate_index": candidate.candidate_index,
            "source_remote_url": candidate.remote_url,
            "sha256_hash": sha256_hex,
            "file_size_bytes": total_bytes,
            "mime_type": candidate.mime_type,
            "saved_at": utc_now_iso(),
        }
        await asyncio.to_thread(
            sidecar_path.write_text,
            json.dumps(sidecar_payload, indent=2),
            "utf-8",
        )

        logger.info(
            "Saved Flow asset: %s (%d bytes, sha256=%s...)",
            final_path,
            total_bytes,
            sha256_hex[:12],
        )

        return FlowSavedAssetRecord(
            candidate_index=candidate.candidate_index,
            local_relative_path=relative_path,
            local_absolute_path=str(final_path.resolve()),
            sha256_hash=sha256_hex,
            file_size_bytes=total_bytes,
            mime_type=candidate.mime_type,
            source_remote_url=candidate.remote_url,
        )


# Singleton orchestrator instance
flow_orchestrator = FlowBridgeOrchestrator()


# ==============================================================================
# WebSocket Endpoint: /api/v1/flow-bridge/ws
# ==============================================================================
@router.websocket("/ws")
async def flow_companion_websocket(
    websocket: WebSocket,
    session_id: str = Query(default_factory=lambda: str(uuid4())),
    flow_project_id: str = Query(default="ea1ed436-e578-4327-9c9b-4f6b2e7e551d"),
) -> None:
    await flow_orchestrator.connect_companion(
        websocket=websocket,
        session_id=session_id,
        flow_project_id=flow_project_id,
    )
    try:
        while True:
            raw_message = await websocket.receive_json()
            envelope = FlowWsEnvelope.model_validate(raw_message)

            if envelope.event_type in {
                "COMPANION_HELLO",
                "COMPANION_HEARTBEAT",
                "COMPANION_STATUS",
            }:
                updated_status = await flow_orchestrator.update_companion_status(
                    envelope.payload
                )
                ack = FlowWsEnvelope(
                    event_type="BRIDGE_ACK",
                    correlation_id=envelope.envelope_id,
                    payload={"status": updated_status.connection_state},
                )
                await websocket.send_json(ack.model_dump())

            elif envelope.event_type == "MEDIA_RESULT":
                saved_event = await flow_orchestrator.handle_media_result(
                    envelope.payload
                )
                ack = FlowWsEnvelope(
                    event_type="BRIDGE_ACK",
                    correlation_id=saved_event.task_id,
                    payload={
                        "task_id": saved_event.task_id,
                        "saved_count": len(saved_event.saved_assets),
                        "saved_assets": [a.model_dump() for a in saved_event.saved_assets],
                    },
                )
                await websocket.send_json(ack.model_dump())

            elif envelope.event_type in {"TASK_PROGRESS", "INGREDIENT_SYNC_ACK"}:
                ack = FlowWsEnvelope(
                    event_type="BRIDGE_ACK",
                    correlation_id=envelope.correlation_id or envelope.envelope_id,
                    payload={"received": envelope.event_type},
                )
                await websocket.send_json(ack.model_dump())

    except WebSocketDisconnect:
        await flow_orchestrator.disconnect_companion(websocket)
    except Exception as exc:
        logger.exception("Unexpected error in Flow Companion WebSocket session: %s", exc)
        await flow_orchestrator.disconnect_companion(websocket)


# ==============================================================================
# REST Endpoints for Next.js Frontend & Internal Services
# ==============================================================================
@router.get("/status", response_model=FlowCompanionStatus)
async def get_companion_status() -> FlowCompanionStatus:
    """Return real-time connection state, active project binding, and queue telemetry."""
    return await flow_orchestrator.get_status()


@router.post("/tasks", response_model=FlowGenerationTask, status_code=status.HTTP_202_ACCEPTED)
async def dispatch_generation_task(task: FlowGenerationTask) -> FlowGenerationTask:
    """Enqueue a generation task and immediately dispatch if the Chrome Companion is online."""
    return await flow_orchestrator.enqueue_task(task)


@router.post("/ingredients/sync")
async def sync_project_ingredients(sync_req: FlowIngredientSync) -> dict[str, Any]:
    """Push or reconcile @ingredient handles with the active Google Flow browser session."""
    return await flow_orchestrator.sync_ingredients(sync_req)


@router.post("/queue/action", response_model=FlowCompanionStatus)
async def control_task_queue(action_req: FlowQueueAction) -> FlowCompanionStatus:
    """Pause, resume, retry, cancel, or flush tasks in the Flow Bridge queue."""
    return await flow_orchestrator.execute_queue_action(action_req)


@router.get("/events/recent", response_model=list[FlowMediaResultEvent])
async def list_recent_media_events() -> list[FlowMediaResultEvent]:
    """Return the most recent captured media events and their local disk paths."""
    return list(flow_orchestrator._recent_events)
