# backend/app/routers/flow_bridge.py
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import mimetypes
import re
import zipfile
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.schemas.flow_contracts import (
    CharacterLookdevPackage,
    CharacterLookdevPose,
    FlowAspectRatio,
    FlowAudioGenerateRequest,
    FlowAudioResultEvent,
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
    FlowSavedAssetRecord,
    FlowTaskStatus,
    FlowWsEnvelope,
    LookdevApproveRequest,
    LookdevGenerateRequest,
    PreFlightIngredientItem,
    PreFlightSyncStatusResponse,
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
        self._flow_ws: WebSocket | None = None
        self._aistudio_ws: WebSocket | None = None
        self._bg_ws: WebSocket | None = None
        self._all_ws: set[WebSocket] = set()

        self._companion_status: FlowCompanionStatus = FlowCompanionStatus()
        self._queue_paused: bool = False

        # Pending queue and task state maps
        self._pending_queue: deque[FlowGenerationTask] = deque()
        self._in_flight_task: FlowGenerationTask | None = None
        self._completed_results: dict[str, FlowMediaResultEvent] = {}
        self._failed_tasks: dict[str, FlowGenerationTask] = {}
        self._recent_events: deque[FlowMediaResultEvent] = deque(maxlen=100)
        self._cached_chapter_package: dict[str, Any] = {}
        self._lookdev_packages: dict[str, CharacterLookdevPackage] = {}
        self._locked_ingredients: dict[str, str] = {}

    # ==========================================================================
    # WebSocket Connection Lifecycle & Reconnection Recovery
    # ==========================================================================
    async def connect_companion(
        self,
        websocket: WebSocket,
        session_id: str,
        flow_project_id: str,
        source: str = "",
    ) -> None:
        await websocket.accept()
        async with self._lock:
            self._all_ws.add(websocket)

            is_aistudio = source == "AISTUDIO_PLAYGROUND" or "aistudio" in session_id.lower()
            is_bg = source == "BG_SERVICE_WORKER" or "bg-worker" in session_id.lower()
            is_flow = source == "FLOW_TAB" or (not is_aistudio and not is_bg)

            if is_flow:
                self._flow_ws = websocket
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
                    "Chrome Flow Tab Companion connected: session=%s flow_project=%s",
                    session_id,
                    flow_project_id,
                )
            elif is_aistudio:
                self._aistudio_ws = websocket
                logger.info("Chrome AI Studio Companion connected: session=%s", session_id)
            elif is_bg:
                self._bg_ws = websocket
                logger.info("Chrome Background Daemon connected: session=%s", session_id)

            # Re-verify flow connection state
            if self._flow_ws is None:
                self._companion_status = self._companion_status.model_copy(
                    update={"connection_state": FlowConnectionState.DISCONNECTED}
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
            self._all_ws.discard(websocket)
            if self._flow_ws is websocket:
                self._flow_ws = None
                self._companion_status = self._companion_status.model_copy(
                    update={
                        "connection_state": FlowConnectionState.DISCONNECTED,
                        "last_heartbeat_at": utc_now_iso(),
                    }
                )
                logger.warning("Chrome Flow Companion WebSocket disconnected.")
            elif self._aistudio_ws is websocket:
                self._aistudio_ws = None
                logger.info("Chrome AI Studio Companion WebSocket disconnected.")
            elif self._bg_ws is websocket:
                self._bg_ws = None
                logger.info("Chrome Background Daemon WebSocket disconnected.")

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
            elif self._flow_ws is None:
                merged["connection_state"] = FlowConnectionState.DISCONNECTED
            self._companion_status = FlowCompanionStatus.model_validate(merged)
            return self._companion_status

    async def get_status(self) -> FlowCompanionStatus:
        async with self._lock:
            # Check for stale heartbeat if Flow socket appears open
            if (
                self._flow_ws is not None
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
            elif self._flow_ws is None:
                self._companion_status = self._companion_status.model_copy(
                    update={"connection_state": FlowConnectionState.DISCONNECTED}
                )

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
                or self._flow_ws is None
                or self._in_flight_task is not None
                or not self._pending_queue
            ):
                return

            next_task = self._pending_queue.popleft()
            dispatched_task = next_task.model_copy(
                update={"status": FlowTaskStatus.DISPATCHED}
            )
            self._in_flight_task = dispatched_task
            ws = self._flow_ws

        envelope = FlowWsEnvelope(
            event_type="DISPATCH_TASK",
            correlation_id=dispatched_task.task_id,
            payload=dispatched_task.model_dump(),
        )
        try:
            await ws.send_json(envelope.model_dump())
            logger.info("Dispatched FlowGenerationTask %s to Flow Companion", dispatched_task.task_id)
        except Exception as exc:
            logger.error("Failed to dispatch task %s over WS: %s", dispatched_task.task_id, exc)
            async with self._lock:
                self._pending_queue.appendleft(
                    dispatched_task.model_copy(update={"status": FlowTaskStatus.QUEUED})
                )
                self._in_flight_task = None

    async def sync_ingredients(self, sync_req: FlowIngredientSync) -> dict[str, Any]:
        async with self._lock:
            ws = self._flow_ws
        if ws is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google Flow Chrome Companion tab is not currently connected.",
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
            ws = self._flow_ws
        if ws is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google Flow Chrome Companion tab is not currently connected.",
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
            ws = self._flow_ws
        if ws is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google Flow Chrome Companion tab is not currently connected.",
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
            ws = self._flow_ws
        if ws is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google Flow Chrome Companion tab is not currently connected.",
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
            ws = self._aistudio_ws or self._flow_ws or (next(iter(self._all_ws)) if self._all_ws else None)
        if ws is None:
            return {
                "dispatched": False,
                "reason": "Neither Google AI Studio nor Companion is currently connected.",
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
                pkg_media_type = getattr(pkg, "media_type", "IMAGE")
                is_video = "video" in str(pkg_media_type).lower() or "veo" in str(pkg.model_engine).lower()
                media_type = FlowMediaType.VIDEO if is_video else FlowMediaType.IMAGE
                engine = (
                    FlowModelEngine.VEO_3_1_LITE
                    if is_video
                    else (
                        FlowModelEngine.NANO_BANANA
                        if "banana" in pkg.model_engine.lower()
                        else FlowModelEngine.IMAGEN_3
                    )
                )
                cand_count = 1 if is_video else pkg.candidate_count
                for f in pkg.frames:
                    frame_idx = f.get("frame_index", 1)
                    prompt = f.get("compiled_image_prompt") or f.get("prompt", "")
                    task = FlowGenerationTask(
                        project_id=pkg.book_id,
                        scene_id=f.get("scene_id", "sc01"),
                        beat_id=f"beat_{frame_idx:03d}",
                        prompt=prompt.strip(),
                        aspect_ratio=aspect,
                        media_type=media_type,
                        model_engine=engine,
                        candidate_count=cand_count,
                    )
                    self._pending_queue.append(task)

            sockets_to_notify = list(self._all_ws)

        envelope = FlowWsEnvelope(
            event_type="CHAPTER_PACKAGE_SYNC",
            payload=self._cached_chapter_package,
        )
        for sock in sockets_to_notify:
            try:
                await sock.send_json(envelope.model_dump())
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
            "connected_clients": len(sockets_to_notify),
            "flow_connected": self._flow_ws is not None,
            "aistudio_connected": self._aistudio_ws is not None,
        }

    async def get_chapter_package(self) -> dict[str, Any]:
        async with self._lock:
            return self._cached_chapter_package

    async def generate_character_lookdev(
        self, req: LookdevGenerateRequest
    ) -> CharacterLookdevPackage:
        async with self._lock:
            handle = req.mention_handle.lstrip("@").strip()
            phys = req.physical_description or "athletic build, weathered cinematic lighting"
            wardrobe = req.wardrobe_description or "period-accurate historical costume"
            style = req.art_style_prompt

            # Assign voice based on character archetype
            lower_name = req.canonical_name.lower()
            if "ahab" in lower_name or "captain" in lower_name:
                tts_voice = "Fenrir"
            elif "queequeg" in lower_name or "harpoon" in lower_name:
                tts_voice = "Puck"
            elif any(w in lower_name for w in ["mary", "sarah", "rachel", "woman", "lady", "queen"]):
                tts_voice = "Kore"
            else:
                tts_voice = "Enzo"

            poses = (
                CharacterLookdevPose(
                    pose_name="FRONT_PORTRAIT",
                    prompt=(
                        f"85mm medium portrait of @{handle}, {req.canonical_name}, {phys}, "
                        f"{wardrobe}, front-facing camera gaze, eye level, neutral studio gray background, {style}"
                    ),
                    approved_by_user=False,
                ),
                CharacterLookdevPose(
                    pose_name="THREE_QUARTER_VIEW",
                    prompt=(
                        f"Cinematic 3/4 angle portrait of @{handle}, {req.canonical_name}, {phys}, "
                        f"{wardrobe}, rim lighting, atmospheric volumetric depth, {style}"
                    ),
                    approved_by_user=False,
                ),
                CharacterLookdevPose(
                    pose_name="PROFILE_TURNAROUND",
                    prompt=(
                        f"Side profile studio turnaround of @{handle}, {req.canonical_name}, {phys}, "
                        f"{wardrobe}, clean facial contour, dramatic fill lighting, {style}"
                    ),
                    approved_by_user=False,
                ),
                CharacterLookdevPose(
                    pose_name="FULL_BODY_COSTUME",
                    prompt=(
                        f"Full-length wide costume reference plate of @{handle}, {req.canonical_name}, {phys}, "
                        f"full body visible from head to boots, standing grounded posture, {style}"
                    ),
                    approved_by_user=False,
                ),
            )

            pkg = CharacterLookdevPackage(
                character_id=req.character_id,
                canonical_name=req.canonical_name,
                mention_handle=handle,
                visual_tier=req.visual_tier,
                physical_description=phys,
                wardrobe_description=wardrobe,
                distinctive_features=tuple(f.strip() for f in phys.split(",") if f.strip()),
                tts_voice_id=tts_voice,
                lookdev_poses=poses,
                is_synced_to_flow=handle.lower() in self._locked_ingredients,
            )

            cache_key = f"{req.book_id}:{req.character_id}"
            self._lookdev_packages[cache_key] = pkg
            self._lookdev_packages[handle.lower()] = pkg
            return pkg

    async def approve_character_lookdev(
        self, req: LookdevApproveRequest
    ) -> CharacterLookdevPackage:
        async with self._lock:
            cache_key = f"{req.book_id}:{req.character_id}"
            pkg = self._lookdev_packages.get(cache_key)
            if not pkg:
                for p in self._lookdev_packages.values():
                    if p.character_id == req.character_id:
                        pkg = p
                        break
            if not pkg:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Lookdev package not found for character {req.character_id}",
                )

            updated_poses = []
            for pose in pkg.lookdev_poses:
                if pose.pose_name == req.pose_name:
                    updated_poses.append(
                        pose.model_copy(
                            update={
                                "rendered_image_url": req.approved_image_url,
                                "approved_by_user": True,
                            }
                        )
                    )
                else:
                    updated_poses.append(pose)

            updated_pkg = pkg.model_copy(update={"lookdev_poses": tuple(updated_poses)})
            self._lookdev_packages[cache_key] = updated_pkg
            self._lookdev_packages[pkg.mention_handle.lower()] = updated_pkg
            return updated_pkg

    async def get_preflight_status(
        self, book_id: str, flow_project_id: str | None = None
    ) -> PreFlightSyncStatusResponse:
        async with self._lock:
            proj_id = flow_project_id or self._companion_status.flow_project_id
            avail_set = {
                handle.lower().lstrip("@")
                for handle in self._companion_status.available_ingredients
            }
            avail_set.update(k.lower() for k in self._locked_ingredients.keys())

            items: list[PreFlightIngredientItem] = []
            seen_handles: set[str] = set()

            raw_chars = self._cached_chapter_package.get("characters", [])
            if not raw_chars:
                raw_chars = [
                    {
                        "character_id": "char_ishmael",
                        "canonical_name": "Ishmael",
                        "mention_handle": "Ishmael",
                        "visual_tier": "TIER_1_CORE",
                        "tts_voice": "Enzo",
                    },
                    {
                        "character_id": "char_ahab",
                        "canonical_name": "Captain Ahab",
                        "mention_handle": "Ahab",
                        "visual_tier": "TIER_1_CORE",
                        "tts_voice": "Fenrir",
                    },
                    {
                        "character_id": "char_queequeg",
                        "canonical_name": "Queequeg",
                        "mention_handle": "Queequeg",
                        "visual_tier": "TIER_2",
                        "tts_voice": "Puck",
                    },
                ]

            for c in raw_chars:
                handle = str(c.get("mention_handle") or c.get("canonical_name", "Hero")).lstrip("@").strip()
                handle_key = handle.lower()
                if handle_key in seen_handles:
                    continue
                seen_handles.add(handle_key)

                is_locked = handle_key in avail_set
                items.append(
                    PreFlightIngredientItem(
                        ingredient_id=str(c.get("character_id", f"char_{handle_key}")),
                        name=str(c.get("canonical_name", handle)),
                        mention_handle=handle,
                        category=FlowIngredientCategory.CHARACTER,
                        visual_tier=c.get("visual_tier", "TIER_1_CORE"),
                        status="LOCKED" if is_locked else "PENDING_SYNC",
                        flow_internal_tag_id=self._locked_ingredients.get(handle_key),
                        tts_voice=c.get("tts_voice", "Enzo"),
                    )
                )

            loc_candidates = [
                ("loc_spouter", "The Spouter-Inn", "The_Spouter_Inn"),
                ("loc_pequod", "The Pequod Main Deck", "Pequod_Main_Deck"),
            ]
            for loc_id, loc_name, loc_handle in loc_candidates:
                handle_key = loc_handle.lower()
                if handle_key in seen_handles:
                    continue
                seen_handles.add(handle_key)
                is_locked = handle_key in avail_set
                items.append(
                    PreFlightIngredientItem(
                        ingredient_id=loc_id,
                        name=loc_name,
                        mention_handle=loc_handle,
                        category=FlowIngredientCategory.LOCATION,
                        visual_tier="TIER_1_CORE",
                        status="LOCKED" if is_locked else "PENDING_SYNC",
                        flow_internal_tag_id=self._locked_ingredients.get(handle_key),
                    )
                )

            missing = [item.mention_handle for item in items if item.status != "LOCKED"]
            synced_count = len(items) - len(missing)

            return PreFlightSyncStatusResponse(
                flow_project_id=proj_id,
                total_required_ingredients=len(items),
                synced_ingredients=synced_count,
                missing_ingredients=tuple(missing),
                is_ready_for_storyboard_dispatch=len(missing) == 0,
                ingredients=tuple(items),
            )

    async def sync_all_preflight_ingredients(
        self, book_id: str, flow_project_id: str | None = None
    ) -> dict[str, Any]:
        status_resp = await self.get_preflight_status(book_id, flow_project_id)
        if not status_resp.missing_ingredients:
            return {
                "ok": True,
                "message": "All required ingredients are already locked in Google Flow.",
                "status": status_resp.model_dump(),
            }

        sync_items = []
        for item in status_resp.ingredients:
            if item.status != "LOCKED":
                sync_items.append(
                    FlowIngredientSyncItem(
                        ingredient_id=item.ingredient_id,
                        project_id=book_id,
                        flow_project_id=status_resp.flow_project_id,
                        name=item.name,
                        mention_handle=item.mention_handle,
                        category=item.category,
                        visual_prompt=(
                            f"85mm reference portrait of @{item.mention_handle}, {item.name}, "
                            "cinematic chiaroscuro, 35mm film grain, neutral studio gray background"
                        ),
                    )
                )

        sync_req = FlowIngredientSync(
            project_id=book_id,
            flow_project_id=status_resp.flow_project_id,
            direction="PUSH_TO_FLOW",
            ingredients=tuple(sync_items),
            auto_create_missing=True,
        )

        async with self._lock:
            for item in sync_items:
                self._locked_ingredients[item.mention_handle.lower()] = f"flow_tag_{item.ingredient_id}"

            ws_available = self._flow_ws is not None

        if ws_available:
            dispatch_res = await self.sync_ingredients(sync_req)
        else:
            dispatch_res = {
                "status": "STAGED_LOCAL",
                "reason": "Companion currently offline; ingredients staged in local cache.",
            }

        return {
            "ok": True,
            "dispatched_count": len(sync_items),
            "flow_project_id": status_resp.flow_project_id,
            "sync_details": dispatch_res,
        }


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
    source: str = Query(default=""),
) -> None:
    await flow_orchestrator.connect_companion(
        websocket=websocket,
        session_id=session_id,
        flow_project_id=flow_project_id,
        source=source,
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

                elif envelope.event_type in {
                    "TASK_PROGRESS",
                    "INGREDIENT_SYNC_ACK",
                    "CHARACTER_SYNC_RESULT",
                }:
                    if envelope.event_type == "CHARACTER_SYNC_RESULT":
                        handle = envelope.payload.get("mention_handle")
                        tag_id = (
                            envelope.payload.get("flow_internal_tag_id")
                            or envelope.payload.get("tag_id")
                            or "locked"
                        )
                        if handle:
                            async with flow_orchestrator._lock:
                                flow_orchestrator._locked_ingredients[
                                    str(handle).lower().lstrip("@")
                                ] = str(tag_id)

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
    result = await asyncio.to_thread(execute_gemini_tts_synthesis, request=request, output_dir=output_dir)
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
    media_type: str = "IMAGE"
    model_engine: str = "NANO_BANANA"
    aspect_ratio: str = "16:9"
    candidate_count: int = 4
    total_frames: int = 0
    frames: list[dict[str, Any]] = []
    characters: list[dict[str, Any]] = []
    auto_open_tabs: bool = True


@router.post("/chapter/package")
async def dispatch_chapter_package(payload: ChapterPackagePayload) -> dict[str, Any]:
    """Sync an entire chapter's audio screenplay and visual storyboard package to the companion."""
    return await flow_orchestrator.sync_chapter_package(payload)


@router.get("/chapter/package")
async def get_active_chapter_package() -> dict[str, Any]:
    """Fetch the currently active chapter package and metadata."""
    return await flow_orchestrator.get_chapter_package()


@router.get("/preflight/status", response_model=PreFlightSyncStatusResponse)
@router.get("/ingredients/preflight-check", response_model=PreFlightSyncStatusResponse)
async def check_preflight_status(
    book_id: str = Query(default="31d94e54-6308-488b-a6fc-1085ee418d7c"),
    flow_project_id: str | None = Query(default=None),
) -> PreFlightSyncStatusResponse:
    """Check readiness of all required character and location ingredients in Google Flow."""
    return await flow_orchestrator.get_preflight_status(
        book_id=book_id, flow_project_id=flow_project_id
    )


@router.post("/lookdev/generate", response_model=CharacterLookdevPackage)
async def generate_character_lookdev_endpoint(
    req: LookdevGenerateRequest,
) -> CharacterLookdevPackage:
    """Generate 3-angle turnaround master prompts and lookdev package for a character."""
    return await flow_orchestrator.generate_character_lookdev(req)


@router.post("/lookdev/approve", response_model=CharacterLookdevPackage)
async def approve_character_lookdev_endpoint(
    req: LookdevApproveRequest,
) -> CharacterLookdevPackage:
    """Approve candidate image for a character's reference lookdev pose."""
    return await flow_orchestrator.approve_character_lookdev(req)


@router.post("/preflight/sync-all")
@router.post("/ingredients/sync-all")
async def sync_all_preflight_ingredients_endpoint(
    book_id: str = Query(default="31d94e54-6308-488b-a6fc-1085ee418d7c"),
    flow_project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Instruct the companion extension to create and lock all missing ingredients in Flow."""
    return await flow_orchestrator.sync_all_preflight_ingredients(
        book_id=book_id, flow_project_id=flow_project_id
    )


@router.get("/extension/download-zip")
async def download_extension_zip() -> StreamingResponse:
    """Package the Scriptoria Flow Companion Chrome extension into a downloadable ZIP."""
    from app.routers.flow_extension_bundle import get_extension_zip_bytes

    zip_bytes = get_extension_zip_bytes()
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={
            "Content-Disposition": "attachment; filename=scriptoria-flow-companion.zip",
            "Cache-Control": "no-cache",
        },
    )


