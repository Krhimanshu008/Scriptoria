from __future__ import annotations

import json
import logging
import math
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.config import settings
from app.models.canonical_protocol import (
    HighDensityChapterStoryboard,
    MacroScene,
    SubSceneFrame,
    ShotType,
    CameraLens,
    CharacterFrameState,
)

logger = logging.getLogger("scriptoria.storyboard_studio")
router = APIRouter(prefix="/storyboard", tags=["High-Density Storyboard Studio"])


class DecomposeChapterRequest(BaseModel):
    book_id: str = Field(..., description="UUID or slug of the book")
    chapter_index: int = Field(default=1, ge=1)
    chapter_title: str = Field(default="Untitled Chapter")
    raw_text: str = Field(default="", description="Raw markdown/text of the chapter (~2000 words); if empty, auto-loads from R2 lake")
    target_frames: int = Field(default=90, ge=40, le=150, description="Target total frames (typically 80-100)")
    global_style: str = Field(
        default="cinematic 35mm film grain, atmospheric lighting, high-contrast chiaroscuro, aspect ratio 16:9",
        description="Global artistic visual style signature"
    )
    engine: Optional[str] = Field(
        default="deterministic",
        description="Decomposition engine: 'deterministic', 'multi_ai_brain' (Gemini), or 'qwen_swarm' (Dual Kaggle VMs)"
    )


class FlowDispatchBatchRequest(BaseModel):
    book_id: str
    chapter_index: int
    chapter_title: str = "Chapter"
    frames: List[Dict[str, Any]]
    aspect_ratio: str = "16:9"
    model_engine: str = "nano_banana"


class AudioSynthesisRequest(BaseModel):
    book_id: str
    chapter_index: int
    chapter_title: str = "Chapter"
    raw_text: str
    narrator_voice: str = "Enzo"
    voice_mode: str = "SINGLE_NARRATOR"


class FormatScreenplayRequest(BaseModel):
    book_id: Optional[str] = "31d94e54-6308-488b-a6fc-1085ee418d7c"
    chapter_index: int = 1
    chapter_title: str = "Chapter"
    raw_text: Optional[str] = ""
    screenplay_text: Optional[str] = ""
    storyboard: Optional[Dict[str, Any]] = None
    narrator_voice: str = "Enzo"
    voice_mode: str = "SINGLE_NARRATOR"
    enable_emotion_tags: bool = True


class AudioUploadPayload(BaseModel):
    book_id: str
    chapter_index: int = 1
    filename: str = "chapter_audio.wav"
    audio_base64: str
    duration_seconds: Optional[float] = None


class ValidateStoryboardRequest(BaseModel):
    storyboard: Dict[str, Any]


# ---------------------------------------------------------------------------
# Deterministic High-Density Storyboard Decomposer
# ---------------------------------------------------------------------------

def _split_into_macro_scenes(text: str, target_scene_count: int = 6) -> List[Dict[str, Any]]:
    """Splits chapter text into 5-8 coherent macro scenes based on breaks or narrative flow."""
    # Check for explicit scene break tags
    explicit_splits = re.split(r"(?:<SCENE_BREAK\s*/>|\n\s*[\*\-_]{3,}\s*\n|\n\s*#{2,3}\s+)", text)
    explicit_splits = [s.strip() for s in explicit_splits if s.strip()]

    if len(explicit_splits) >= 4:
        scenes_raw = explicit_splits
    else:
        # Paragraph-based narrative grouping
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        if not paragraphs:
            paragraphs = [text.strip()]
        
        # Determine chunk size in paragraphs
        chunk_size = max(1, math.ceil(len(paragraphs) / target_scene_count))
        scenes_raw = []
        for i in range(0, len(paragraphs), chunk_size):
            scene_text = "\n\n".join(paragraphs[i:i + chunk_size])
            scenes_raw.append(scene_text)

    # Normalize to target range 5-8
    final_scenes = []
    current_char_offset = 0
    for idx, s_text in enumerate(scenes_raw, start=1):
        # Extract title or first sentence as heading
        first_line = s_text.split("\n")[0].replace("#", "").strip()[:60]
        heading = first_line if first_line else f"Scene {idx}"
        
        start_char = text.find(s_text, current_char_offset)
        if start_char == -1:
            start_char = current_char_offset
        end_char = start_char + len(s_text)
        current_char_offset = end_char

        final_scenes.append({
            "scene_id": f"sc{idx:02d}",
            "scene_order": idx,
            "heading": heading,
            "text": s_text,
            "char_start": start_char,
            "char_end": end_char,
        })

    return final_scenes


def _slice_scene_into_subscenes(
    scene: Dict[str, Any],
    frames_allocated: int,
    start_frame_idx: int,
    global_style: str,
    start_audio_sec: float = 0.0,
) -> tuple[List[SubSceneFrame], float]:
    """Slices a macro scene into 12-16 atomic visual frames with audio timestamp tracking."""
    text = scene["text"]
    scene_id = scene["scene_id"]
    
    # Split text into sentences
    sentences = re.split(r"(?<=[.!?])\s+", text)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 3]

    if not sentences:
        sentences = [text]

    # Group sentences to hit target frame count
    step = max(1, len(sentences) / frames_allocated)
    subscenes: List[SubSceneFrame] = []

    # Lens rotation grammar (Cinematic grammar: Wide -> Medium -> OTS -> Close-Up -> Detail)
    lens_cycle = [
        (ShotType.WIDE_ESTABLISHING, CameraLens.MM_28, "establishing wide angle"),
        (ShotType.MEDIUM_TWO_SHOT, CameraLens.MM_35, "medium cinematic framing"),
        (ShotType.OVER_THE_SHOULDER, CameraLens.MM_50, "over-the-shoulder depth perspective"),
        (ShotType.CLOSE_UP_EMOTIONAL, CameraLens.MM_85, "intense emotional close-up"),
        (ShotType.INSERT_PROP_DETAIL, CameraLens.MM_85, "macro focus on key interaction or prop"),
        (ShotType.LOW_ANGLE_HEROIC, CameraLens.MM_28, "dramatic low-angle hero framing"),
    ]

    current_char = scene["char_start"]
    current_audio_time = start_audio_sec

    for i in range(frames_allocated):
        frame_idx = start_frame_idx + i
        s_start_idx = int(i * step)
        s_end_idx = min(len(sentences), int((i + 1) * step))
        if s_start_idx >= len(sentences):
            s_start_idx = len(sentences) - 1
        
        span_sentences = sentences[s_start_idx:max(s_start_idx + 1, s_end_idx)]
        sentence_span = " ".join(span_sentences).strip()
        if not sentence_span:
            sentence_span = sentences[-1]

        char_len = len(sentence_span)
        char_start = current_char
        char_end = char_start + char_len
        current_char = char_end

        # Audio timestamp calculation (at ~140 wpm natural narration rate = ~2.33 words/second)
        word_count = len(sentence_span.split())
        audio_dur = round(max(2.0, word_count / 2.33), 2)
        audio_start = round(current_audio_time, 2)
        audio_end = round(audio_start + audio_dur, 2)
        current_audio_time = audio_end

        shot_type, lens, shot_desc = lens_cycle[i % len(lens_cycle)]

        # Detect candidate entities
        words = sentence_span.split()
        capitalized = [w.strip(",.;:\"'!?") for w in words if w and w[0].isupper() and len(w) > 2]
        
        # Build prompt
        action_clean = sentence_span.replace("\n", " ").strip()[:180]
        image_prompt = (
            f"{shot_desc} of {action_clean}. "
            f"Shot on {lens.value}, atmospheric chiaroscuro lighting, "
            f"{global_style}"
        )

        char_states = []
        for name in capitalized[:2]:
            if name.lower() not in {"the", "and", "then", "with", "from", "into", "chapter", "part"}:
                char_states.append(
                    CharacterFrameState(
                        handle=f"@{name}",
                        pose_and_blocking=f"positioned dynamically in scene according to: {action_clean[:60]}",
                        facial_expression="focused, expressive, narrative-driven",
                        gaze_direction="directed toward focal scene element",
                        wardrobe_state="consistent with narrative setting and atmospheric weather",
                        held_props=[]
                    )
                )

        subscenes.append(
            SubSceneFrame(
                frame_index=frame_idx,
                scene_id=scene_id,
                sentence_span=sentence_span,
                char_start=char_start,
                char_end=char_end,
                shot_type=shot_type,
                lens=lens,
                lighting_and_atmosphere="dramatic directional lighting with soft ambient fill and atmospheric particles",
                active_characters=char_states,
                spatial_environment_focus=scene["heading"],
                compiled_image_prompt=image_prompt,
                audio_start_sec=audio_start,
                audio_end_sec=audio_end,
                audio_duration_sec=audio_dur,
            )
        )

    return subscenes, current_audio_time


# ---------------------------------------------------------------------------
# Multi-AI Cognitive Swarm ("The Story Brain")
# ---------------------------------------------------------------------------

async def _ai_director_decompose(
    raw_text: str,
    target_frames: int,
    api_key: Optional[str] = None
) -> Optional[List[Dict[str, Any]]]:
    """Invokes Gemini 3.5 Flash / Google AI Studio Director Brain to divide chapter into macro scenes."""
    key = api_key or os.environ.get("GEMINI_API_KEY") or getattr(settings, "GEMINI_API_KEY", None)
    if not key:
        logger.info("No GEMINI_API_KEY configured for AI Story Brain, using deterministic fallback.")
        return None

    model = "gemini-3.5-flash-lite"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"

    director_prompt = (
        "You are the Chief Narrative Director of Scriptoria Storyboard Studio.\n"
        "Your task is to analyze the following chapter (~2,000 words) and divide it into 5 to 8 Macro Scenes "
        "based on location shifts, time shifts, or character entrances/exits.\n"
        f"You must allocate an exact frame budget per scene such that the sum equals {target_frames} frames.\n\n"
        "Respond ONLY with valid JSON conforming to this structure:\n"
        "{\n"
        '  "macro_scenes": [\n'
        '    {\n'
        '      "scene_id": "sc01",\n'
        '      "scene_order": 1,\n'
        '      "heading": "Descriptive Heading",\n'
        '      "location_handle": "@LocationHandle",\n'
        '      "time_of_day": "e.g. cold morning / sunset",\n'
        '      "summary": "1-2 sentence dramatic summary",\n'
        '      "frame_budget": 14\n'
        '    }\n'
        '  ]\n'
        "}\n\n"
        f"CHAPTER TEXT:\n{raw_text[:6000]}"
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                url,
                json={"contents": [{"parts": [{"text": director_prompt}]}]},
                headers={"Content-Type": "application/json"}
            )
            if resp.status_code == 200:
                data = resp.json()
                raw_reply = data["candidates"][0]["content"]["parts"][0]["text"]
                clean_json = re.sub(r"^```(?:json)?\s*", "", raw_reply.strip())
                clean_json = re.sub(r"\s*```$", "", clean_json.strip())
                parsed = json.loads(clean_json)
                if "macro_scenes" in parsed and len(parsed["macro_scenes"]) >= 3:
                    logger.info("AI Director successfully decomposed chapter into %d macro scenes.", len(parsed["macro_scenes"]))
                    return parsed["macro_scenes"]
    except Exception as exc:
        logger.warning("AI Director decomposition exception: %s. Falling back to deterministic NLP engine.", exc)

    return None


async def _qwen_swarm_decompose(
    raw_text: str,
    target_frames: int,
    tunnel_url: Optional[str] = None,
    vm_secret: Optional[str] = None,
) -> Optional[List[Dict[str, Any]]]:
    """Queries Kaggle Director VM (Acc 2: Qwen 27B Turbo or Acc 1: 5M-Swarm) via dynamic Caddy tunnel with Gemini fallback."""
    base_url = (
        tunnel_url
        or os.environ.get("VM_DIRECTOR_TUNNEL_URL")
        or os.environ.get("VM_TUNNEL_URL")
        or os.environ.get("COMFYUI_GPU0_URL")
        or "https://gpu0.krhimanshu.in"
    ).rstrip("/")
    secret = vm_secret or os.environ.get("VM_DIRECTOR_SECRET") or os.environ.get("VM_SECRET", "")
    target_port = os.environ.get("VM_TARGET_PORT", "8190")

    url = f"{base_url}/v1/chat/completions"

    prompt = (
        "You are the Chief Narrative Director of Scriptoria fiction studio running on Kaggle Qwen Swarm.\n"
        "Analyze the following chapter (~2,000 words) and divide it into 5 to 8 Macro Scenes "
        "based on location shifts, time shifts, or character entrances/exits.\n"
        f"Allocate exact frame budgets summing to {target_frames} frames.\n"
        "Respond ONLY with valid JSON conforming to this structure:\n"
        "{\n"
        '  "macro_scenes": [\n'
        '    {\n'
        '      "scene_id": "sc01",\n'
        '      "scene_order": 1,\n'
        '      "heading": "Descriptive Heading",\n'
        '      "location_handle": "@LocationHandle",\n'
        '      "time_of_day": "e.g. dusk",\n'
        '      "summary": "1-2 sentence dramatic summary",\n'
        '      "frame_budget": 14\n'
        '    }\n'
        '  ]\n'
        "}\n\n"
        f"CHAPTER TEXT:\n{raw_text[:6000]}"
    )

    headers = {
        "Content-Type": "application/json",
        "X-Target-Port": target_port,
    }
    if secret:
        headers["X-VM-Secret"] = secret

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                url,
                json={
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                    "max_tokens": 1500,
                },
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                clean_json = re.sub(r"^```(?:json)?\s*", "", content.strip())
                clean_json = re.sub(r"\s*```$", "", clean_json.strip())
                parsed = json.loads(clean_json)
                if "macro_scenes" in parsed and len(parsed["macro_scenes"]) >= 3:
                    logger.info("Local Qwen Director (Kaggle VM via Caddy :%s) successfully decomposed chapter.", target_port)
                    return parsed["macro_scenes"]
    except Exception as exc:
        logger.info("Kaggle Qwen Swarm at %s (port %s) offline or booting (%s), falling back to Gemini.", url, target_port, exc)

    return await _ai_director_decompose(raw_text, target_frames)


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@router.post("/decompose", response_model=HighDensityChapterStoryboard)
async def decompose_chapter_to_storyboard(req: DecomposeChapterRequest, request: Request) -> Any:
    """Decomposes ~2,000-word chapter into 80-100 granular visual sub-scene frames with zero context loss."""
    raw_text = req.raw_text.strip()
    
    # Auto-load from R2 Lake if raw_text was omitted or short
    if not raw_text or len(raw_text) < 100:
        try:
            from app.services.r2_storage import R2StorageService
            r2 = R2StorageService()
            md_key = f"parsed/{req.book_id}/ch_{req.chapter_index:03d}.md"
            if r2.exists(md_key):
                raw_text = r2.get_text(md_key)
                logger.info("Auto-loaded %d words from R2: %s", len(raw_text.split()), md_key)
        except Exception as err:
            logger.warning("Could not auto-fetch chapter from R2: %s", err)

    if not raw_text:
        raise HTTPException(status_code=400, detail="raw_text cannot be empty and could not be loaded from R2")

    word_count = len(raw_text.split())
    target_frames = req.target_frames

    # Dynamic Caddy Ingress resolution from Next.js proxy headers
    director_tunnel = (
        request.headers.get("x-director-tunnel-url")
        or os.environ.get("VM_DIRECTOR_TUNNEL_URL")
        or os.environ.get("VM_TUNNEL_URL")
    )
    director_secret = request.headers.get("x-director-vm-secret") or os.environ.get("VM_SECRET", "")

    # Check if Local Qwen Swarm or Multi-AI Cognitive Swarm ("Story Brain") was requested
    ai_scenes = None
    if req.engine == "qwen_swarm":
        ai_scenes = await _qwen_swarm_decompose(
            raw_text,
            target_frames,
            tunnel_url=director_tunnel,
            vm_secret=director_secret,
        )
    elif req.engine == "multi_ai_brain":
        ai_scenes = await _ai_director_decompose(raw_text, target_frames)

    # Step 1: Split into 5 to 8 Macro Scenes (Deterministic or AI Director)
    macro_scenes_data = _split_into_macro_scenes(raw_text, target_scene_count=len(ai_scenes) if ai_scenes else 6)
    scene_count = len(macro_scenes_data)

    # If AI Director provided headings and frame budgets, merge them
    if ai_scenes and len(ai_scenes) == scene_count:
        for idx, sc in enumerate(macro_scenes_data):
            sc["heading"] = ai_scenes[idx].get("heading", sc["heading"])
            sc["location_handle"] = ai_scenes[idx].get("location_handle", f"@Location_{sc['scene_id']}")
            sc["time_of_day"] = ai_scenes[idx].get("time_of_day", "continuous narrative progression")
            sc["summary"] = ai_scenes[idx].get("summary", "")
            sc["frame_budget"] = ai_scenes[idx].get("frame_budget")

    # Step 2: Allocate frames across scenes
    frames_per_scene = math.floor(target_frames / scene_count)
    remainder = target_frames % scene_count

    compiled_macro_scenes: List[MacroScene] = []
    current_frame_counter = 1
    current_audio_time = 0.0

    for idx, sc_data in enumerate(macro_scenes_data):
        frames_this_scene = sc_data.get("frame_budget") or (frames_per_scene + (1 if idx < remainder else 0))
        sub_scenes, current_audio_time = _slice_scene_into_subscenes(
            sc_data,
            frames_allocated=frames_this_scene,
            start_frame_idx=current_frame_counter,
            global_style=req.global_style,
            start_audio_sec=current_audio_time,
        )
        current_frame_counter += len(sub_scenes)

        compiled_macro_scenes.append(
            MacroScene(
                scene_id=sc_data["scene_id"],
                scene_order=sc_data["scene_order"],
                scene_heading=sc_data["heading"],
                location_handle=sc_data.get("location_handle", f"@Location_{sc_data['scene_id']}"),
                time_of_day=sc_data.get("time_of_day", "continuous narrative progression"),
                summary=sc_data.get("summary") or f"Macro Scene {sc_data['scene_order']}: {sc_data['heading']}. Covers {len(sub_scenes)} atomic visual frames.",
                sub_scenes=sub_scenes,
            )
        )

    total_actual_frames = sum(len(ms.sub_scenes) for ms in compiled_macro_scenes)

    storyboard = HighDensityChapterStoryboard(
        schema_version="2.0.0",
        book_id=req.book_id,
        chapter_index=req.chapter_index,
        chapter_title=req.chapter_title,
        total_words=word_count,
        total_frames=total_actual_frames,
        scenes=compiled_macro_scenes,
    )

    logger.info(
        "Successfully decomposed chapter %s via %s into %d macro scenes and %d sub-scene frames.",
        req.chapter_title,
        f"Engine: {req.engine}" if req.engine else "Deterministic Engine",
        scene_count,
        total_actual_frames,
    )

    return storyboard


@router.post("/flow/dispatch")
async def dispatch_storyboard_to_flow(req: FlowDispatchBatchRequest) -> Any:
    """Enqueues all 80-100 storyboard frame prompts into the Flow Bridge queue for companion execution."""
    from app.routers.flow_bridge import flow_orchestrator
    from app.schemas.flow_contracts import FlowGenerationTask, FlowAspectRatio, FlowModelEngine

    dispatched_ids = []
    aspect = FlowAspectRatio.LANDSCAPE_16_9 if "16:9" in req.aspect_ratio else FlowAspectRatio.SQUARE_1_1
    engine = FlowModelEngine.NANO_BANANA if "banana" in req.model_engine.lower() else FlowModelEngine.IMAGEN_3

    for f in req.frames:
        frame_idx = f.get("frame_index", 1)
        prompt = f.get("compiled_image_prompt") or f.get("sentence_span") or f.get("prompt", "")
        if len(prompt.strip()) < 3:
            prompt = f"Cinematic scene for frame {frame_idx}"
        task = FlowGenerationTask(
            project_id=req.book_id,
            scene_id=f.get("scene_id", "sc01"),
            beat_id=f"beat_{frame_idx:03d}",
            prompt=prompt.strip(),
            aspect_ratio=aspect,
            model_engine=engine,
            priority=min(10, max(1, frame_idx % 10 or 5)),
        )
        enqueued = await flow_orchestrator.enqueue_task(task)
        dispatched_ids.append(enqueued.task_id)

    logger.info("Dispatched %d storyboard frames for %s to Flow Bridge queue.", len(dispatched_ids), req.book_id)
    return {
        "ok": True,
        "dispatched_count": len(dispatched_ids),
        "book_id": req.book_id,
        "chapter_index": req.chapter_index,
        "first_ten_task_ids": dispatched_ids[:10],
        "connected_clients": len(flow_orchestrator._all_ws),
        "flow_connected": flow_orchestrator._flow_ws is not None,
    }


@router.post("/tts/format-screenplay")
async def format_chapter_screenplay(req: FormatScreenplayRequest) -> Any:
    """Formats chapter prose into Google AI Studio 3.8 Flash TTS screenplay format with speaker and emotion blocks."""
    from app.services.flow_tts_service import format_screenplay_transcript, FlowAudioConfig, FlowAudioVoiceMode

    raw_text = (req.raw_text or req.screenplay_text or "").strip()
    book_id = req.book_id or "31d94e54-6308-488b-a6fc-1085ee418d7c"
    chapter_idx = req.chapter_index or 1
    chapter_title = req.chapter_title or "Chapter"

    if req.storyboard:
        sb = req.storyboard
        book_id = sb.get("book_id", book_id)
        chapter_idx = sb.get("chapter_index", chapter_idx)
        chapter_title = sb.get("chapter_title", chapter_title)
        if not raw_text and "scenes" in sb:
            spans = []
            for sc in sb["scenes"]:
                for sub in sc.get("sub_scenes", []):
                    span = sub.get("sentence_span", "").strip()
                    if span:
                        spans.append(span)
            raw_text = "\n\n".join(spans)

    if not raw_text and book_id:
        try:
            from app.services.r2_storage import R2StorageService
            r2 = R2StorageService()
            k = f"parsed/{book_id}/ch_{chapter_idx:03d}.md"
            if r2.exists(k):
                raw_text = r2.get_text(k).strip()
        except Exception:
            pass

    if not raw_text:
        raw_text = "Call me Ishmael."

    mode = FlowAudioVoiceMode.SMART_MULTI_SPEAKER if "multi" in req.voice_mode.lower() else FlowAudioVoiceMode.SINGLE_NARRATOR
    config = FlowAudioConfig(
        narrator_voice=req.narrator_voice,
        voice_mode=mode,
        language="en",
        enable_emotion_tags=req.enable_emotion_tags,
    )
    formatted_script, notice = format_screenplay_transcript(
        text=raw_text,
        config=config,
        chapter_title=chapter_title,
    )
    word_count = len(raw_text.split())
    estimated_duration_sec = round(word_count / 2.33, 2)
    return {
        "ok": True,
        "formatted_screenplay": formatted_script,
        "screenplay_text": formatted_script,
        "total_words": word_count,
        "word_count": word_count,
        "estimated_duration_seconds": estimated_duration_sec,
        "estimated_audio_duration_sec": estimated_duration_sec,
        "model_recommended": "gemini-3.8-flash-tts",
        "notice": notice,
    }


@router.post("/tts/dispatch-playground")
async def dispatch_audio_to_playground(req: FormatScreenplayRequest) -> Any:
    """Dispatches the formatted 3.8 TTS screenplay directly to the active Google AI Studio Playground Companion."""
    from app.routers.flow_bridge import flow_orchestrator

    script_text = (req.screenplay_text or req.raw_text or "").strip()
    if not script_text:
        script_text = "Call me Ishmael."

    payload = {
        "book_id": req.book_id,
        "chapter_index": req.chapter_index,
        "chapter_title": req.chapter_title,
        "raw_text": script_text,
        "narrator_voice": req.narrator_voice,
        "model_engine": "gemini-3.8-flash-tts",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    dispatch_res = await flow_orchestrator.dispatch_audio_task(payload)
    is_dispatched = dispatch_res.get("dispatched", False)
    return {
        "ok": True,
        "dispatched": is_dispatched,
        "reason": dispatch_res.get("reason"),
        "message": (
            "Dispatched screenplay to open Google AI Studio tab!"
            if is_dispatched
            else "Screenplay ready! Companion tab standby: you can also copy to clipboard and paste directly into Google AI Studio."
        ),
        "formatted_screenplay": script_text,
    }


@router.post("/audio/upload")
async def upload_chapter_audio(payload: AudioUploadPayload) -> Any:
    """Ingests generated/exported audio from Google AI Studio Playground and attaches it to the chapter."""
    import base64
    from pathlib import Path
    from uuid import uuid4

    output_dir = Path("output/audio")
    output_dir.mkdir(parents=True, exist_ok=True)
    task_id = str(uuid4())[:8]
    ext = ".wav" if payload.filename.endswith(".wav") else ".mp3"
    filename = f"{payload.book_id}_ch{payload.chapter_index:03d}_{task_id}{ext}"
    dest_path = output_dir / filename

    audio_bytes = base64.b64decode(payload.audio_base64)
    dest_path.write_bytes(audio_bytes)

    duration_sec = payload.duration_seconds or 0.0
    if duration_sec <= 0.0 and ext == ".wav":
        try:
            import wave
            with wave.open(str(dest_path), "r") as w:
                duration_sec = round(w.getnframes() / float(w.getframerate()), 2)
        except Exception:
            duration_sec = max(3.0, round(len(audio_bytes) / 48000.0, 2))

    audio_url = f"/api/outputs/{filename}"
    logger.info("Uploaded AI Studio audio track: %s (%s, %.2fs)", dest_path, audio_url, duration_sec)
    return {
        "ok": True,
        "audio_url": audio_url,
        "file_path": str(dest_path.resolve()),
        "duration_seconds": duration_sec,
        "file_size_bytes": len(audio_bytes),
        "source": "AI_STUDIO_PLAYGROUND_3.8_TTS",
    }


@router.post("/tts/synthesize")
async def synthesize_chapter_audio(req: AudioSynthesisRequest) -> Any:
    """Generates 24kHz broadcast narration audio for chapter using Google AI Studio TTS."""
    from app.services.flow_tts_service import (
        execute_gemini_tts_synthesis,
        format_screenplay_transcript,
        FlowAudioConfig,
        FlowAudioGenerateRequest,
        FlowAudioVoiceMode,
    )
    from pathlib import Path

    output_dir = Path("output/audio")
    mode = FlowAudioVoiceMode.SMART_MULTI_SPEAKER if "multi" in req.voice_mode.lower() else FlowAudioVoiceMode.SINGLE_NARRATOR
    config = FlowAudioConfig(
        narrator_voice=req.narrator_voice,
        voice_mode=mode,
        language="en",
    )
    formatted_script, _ = format_screenplay_transcript(
        text=req.raw_text,
        config=config,
        chapter_title=req.chapter_title,
    )
    request_obj = FlowAudioGenerateRequest(
        project_id=req.book_id,
        chapter_id=f"ch_{req.chapter_index:03d}",
        chapter_title=req.chapter_title,
        raw_text=req.raw_text,
        config=config,
    )
    result = execute_gemini_tts_synthesis(request_obj, output_dir=output_dir)
    audio_url = f"/api/outputs/{Path(result.audio_path).name}" if result.status == "COMPLETED" else None
    return {
        "ok": result.status == "COMPLETED",
        "status": result.status,
        "audio_url": audio_url,
        "duration_seconds": result.duration_seconds,
        "file_path": result.audio_path,
        "formatted_screenplay": formatted_script,
        "notice": result.user_notification,
        "error": result.error_message,
    }


@router.post("/validate")
async def validate_storyboard_payload(req: ValidateStoryboardRequest) -> Any:
    """Validates raw JSON against canonical HighDensityChapterStoryboard schema."""
    try:
        storyboard = HighDensityChapterStoryboard.model_validate(req.storyboard)
        return {
            "valid": True,
            "book_id": storyboard.book_id,
            "chapter_index": storyboard.chapter_index,
            "total_frames": storyboard.total_frames,
            "scenes_count": len(storyboard.scenes),
            "errors": [],
        }
    except Exception as exc:
        return {
            "valid": False,
            "errors": str(exc).split("\n"),
        }
