# backend/app/services/flow_tts_service.py
"""
Scriptoria Gemini 3.8 Flash TTS Voice & Speech Service
Connects to Google AI Studio's flagship `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`
to synthesize broadcast-grade 24kHz audio in English and Hindi.

Default Behavior:
- If user does not choose multi-speaker voiceover, defaults to a SINGLE NARRATOR voice (Enzo)
  and issues a clear user notification.
- If user selects SMART_MULTI_SPEAKER, parses character dialogue into distinct speech blocks.
"""

from __future__ import annotations

import os
import re
import wave
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.schemas.flow_contracts import (
    FlowAudioConfig,
    FlowAudioGenerateRequest,
    FlowAudioResultEvent,
    FlowAudioVoiceMode,
)

# Default single narrator configuration
DEFAULT_NARRATOR_VOICE = "Enzo"
DEFAULT_SINGLE_NARRATOR_NOTICE = (
    "Using default single narrator voice: Enzo. Multi-speaker voiceover is disabled."
)


def format_screenplay_transcript(
    text: str,
    config: FlowAudioConfig,
    chapter_title: str = "",
) -> tuple[str, str]:
    """
    Format chapter prose into Google AI Studio Speech Blocks transcript format.
    Returns (formatted_transcript, user_notification).
    """
    clean_text = text.strip()

    # 1. Single Narrator Mode (Default)
    if config.voice_mode == FlowAudioVoiceMode.SINGLE_NARRATOR:
        notice = (
            f"Using default single narrator voice: {config.narrator_voice}. "
            "Multi-speaker voiceover is disabled."
        )
        if config.enable_emotion_tags:
            # Add subtle natural pause after title or opening sentence if present
            formatted = f"## Transcript:\n[Speaker: Narrator, Style: atmospheric, dramatic]\n{clean_text}"
        else:
            # Raw text without emotion tags
            formatted = f"## Transcript:\n[Speaker: Narrator]\n{clean_text}"
        return formatted, notice

    # 2. Smart Multi-Speaker Mode
    char_voices = config.character_voices or {}
    char_list_str = ", ".join(f"{k} ({v})" for k, v in char_voices.items()) or "Automatic"
    notice = (
        f"Smart Multi-Speaker Voiceover active: Narrator ({config.narrator_voice}) "
        f"with character voices: [{char_list_str}]."
    )

    # Split dialogue in quotes from narration
    # Match double quotes or single directional quotes
    segments = re.split(r'(".*?"|“.*?”)', clean_text)
    blocks: list[str] = ["## Transcript:"]

    for seg in segments:
        seg_clean = seg.strip()
        if not seg_clean:
            continue
        if (seg_clean.startswith('"') and seg_clean.endswith('"')) or (
            seg_clean.startswith("“") and seg_clean.endswith("”")
        ):
            # Dialogue block
            dialogue_text = seg_clean[1:-1].strip()
            # Assign first character voice if available, otherwise Ahab/Character
            speaker_name = next(iter(char_voices.keys()), "Character")
            style = "intense, emotional" if config.enable_emotion_tags else "standard"
            blocks.append(f"[Speaker: {speaker_name}, Style: {style}]\n{dialogue_text}")
        else:
            # Narrator block
            style = "atmospheric, slow" if config.enable_emotion_tags else "standard"
            blocks.append(f"[Speaker: Narrator, Style: {style}]\n{seg_clean}")

    return "\n\n".join(blocks), notice


def execute_gemini_tts_synthesis(
    request: FlowAudioGenerateRequest,
    output_dir: Path,
    api_key: str | None = None,
) -> FlowAudioResultEvent:
    """
    Execute speech synthesis via `google.genai` SDK using `gemini-3.8-flash-tts`.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    task_id = str(uuid4())

    transcript, notice = format_screenplay_transcript(
        text=request.raw_text,
        config=request.config,
        chapter_title=request.chapter_title,
    )

    # Resolve API Key
    resolved_key = (
        api_key
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or "AIzaSyDxX7jQPyUnm87sSVa2N9-NdLhMTSjrTuU"
    )

    out_filename = (
        f"{request.chapter_id}_{request.config.language}_{request.config.narrator_voice.lower()}_{task_id[:8]}.wav"
    )
    dest_path = output_dir / out_filename

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=resolved_key)

        speech_config = types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=request.config.narrator_voice
                )
            )
        )

        gen_config = types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=speech_config,
        )

        response = client.models.generate_content(
            model=request.config.model_name,
            contents=transcript,
            config=gen_config,
        )

        # Extract audio bytes
        audio_bytes: bytes | None = None
        for candidate in response.candidates:
            if candidate.content and candidate.content.parts:
                for part in candidate.content.parts:
                    if part.inline_data and part.inline_data.data:
                        audio_bytes = part.inline_data.data
                        break
            if audio_bytes:
                break

        if not audio_bytes:
            raise RuntimeError("Gemini 3.8 Flash TTS returned response without audio bytes.")

        # Write WAV to disk
        dest_path.write_bytes(audio_bytes)

        # Inspect duration via wave module
        duration_sec = 0.0
        sample_rate = 24000
        try:
            with wave.open(str(dest_path), "r") as w:
                frames = w.getnframes()
                sample_rate = w.getframerate()
                duration_sec = round(frames / float(sample_rate), 2)
        except Exception:
            # Fallback estimation if wave header parsing fails
            duration_sec = max(2.5, round(len(request.raw_text.split()) / 2.33, 2))

        return FlowAudioResultEvent(
            task_id=task_id,
            project_id=request.project_id,
            chapter_id=request.chapter_id,
            chapter_title=request.chapter_title,
            audio_path=str(dest_path.resolve()),
            duration_seconds=duration_sec,
            sample_rate_hz=sample_rate,
            voice_used=request.config.narrator_voice,
            voice_mode=request.config.voice_mode,
            language=request.config.language,
            user_notification=notice,
            status="COMPLETED",
        )

    except Exception as exc:
        return FlowAudioResultEvent(
            task_id=task_id,
            project_id=request.project_id,
            chapter_id=request.chapter_id,
            chapter_title=request.chapter_title,
            audio_path="",
            duration_seconds=0.0,
            sample_rate_hz=24000,
            voice_used=request.config.narrator_voice,
            voice_mode=request.config.voice_mode,
            language=request.config.language,
            user_notification=f"Audio generation failed: {exc}",
            status="FAILED",
            error_message=str(exc),
        )
