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
    FlowAudioGenerateRequest,
    FlowAudioResultEvent,
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
from app.services.flow_av_pipeline import (
    FlowAVMuxRequest,
    FlowAVMuxResult,
    execute_chapter_av_assembly,
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
        self._cached_chapter_package: dict[str, Any] = {}

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

    async def configure_deck(self, settings: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            ws = self._active_ws
        if ws is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google Flow Chrome Companion is not currently connected.",
            )
        envelope = FlowWsEnvelope(
            event_type="CONFIGURE_DECK",
            correlation_id=str(uuid4()),
            payload=settings,
        )
        await ws.send_json(envelope.model_dump())
        return {"status": "DISPATCHED_TO_COMPANION", "settings": settings}

    async def sync_character(self, character_payload: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            ws = self._active_ws
        if ws is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google Flow Chrome Companion is not currently connected.",
            )
        envelope = FlowWsEnvelope(
            event_type="SYNC_CHARACTER",
            correlation_id=str(uuid4()),
            payload=character_payload,
        )
        await ws.send_json(envelope.model_dump())
        return {"status": "DISPATCHED_TO_COMPANION", "character": character_payload}

    async def orchestrate_scene(self, scene_payload: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            ws = self._active_ws
        if ws is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google Flow Chrome Companion is not currently connected.",
            )
        envelope = FlowWsEnvelope(
            event_type="ORCHESTRATE_SCENE",
            correlation_id=str(uuid4()),
            payload=scene_payload,
        )
        await ws.send_json(envelope.model_dump())
        return {"status": "DISPATCHED_TO_COMPANION", "scene": scene_payload}

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

    async def handle_audio_result(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Saves audio bytes sent by AI Studio Playground Companion and updates chapter track."""
        project_id = _sanitize_path_segment(str(payload.get("project_id", "default_book")))
        chapter_id = _sanitize_path_segment(str(payload.get("chapter_id", "ch_001")))
        task_id = str(payload.get("task_id", str(uuid4())))
        audio_base64 = payload.get("audio_base64")
        mime_type = payload.get("mime_type", "audio/wav")
        duration_seconds = float(payload.get("duration_seconds", 0.0))

        dest_dir = self.output_root / project_id / "chapters" / chapter_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        ext = ".wav" if "wav" in mime_type else ".mp3"
        filename = f"{chapter_id}_3.8tts_{task_id[:8]}{ext}"
        dest_path = dest_dir / filename

        if audio_base64:
            audio_bytes = base64.b64decode(audio_base64)
            dest_path.write_bytes(audio_bytes)
            # Also copy to static output directory for /api/outputs serving
            shared_audio_dir = Path("output") / "audio"
            shared_audio_dir.mkdir(parents=True, exist_ok=True)
            (shared_audio_dir / filename).write_bytes(audio_bytes)

            if duration_seconds <= 0.0 and ext == ".wav":
                try:
                    import wave
                    with wave.open(str(dest_path), "r") as w:
                        duration_seconds = round(w.getnframes() / float(w.getframerate()), 2)
                except Exception:
                    pass

        audio_url = f"/api/outputs/{filename}"
        logger.info("Saved AI Studio 3.8 TTS Audio: %s (%s)", dest_path, audio_url)
        return {
            "ok": True,
            "task_id": task_id,
            "project_id": project_id,
            "chapter_id": chapter_id,
            "audio_url": audio_url,
            "file_path": str(dest_path.resolve()),
            "duration_seconds": duration_seconds,
            "source": "AI_STUDIO_PLAYGROUND_3.8_TTS",
        }

    async def dispatch_audio_task(self, audio_payload: dict[str, Any]) -> dict[str, Any]:
        """Dispatches an audio screenplay task to the connected AI Studio Companion."""
        async with self._lock:
            ws = self._active_ws
        if ws is None:
            return {
                "dispatched": False,
                "reason": "AI Studio Companion is not currently connected.",
                "payload": audio_payload,
            }
        envelope = FlowWsEnvelope(
            event_type="DISPATCH_AUDIO_TASK",
            correlation_id=str(uuid4()),
            payload=audio_payload,
        )
        await ws.send_json(envelope.model_dump())
        return {"dispatched": True, "payload": audio_payload}

    async def sync_chapter_package(self, pkg: "ChapterPackagePayload") -> dict[str, Any]:
        async with self._lock:
            self._cached_chapter_package = pkg.model_dump()
            if pkg.frames:
                self._pending_queue.clear()
                aspect = (
                    FlowAspectRatio.LANDSCAPE_16_9
                    if "16:9" in pkg.aspect_ratio
                    else FlowAspectRatio.SQUARE_1_1
                )
                engine = (
                    FlowModelEngine.NANO_BANANA
                    if "banana" in pkg.model_engine.lower()
                    else FlowModelEngine.IMAGEN_3
                )
                for f in pkg.frames:
                    frame_idx = f.get("frame_index", 1)
                    prompt = f.get("compiled_image_prompt") or f.get("prompt", "")
                    task = FlowGenerationTask(
                        project_id=pkg.book_id,
                        scene_id=f.get("scene_id", "sc01"),
                        beat_id=f"beat_{frame_idx:03d}",
                        prompt=prompt.strip(),
                        aspect_ratio=aspect,
                        model_engine=engine,
                        candidate_count=pkg.candidate_count,
                    )
                    self._pending_queue.append(task)

            ws_to_notify = self._active_ws

        if ws_to_notify is not None:
            envelope = FlowWsEnvelope(
                event_type="CHAPTER_PACKAGE_SYNC",
                payload=self._cached_chapter_package,
            )
            try:
                await ws_to_notify.send_json(envelope.model_dump())
            except Exception as exc:
                logger.warning("Failed to emit CHAPTER_PACKAGE_SYNC: %s", exc)

        if not self._queue_paused:
            await self._try_dispatch_next()

        return {
            "ok": True,
            "queued_count": len(self._pending_queue),
            "chapter_title": pkg.chapter_title,
            "total_words": pkg.total_words,
            "auto_open_tabs": pkg.auto_open_tabs,
        }

    async def get_chapter_package(self) -> dict[str, Any]:
        async with self._lock:
            return self._cached_chapter_package


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
            try:
                envelope = FlowWsEnvelope.model_validate(raw_message)
            except Exception as parse_err:
                logger.warning("Malformed WS envelope received: %s | data=%s", parse_err, raw_message)
                continue

            try:
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

                elif envelope.event_type == "AUDIO_RESULT":
                    saved_audio = await flow_orchestrator.handle_audio_result(envelope.payload)
                    ack = FlowWsEnvelope(
                        event_type="BRIDGE_ACK",
                        correlation_id=saved_audio.get("task_id", envelope.envelope_id),
                        payload=saved_audio,
                    )
                    await websocket.send_json(ack.model_dump())

                elif envelope.event_type == "DISPATCH_AUDIO_TASK":
                    from app.services.flow_tts_service import execute_gemini_tts_synthesis

                    audio_req = FlowAudioGenerateRequest.model_validate(envelope.payload)
                    out_dir = Path("output") / "flow_assets" / audio_req.project_id / "chapters" / audio_req.chapter_id
                    audio_res = execute_gemini_tts_synthesis(request=audio_req, output_dir=out_dir)
                    res_env = FlowWsEnvelope(
                        event_type="AUDIO_RESULT",
                        correlation_id=envelope.correlation_id or envelope.envelope_id,
                        payload=audio_res.model_dump(),
                    )
                    await websocket.send_json(res_env.model_dump())
            except Exception as dispatch_err:
                logger.warning("Error processing %s: %s", envelope.event_type, dispatch_err)

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


@router.post("/deck/configure")
async def configure_flow_deck(settings: dict[str, Any]) -> dict[str, Any]:
    """Programmatically configure Google Flow deck settings (model, ratio, thinking level)."""
    return await flow_orchestrator.configure_deck(settings)


@router.post("/character/sync")
async def sync_flow_character(character_payload: dict[str, Any]) -> dict[str, Any]:
    """Instruct the companion to register a character in Flow's Character Studio."""
    return await flow_orchestrator.sync_character(character_payload)


@router.post("/scene/orchestrate")
async def orchestrate_flow_scene(scene_payload: dict[str, Any]) -> dict[str, Any]:
    """Instruct the companion to build a multi-clip scene in Flow's Scenebuilder."""
    return await flow_orchestrator.orchestrate_scene(scene_payload)


@router.post("/av/mux", response_model=FlowAVMuxResult)
async def mux_chapter_storyboard(mux_req: FlowAVMuxRequest) -> FlowAVMuxResult:
    """Mux Flow visual assets with voiceover narration into a chapter video storyboard."""
    return await execute_chapter_av_assembly(mux_req)


@router.post("/audio/generate", response_model=FlowAudioResultEvent)
async def generate_chapter_audio(request: FlowAudioGenerateRequest) -> FlowAudioResultEvent:
    """
    Synthesize broadcast-grade 24kHz chapter audio using Gemini 3.8 Flash TTS.
    Defaults to SINGLE_NARRATOR (Enzo) unless the user explicitly selected SMART_MULTI_SPEAKER.
    Notifies user of the selected configuration.
    """
    from app.services.flow_tts_service import execute_gemini_tts_synthesis

    output_dir = Path("output") / "flow_assets" / request.project_id / "chapters" / request.chapter_id
    result = execute_gemini_tts_synthesis(request=request, output_dir=output_dir)
    return result


class ChapterPackagePayload(BaseModel):
    book_id: str
    book_title: str = "Active Novel"
    chapter_index: int = 1
    chapter_title: str = "Chapter 1"
    total_words: int = 0
    estimated_audio_duration_sec: float = 0.0
    screenplay_transcript: str = ""
    narrator_voice: str = "Enzo"
    model_engine: str = "NANO_BANANA"
    aspect_ratio: str = "16:9"
    candidate_count: int = 4
    total_frames: int = 0
    frames: list[dict[str, Any]] = []
    auto_open_tabs: bool = True


@router.post("/chapter/package")
async def dispatch_chapter_package(payload: ChapterPackagePayload) -> dict[str, Any]:
    """Sync an entire chapter's audio screenplay and visual storyboard package to the companion."""
    return await flow_orchestrator.sync_chapter_package(payload)


@router.get("/chapter/package")
async def get_active_chapter_package() -> dict[str, Any]:
    """Fetch the currently active chapter package and metadata."""
    return await flow_orchestrator.get_chapter_package()

