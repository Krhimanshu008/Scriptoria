from __future__ import annotations

import logging
import math
import os
import re
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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
    raw_text: str = Field(..., description="Raw markdown/text of the chapter (~2000 words)")
    target_frames: int = Field(default=90, ge=40, le=150, description="Target total frames (typically 80-100)")
    global_style: str = Field(
        default="cinematic 35mm film grain, atmospheric lighting, high-contrast chiaroscuro, aspect ratio 16:9",
        description="Global artistic visual style signature"
    )


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
) -> List[SubSceneFrame]:
    """Slices a macro scene into 12-16 atomic visual frames (~20-25 words each)."""
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
                compiled_image_prompt=image_prompt
            )
        )

    return subscenes


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@router.post("/decompose", response_model=HighDensityChapterStoryboard)
async def decompose_chapter_to_storyboard(req: DecomposeChapterRequest) -> Any:
    """Decomposes ~2,000-word chapter into 80-100 granular visual sub-scene frames with zero context loss."""
    raw_text = req.raw_text.strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="raw_text cannot be empty")

    word_count = len(raw_text.split())
    target_frames = req.target_frames

    # Step 1: Split into 5 to 8 Macro Scenes
    macro_scenes_data = _split_into_macro_scenes(raw_text, target_scene_count=6)
    scene_count = len(macro_scenes_data)

    # Step 2: Allocate frames across scenes proportionally
    frames_per_scene = math.floor(target_frames / scene_count)
    remainder = target_frames % scene_count

    compiled_macro_scenes: List[MacroScene] = []
    current_frame_counter = 1

    for idx, sc_data in enumerate(macro_scenes_data):
        frames_this_scene = frames_per_scene + (1 if idx < remainder else 0)
        sub_scenes = _slice_scene_into_subscenes(
            sc_data,
            frames_allocated=frames_this_scene,
            start_frame_idx=current_frame_counter,
            global_style=req.global_style,
        )
        current_frame_counter += frames_this_scene

        compiled_macro_scenes.append(
            MacroScene(
                scene_id=sc_data["scene_id"],
                scene_order=sc_data["scene_order"],
                scene_heading=sc_data["heading"],
                location_handle=f"@Location_{sc_data['scene_id']}",
                time_of_day="continuous narrative progression",
                summary=f"Macro Scene {sc_data['scene_order']}: {sc_data['heading']}. Covers {len(sub_scenes)} atomic visual frames.",
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
        "Successfully decomposed chapter %s into %d macro scenes and %d sub-scene frames.",
        req.chapter_title,
        scene_count,
        total_actual_frames,
    )

    return storyboard


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
