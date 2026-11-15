from __future__ import annotations

from typing import Literal
from pydantic import ConfigDict, Field

from app.schemas.testbench_contracts import (
    SpanRange,
    StrictModel,
    compute_utf16_span,
)

# ============================================================================
# 1. Quote Anchoring & Visual Beat Contracts
# ============================================================================

MatchQuality = Literal["EXACT", "FUZZY", "UNMATCHED"]


class QuoteAnchorMatch(StrictModel):
    exact_quote: str = Field(..., min_length=1)
    span: SpanRange | None = None
    match_quality: MatchQuality
    similarity_score: float = Field(..., ge=0.0, le=1.0)


class VisualBeat(StrictModel):
    beat_order: int = Field(..., ge=1)
    shot_suggestion: str = Field(..., min_length=1)
    focal_elements: list[str] = Field(default_factory=list)
    quote_anchor: QuoteAnchorMatch


class CharacterPresence(StrictModel):
    entity_id: str = Field(..., min_length=1)
    name_in_scene: str = Field(..., min_length=1)
    action: str
    emotional_state: str
    clothing_mention: str | None = None


class ExtractedScene(StrictModel):
    scene_id: str = Field(..., min_length=1)
    scene_order: int = Field(..., ge=1)
    start_char_offset: int = Field(..., ge=0)
    end_char_offset: int = Field(..., ge=0)
    verbatim_summary: str = Field(..., min_length=1)
    location_name: str = Field(..., min_length=1)
    time_of_day: str = Field(default="DAY")
    characters_present: list[CharacterPresence] = Field(default_factory=list)
    beats: list[VisualBeat] = Field(..., min_length=1)


# ============================================================================
# 2. Rolling Glossary & Entity Contracts (EC-2.4 Bloat Cap)
# ============================================================================

EntityType = Literal["CHARACTER", "LOCATION", "ITEM", "FACTION"]


class ExtractedEntityItem(StrictModel):
    entity_id: str = Field(..., min_length=1)
    canonical_name: str = Field(..., min_length=1)
    aliases: list[str] = Field(default_factory=list)
    short_visual_tag: str = Field(
        ...,
        max_length=120,
        description="EC-2.4 Bloat Cap: maximum 120 characters for concise visual conditioning.",
    )
    entity_type: EntityType


class RollingGlossarySnapshot(StrictModel):
    entities: list[ExtractedEntityItem] = Field(default_factory=list)
    last_completed_chapter: int = Field(default=0, ge=0)


# ============================================================================
# 3. Chapter Extraction Request & Response Contracts
# ============================================================================


class ChapterExtractionRequest(StrictModel):
    book_id: str = Field(..., min_length=1)
    chapter_index: int = Field(..., ge=0)
    chapter_title: str | None = None
    raw_text: str = Field(..., min_length=1)
    glossary: RollingGlossarySnapshot | None = None
    worker_target: str = Field(default="gpu0")
    simulate_delay_s: float | None = Field(default=None, ge=0.0, le=10.0)


class QuoteMatchStats(StrictModel):
    total_beats: int = Field(..., ge=0)
    exact_matches: int = Field(..., ge=0)
    fuzzy_matches: int = Field(..., ge=0)
    unmatched: int = Field(..., ge=0)
    match_rate_percent: float = Field(..., ge=0.0, le=100.0)


class ChapterExtractionResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str = Field(..., min_length=1)
    book_id: str = Field(..., min_length=1)
    chapter_index: int = Field(..., ge=0)
    scenes: list[ExtractedScene] = Field(..., min_length=1)
    discovered_entities: list[ExtractedEntityItem] = Field(default_factory=list)
    updated_glossary: RollingGlossarySnapshot
    quote_stats: QuoteMatchStats
    diagnostics: list[str] = Field(default_factory=list)


# ============================================================================
# 4. Cloud VM Swarm & Mutual VRAM Eviction Contracts
# ============================================================================

VramLockMode = Literal["IDLE", "EXTRACTION_SWARM", "IMAGE_GEN_COMFYUI"]


class VramEvictionState(StrictModel):
    ok: Literal[True] = True
    trace_id: str = Field(..., min_length=1)
    active_mode: VramLockMode
    lock_holder: str | None = None
    vram_allocated_mb: float = Field(default=0.0, ge=0.0)
    gpu_device_name: str | None = None
    lock_acquired_timestamp: str | None = None


class VramLockRequest(StrictModel):
    requested_mode: VramLockMode
    client_id: str = Field(..., min_length=1)
    force: bool = False


class SwarmPortStatus(StrictModel):
    port: int = Field(..., ge=1, le=65535)
    service: str
    listening: bool
    mode: Literal["LIVE_SOCKET", "SIMULATED_READY"] = "LIVE_SOCKET"


class SwarmTargetNodeStatus(StrictModel):
    target_id: str
    accelerator_type: Literal["GPU", "TPU", "CPU"]
    device_name: str
    port: int
    reachable: bool
    status: Literal["ONLINE", "BUSY", "STANDBY", "OFFLINE"]
    latency_ms: float = Field(..., ge=0.0)


class SwarmStatusResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str = Field(..., min_length=1)
    targets: dict[str, SwarmTargetNodeStatus]
    ports: dict[str, SwarmPortStatus]
    active_ports: list[int]
    vram_state: VramEvictionState


# ============================================================================
# 5. Extraction Checkpoints & Crash Simulation (EC-2.3)
# ============================================================================


class ExtractionCheckpointItem(StrictModel):
    book_id: str
    chapter_index: int = Field(..., ge=0)
    completed_at: str
    scene_count: int = Field(..., ge=0)
    entity_count: int = Field(..., ge=0)
    sha256_hash: str


class ExtractionCheckpointsResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str = Field(..., min_length=1)
    book_id: str
    checkpoints: list[ExtractionCheckpointItem]
    can_resume_at_chapter: int = Field(..., ge=0)


class CrashSimulationRequest(StrictModel):
    book_id: str = Field(..., min_length=1)
    fail_at_chapter: int = Field(..., ge=1)
    total_chapters: int = Field(default=5, ge=1)


class CrashSimulationResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str = Field(..., min_length=1)
    crashed_at_chapter: int = Field(..., ge=1)
    completed_before_crash: list[int]
    resumable_chapter: int = Field(..., ge=0)
    idempotent_verified: bool


__all__ = [
    "MatchQuality",
    "QuoteAnchorMatch",
    "VisualBeat",
    "CharacterPresence",
    "ExtractedScene",
    "EntityType",
    "ExtractedEntityItem",
    "RollingGlossarySnapshot",
    "ChapterExtractionRequest",
    "QuoteMatchStats",
    "ChapterExtractionResponse",
    "VramLockMode",
    "VramEvictionState",
    "VramLockRequest",
    "SwarmPortStatus",
    "SwarmTargetNodeStatus",
    "SwarmStatusResponse",
    "ExtractionCheckpointItem",
    "ExtractionCheckpointsResponse",
    "CrashSimulationRequest",
    "CrashSimulationResponse",
]
