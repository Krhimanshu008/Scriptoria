# backend/app/schemas/flow_contracts.py
from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()


class StrictModel(BaseModel):
    """Canonical base model enforcing zero unknown fields and immutability."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
        str_strip_whitespace=True,
        validate_default=True,
    )


class FlowConnectionState(StrEnum):
    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    IDLE = "IDLE"
    BUSY_GENERATING = "BUSY_GENERATING"
    SYNCING_INGREDIENTS = "SYNCING_INGREDIENTS"
    PAUSED = "PAUSED"
    ERROR = "ERROR"


class FlowIngredientCategory(StrEnum):
    CHARACTER = "CHARACTER"
    LOCATION = "LOCATION"
    PROP = "PROP"
    STYLE = "STYLE"


class FlowMediaType(StrEnum):
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"


class FlowModelEngine(StrEnum):
    NANO_BANANA_2_1 = "NANO_BANANA_2_1"
    NANO_BANANA_PRO = "NANO_BANANA_PRO"
    NANO_BANANA_2_LITE = "NANO_BANANA_2_LITE"
    NANO_BANANA = "NANO_BANANA"  # Canonical backward-compatible alias
    IMAGEN_3 = "IMAGEN_3"
    OMNI_1_2_FLASH = "OMNI_1_2_FLASH"
    OMNI_1_1_FLASH = "OMNI_1_1_FLASH"
    VEO_3_1_LITE = "VEO_3_1_LITE"
    VEO_3_1_FAST = "VEO_3_1_FAST"
    VEO_3_1_QUALITY = "VEO_3_1_QUALITY"
    VEO_2 = "VEO_2"
    VEO_3 = "VEO_3"
    FLOW_AUTO = "FLOW_AUTO"


class FlowThinkingLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    EXTRA_THOROUGH = "EXTRA_THOROUGH"


class FlowVideoMode(StrEnum):
    FRAMES = "FRAMES"
    INGREDIENTS = "INGREDIENTS"


class FlowAspectRatio(StrEnum):
    LANDSCAPE_16_9 = "16:9"
    PORTRAIT_9_16 = "9:16"
    SQUARE_1_1 = "1:1"
    STANDARD_4_3 = "4:3"
    PORTRAIT_3_4 = "3:4"
    CINEMATIC_21_9 = "21:9"


class FlowTaskStatus(StrEnum):
    QUEUED = "QUEUED"
    DISPATCHED = "DISPATCHED"
    INJECTING_PROMPT = "INJECTING_PROMPT"
    AWAITING_RENDER = "AWAITING_RENDER"
    DOWNLOADING = "DOWNLOADING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class FlowQueueActionType(StrEnum):
    PAUSE = "PAUSE"
    RESUME = "RESUME"
    CANCEL_TASK = "CANCEL_TASK"
    RETRY_TASK = "RETRY_TASK"
    CLEAR_FAILED = "CLEAR_FAILED"
    FLUSH_ALL = "FLUSH_ALL"
    PING_COMPANION = "PING_COMPANION"


class FlowIngredientRef(StrictModel):
    """Reference to an @ingredient token to be injected into the Google Flow prompt editor."""

    ingredient_id: str = Field(..., min_length=1, max_length=128)
    mention_handle: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description="Handle without leading '@', e.g., 'Detective_Kael' or 'NeoTokyo_Alley'",
    )
    category: FlowIngredientCategory = Field(default=FlowIngredientCategory.CHARACTER)
    flow_internal_tag_id: str | None = Field(
        default=None,
        max_length=128,
        description="Google Flow internal ingredient UUID if already bound.",
    )

    @field_validator("mention_handle")
    @classmethod
    def sanitize_handle(cls, value: str) -> str:
        cleaned = value.lstrip("@").strip()
        if not cleaned:
            raise ValueError("mention_handle cannot be empty after stripping '@'")
        return cleaned


class FlowCompanionStatus(StrictModel):
    """Live telemetry & connection state reported by the Chrome Companion and FastAPI Bridge."""

    session_id: str = Field(default_factory=lambda: str(uuid4()))
    connection_state: FlowConnectionState = Field(default=FlowConnectionState.DISCONNECTED)
    flow_project_id: str = Field(
        default="ea1ed436-e578-4327-9c9b-4f6b2e7e551d",
        min_length=8,
        max_length=128,
        description="Active Google Flow project UUID detected in browser URL.",
    )
    active_tab_url: str | None = Field(default=None, max_length=2048)
    extension_version: str = Field(default="1.0.0", max_length=32)
    user_agent: str | None = Field(default=None, max_length=512)
    active_task_id: str | None = Field(default=None, max_length=128)
    queued_tasks_count: int = Field(default=0, ge=0)
    completed_tasks_count: int = Field(default=0, ge=0)
    failed_tasks_count: int = Field(default=0, ge=0)
    available_ingredients: tuple[str, ...] = Field(
        default_factory=tuple,
        description="List of @ingredient handles currently detected in the Flow project drawer.",
    )
    last_heartbeat_at: str = Field(default_factory=utc_now_iso)
    last_error: str | None = Field(default=None, max_length=1024)


class FlowIngredientSyncItem(StrictModel):
    """Single ingredient definition to synchronize between Scriptoria and Google Flow."""

    ingredient_id: str = Field(..., min_length=1, max_length=128)
    project_id: str = Field(..., min_length=1, max_length=128)
    flow_project_id: str = Field(
        default="ea1ed436-e578-4327-9c9b-4f6b2e7e551d",
        min_length=8,
        max_length=128,
    )
    name: str = Field(..., min_length=1, max_length=120)
    mention_handle: str = Field(..., min_length=1, max_length=80)
    category: FlowIngredientCategory
    visual_prompt: str = Field(..., min_length=3, max_length=4000)
    reference_image_url: str | None = Field(default=None, max_length=2048)
    character_profile_id: str | None = Field(default=None, max_length=128)
    scene_id: str | None = Field(default=None, max_length=128)
    flow_internal_tag_id: str | None = Field(default=None, max_length=128)


class FlowIngredientSync(StrictModel):
    """Bidirectional payload for syncing project ingredients (@mentions) with Google Flow."""

    sync_id: str = Field(default_factory=lambda: str(uuid4()))
    project_id: str = Field(..., min_length=1, max_length=128)
    flow_project_id: str = Field(
        default="ea1ed436-e578-4327-9c9b-4f6b2e7e551d",
        min_length=8,
        max_length=128,
    )
    direction: Literal["PUSH_TO_FLOW", "PULL_FROM_FLOW", "RECONCILE"] = Field(
        default="RECONCILE"
    )
    ingredients: tuple[FlowIngredientSyncItem, ...] = Field(default_factory=tuple)
    auto_create_missing: bool = Field(default=True)
    requested_at: str = Field(default_factory=utc_now_iso)


class FlowGenerationTask(StrictModel):
    """Canonical task dispatched to the Chrome Companion to generate an image or video in Flow."""

    task_id: str = Field(default_factory=lambda: str(uuid4()))
    project_id: str = Field(..., min_length=1, max_length=128)
    flow_project_id: str = Field(
        default="ea1ed436-e578-4327-9c9b-4f6b2e7e551d",
        min_length=8,
        max_length=128,
    )
    scene_id: str | None = Field(default=None, max_length=128)
    character_profile_id: str | None = Field(default=None, max_length=128)
    beat_id: str | None = Field(default=None, max_length=128)
    prompt: str = Field(
        ...,
        min_length=3,
        max_length=8000,
        description="Full prompt text; may contain @mention tokens matching ingredient_refs.",
    )
    negative_prompt: str | None = Field(default=None, max_length=2000)
    ingredient_refs: tuple[FlowIngredientRef, ...] = Field(default_factory=tuple)
    media_type: FlowMediaType = Field(default=FlowMediaType.IMAGE)
    model_engine: FlowModelEngine = Field(default=FlowModelEngine.NANO_BANANA_2_1)
    aspect_ratio: FlowAspectRatio = Field(default=FlowAspectRatio.LANDSCAPE_16_9)
    candidate_count: int = Field(default=1, ge=1, le=4)
    thinking_level: FlowThinkingLevel = Field(default=FlowThinkingLevel.HIGH)
    video_mode: FlowVideoMode = Field(default=FlowVideoMode.INGREDIENTS)
    video_duration_seconds: int = Field(default=5, ge=3, le=15)
    video_resolution: Literal["360p", "720p"] = Field(default="720p")
    seed: int | None = Field(default=None, ge=0)
    priority: int = Field(default=5, ge=1, le=10, description="1 = highest priority, 10 = lowest")
    timeout_seconds: int = Field(default=180, ge=15, le=600)
    status: FlowTaskStatus = Field(default=FlowTaskStatus.QUEUED)
    retry_count: int = Field(default=0, ge=0, le=5)
    created_at: str = Field(default_factory=utc_now_iso)


class FlowMediaCandidate(StrictModel):
    """A single captured image or video output intercepted from Google Flow's RPC response."""

    candidate_index: int = Field(default=0, ge=0, le=100)
    remote_url: str = Field(
        ...,
        min_length=8,
        max_length=4096,
        description="Captured *.googleusercontent.com, storage.googleapis.com, or blob: URL.",
    )
    media_type: FlowMediaType = Field(default=FlowMediaType.IMAGE)
    mime_type: str = Field(default="image/png", max_length=64)
    width: int | None = Field(default=None, ge=16, le=8192)
    height: int | None = Field(default=None, ge=16, le=8192)
    duration_seconds: float | None = Field(default=None, ge=0.0, le=300.0)
    base64_data: str | None = Field(
        default=None,
        description="Optional browser-captured Base64 payload when URL is blob: or cookie-locked.",
    )
    flow_media_key: str | None = Field(
        default=None,
        max_length=256,
        description="Internal media identifier returned by Google Flow RPC.",
    )


class FlowSavedAssetRecord(StrictModel):
    """Local disk persistence record produced after FastAPI downloads a captured candidate."""

    asset_id: str = Field(default_factory=lambda: str(uuid4()))
    candidate_index: int = Field(default=0, ge=0)
    local_relative_path: str = Field(..., min_length=1, max_length=1024)
    local_absolute_path: str = Field(..., min_length=1, max_length=2048)
    sha256_hash: str = Field(..., min_length=64, max_length=64)
    file_size_bytes: int = Field(..., ge=0)
    mime_type: str = Field(..., max_length=64)
    source_remote_url: str = Field(..., max_length=4096)


class FlowMediaResultEvent(StrictModel):
    """Event emitted by Chrome Companion upon capturing generated media (or failure) from Flow."""

    event_id: str = Field(default_factory=lambda: str(uuid4()))
    task_id: str = Field(..., min_length=1, max_length=128)
    project_id: str = Field(..., min_length=1, max_length=128)
    flow_project_id: str = Field(
        default="ea1ed436-e578-4327-9c9b-4f6b2e7e551d",
        min_length=8,
        max_length=128,
    )
    scene_id: str | None = Field(default=None, max_length=128)
    character_profile_id: str | None = Field(default=None, max_length=128)
    beat_id: str | None = Field(default=None, max_length=128)
    status: Literal["COMPLETED", "FAILED"] = Field(default="COMPLETED")
    media_type: FlowMediaType = Field(default=FlowMediaType.IMAGE)
    model_engine: FlowModelEngine = Field(default=FlowModelEngine.NANO_BANANA)
    prompt_used: str = Field(..., min_length=1, max_length=8000)
    candidates: tuple[FlowMediaCandidate, ...] = Field(default_factory=tuple)
    saved_assets: tuple[FlowSavedAssetRecord, ...] = Field(default_factory=tuple)
    rpc_endpoint_captured: str | None = Field(default=None, max_length=1024)
    generation_latency_ms: int | None = Field(default=None, ge=0)
    error_message: str | None = Field(default=None, max_length=2048)
    captured_at: str = Field(default_factory=utc_now_iso)

    @model_validator(mode="after")
    def verify_candidates_on_success(self) -> FlowMediaResultEvent:
        if self.status == "COMPLETED" and len(self.candidates) == 0:
            raise ValueError("COMPLETED FlowMediaResultEvent must include at least one candidate.")
        if self.status == "FAILED" and not self.error_message:
            raise ValueError("FAILED FlowMediaResultEvent must include an error_message.")
        return self


class FlowQueueAction(StrictModel):
    """Control command to manipulate the FastAPI + Companion task orchestration queue."""

    action_id: str = Field(default_factory=lambda: str(uuid4()))
    action: FlowQueueActionType
    target_task_id: str | None = Field(default=None, max_length=128)
    project_id: str | None = Field(default=None, max_length=128)
    reason: str | None = Field(default=None, max_length=512)
    requested_at: str = Field(default_factory=utc_now_iso)

    @model_validator(mode="after")
    def validate_target_task(self) -> FlowQueueAction:
        if self.action in {
            FlowQueueActionType.CANCEL_TASK,
            FlowQueueActionType.RETRY_TASK,
        } and not self.target_task_id:
            raise ValueError(f"target_task_id is required when action is {self.action}")
        return self


class FlowAudioVoiceMode(StrEnum):
    SINGLE_NARRATOR = "SINGLE_NARRATOR"
    SMART_MULTI_SPEAKER = "SMART_MULTI_SPEAKER"


class FlowAudioExecutionMode(StrEnum):
    AUTO = "AUTO"
    IN_TAB = "IN_TAB"
    HEADLESS = "HEADLESS"


class FlowAudioConfig(StrictModel):
    """Configuration for Gemini 3.8 Flash TTS audio generation."""

    model_name: Literal["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"] = Field(
        default="gemini-3.8-flash-tts",
        description="Flagship or Lite variant of Gemini 3.8 Flash TTS.",
    )
    voice_mode: FlowAudioVoiceMode = Field(
        default=FlowAudioVoiceMode.SINGLE_NARRATOR,
        description="Default is SINGLE_NARRATOR (no dual/multi-speaker) unless user explicitly selects SMART_MULTI_SPEAKER.",
    )
    narrator_voice: str = Field(
        default="Enzo",
        max_length=64,
        description="Voice preset for the master narrator (default: Enzo).",
    )
    character_voices: dict[str, str] = Field(
        default_factory=dict,
        description="Optional mapping of character names to voice presets when in SMART_MULTI_SPEAKER mode.",
    )
    language: Literal["en", "hi"] = Field(
        default="en",
        description="Language for generation (en = English, hi = Hindi). Supports cross-lingual voice transfer.",
    )
    enable_emotion_tags: bool = Field(
        default=True,
        description="Whether to inject inline audio tags (<breath/>, <gasp>, <shout>, <whisper>).",
    )
    execution_mode: FlowAudioExecutionMode = Field(
        default=FlowAudioExecutionMode.AUTO,
        description="AUTO: tries active AI Studio browser tab, falls back to headless SDK.",
    )


class FlowAudioGenerateRequest(StrictModel):
    """Request payload to synthesize chapter narration audio via Gemini 3.8 Flash TTS."""

    project_id: str = Field(..., min_length=1, max_length=128)
    chapter_id: str = Field(..., min_length=1, max_length=128)
    chapter_title: str = Field(..., min_length=1, max_length=200)
    raw_text: str = Field(..., min_length=5, max_length=50000)
    config: FlowAudioConfig = Field(default_factory=FlowAudioConfig)


class FlowAudioResultEvent(StrictModel):
    """Result emitted after synthesizing chapter audio via Gemini 3.8 Flash TTS."""

    task_id: str = Field(default_factory=lambda: str(uuid4()))
    project_id: str = Field(..., min_length=1, max_length=128)
    chapter_id: str = Field(..., min_length=1, max_length=128)
    chapter_title: str = Field(..., min_length=1, max_length=200)
    audio_path: str = Field(..., min_length=1, max_length=1024)
    duration_seconds: float = Field(..., ge=0.0)
    sample_rate_hz: int = Field(default=24000, ge=8000, le=48000)
    voice_used: str = Field(default="Enzo", max_length=64)
    voice_mode: FlowAudioVoiceMode = Field(default=FlowAudioVoiceMode.SINGLE_NARRATOR)
    language: str = Field(default="en", max_length=10)
    user_notification: str = Field(
        default="Using default single narrator voice: Enzo. You can configure multi-speaker voiceover in settings.",
        max_length=512,
    )
    status: Literal["COMPLETED", "FAILED"] = Field(default="COMPLETED")
    error_message: str | None = Field(default=None, max_length=2048)
    created_at: str = Field(default_factory=utc_now_iso)


class KaraokeWordToken(StrictModel):
    """Word-level timing token for real-time subtitle highlight and ASS karaoke tags."""

    word: str
    start_ms: int
    end_ms: int
    duration_cs: int = Field(description="Duration in centiseconds (10ms) for ASS {\\k...} tags")


class FrameAlignmentSpan(StrictModel):
    """Sample-accurate alignment for a single visual frame against master audio."""

    frame_index: int = Field(..., ge=1)
    sentence_span: str
    audio_start_sec: float = Field(..., ge=0.0)
    audio_end_sec: float = Field(..., ge=0.0)
    duration_sec: float = Field(..., ge=0.0)
    karaoke_tokens: tuple[KaraokeWordToken, ...] = Field(default_factory=tuple)


class FlowForcedAlignmentRequest(StrictModel):
    """Request specification for aligning 80-100 visual beats to master audio."""

    project_id: str = Field(..., min_length=1, max_length=128)
    chapter_id: str = Field(..., min_length=1, max_length=128)
    total_audio_duration_sec: float = Field(..., gt=0.0)
    sentence_spans: tuple[str, ...] = Field(..., min_length=1)


class FlowForcedAlignmentResult(StrictModel):
    """Result of sub-frame forced alignment with karaoke tokens and ASS subtitles."""

    project_id: str
    chapter_id: str
    total_duration_sec: float
    total_frames: int
    frames: tuple[FrameAlignmentSpan, ...]
    ass_subtitles_text: str
    created_at: str = Field(default_factory=utc_now_iso)


class CharacterLookdevPose(StrictModel):
    """Single pose or turnaround angle for a character's reference lookdev."""

    pose_name: Literal[
        "FRONT_PORTRAIT",
        "THREE_QUARTER_VIEW",
        "PROFILE_TURNAROUND",
        "FULL_BODY_COSTUME",
    ]
    prompt: str
    rendered_image_url: str | None = None
    approved_by_user: bool = False


class CharacterLookdevPackage(StrictModel):
    """Complete casting & lookdev package for a character before scene rendering."""

    character_id: str = Field(..., min_length=1, max_length=128)
    canonical_name: str = Field(..., min_length=1, max_length=120)
    mention_handle: str = Field(..., min_length=1, max_length=80)
    visual_tier: Literal["TIER_1_CORE", "TIER_2", "TIER_3"] = Field(default="TIER_1_CORE")
    physical_description: str = Field(default="", max_length=2000)
    wardrobe_description: str = Field(default="", max_length=2000)
    distinctive_features: tuple[str, ...] = Field(default_factory=tuple)
    tts_voice_id: str = Field(default="Enzo", max_length=64)
    lookdev_poses: tuple[CharacterLookdevPose, ...] = Field(default_factory=tuple)
    flow_internal_tag_id: str | None = Field(default=None, max_length=128)
    is_synced_to_flow: bool = Field(default=False)


class PreFlightIngredientItem(StrictModel):
    """Single ingredient tracked in the Pre-Flight Validation Gate."""

    ingredient_id: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=120)
    mention_handle: str = Field(..., min_length=1, max_length=80)
    category: FlowIngredientCategory = Field(default=FlowIngredientCategory.CHARACTER)
    visual_tier: Literal["TIER_1_CORE", "TIER_2", "TIER_3"] = Field(default="TIER_1_CORE")
    status: Literal["LOCKED", "PENDING_SYNC", "NOT_CONFIGURED"] = Field(default="PENDING_SYNC")
    flow_internal_tag_id: str | None = None
    preview_url: str | None = None
    tts_voice: str | None = None


class PreFlightSyncStatusResponse(StrictModel):
    """Overall project readiness status before story image generation."""

    flow_project_id: str = Field(default="ea1ed436-e578-4327-9c9b-4f6b2e7e551d")
    total_required_ingredients: int = Field(default=0, ge=0)
    synced_ingredients: int = Field(default=0, ge=0)
    missing_ingredients: tuple[str, ...] = Field(default_factory=tuple)
    is_ready_for_storyboard_dispatch: bool = Field(default=False)
    ingredients: tuple[PreFlightIngredientItem, ...] = Field(default_factory=tuple)


class LookdevGenerateRequest(StrictModel):
    """Request to synthesize multi-angle lookdev turnaround prompts."""

    book_id: str = Field(..., min_length=1)
    character_id: str = Field(..., min_length=1)
    canonical_name: str = Field(..., min_length=1)
    mention_handle: str = Field(..., min_length=1)
    visual_tier: Literal["TIER_1_CORE", "TIER_2", "TIER_3"] = "TIER_1_CORE"
    physical_description: str = ""
    wardrobe_description: str = ""
    art_style_prompt: str = (
        "cinematic chiaroscuro, 35mm film grain, 85mm portrait lens, neutral studio gray background"
    )


class LookdevApproveRequest(StrictModel):
    """Request to approve a candidate reference portrait for a character."""

    book_id: str = Field(..., min_length=1)
    character_id: str = Field(..., min_length=1)
    pose_name: Literal[
        "FRONT_PORTRAIT",
        "THREE_QUARTER_VIEW",
        "PROFILE_TURNAROUND",
        "FULL_BODY_COSTUME",
    ]
    approved_image_url: str


class FlowWsEnvelope(StrictModel):
    """Wire-level WebSocket frame envelope for all Companion <-> FastAPI communications."""

    envelope_id: str = Field(default_factory=lambda: str(uuid4()))
    event_type: Literal[
        "COMPANION_HELLO",
        "COMPANION_HEARTBEAT",
        "COMPANION_STATUS",
        "DISPATCH_TASK",
        "TASK_PROGRESS",
        "MEDIA_RESULT",
        "INGREDIENT_SYNC",
        "INGREDIENT_SYNC_ACK",
        "QUEUE_ACTION",
        "CONFIGURE_DECK",
        "DECK_CONFIG_RESULT",
        "SYNC_CHARACTER",
        "CHARACTER_SYNC_RESULT",
        "ORCHESTRATE_SCENE",
        "SCENE_ORCHESTRATION_RESULT",
        "DISPATCH_AUDIO_TASK",
        "AUDIO_PROGRESS",
        "AUDIO_RESULT",
        "CHAPTER_PACKAGE_SYNC",
        "LOOKDEV_SYNC",
        "LOOKDEV_SYNC_ACK",
        "PREFLIGHT_STATUS",
        "BRIDGE_ACK",
        "BRIDGE_ERROR",
    ]
    correlation_id: str | None = Field(default=None, max_length=128)
    timestamp: str = Field(default_factory=utc_now_iso)
    payload: dict[str, Any] = Field(default_factory=dict)
