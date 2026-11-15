from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.testbench_contracts import StrictModel

# ============================================================================
# 1. Entity & Character Visual Tier Contracts (EC-3.2)
# ============================================================================

EntityVisualTier = Literal["TIER_1_CORE", "TIER_2", "TIER_3"]
CompiledEntityType = Literal["CHARACTER", "LOCATION", "ITEM", "FACTION"]


class CompiledEntitySummary(StrictModel):
    entity_id: str
    canonical_name: str
    aliases: list[str] = Field(default_factory=list)
    entity_type: CompiledEntityType
    visual_tier: EntityVisualTier
    importance_score: float = Field(..., ge=0.0, le=1.0)
    base_anatomy: str | None = None
    first_seen_chapter: int = Field(..., ge=0)
    scene_presence_count: int = Field(default=1, ge=0)


# ============================================================================
# 2. Hierarchical Location & Materialized Path Contracts
# ============================================================================


class CompiledLocationSummary(StrictModel):
    location_id: str
    canonical_name: str
    parent_location_id: str | None = None
    materialized_path: str
    environment_tags: list[str] = Field(default_factory=list)


# ============================================================================
# 3. Dual-Timeline & Flashback Isolation Contracts (EC-3.1)
# ============================================================================

TimelineTimeType = Literal[
    "PRESENT",
    "FLASHBACK",
    "DREAM",
    "TIME_SKIP",
    "PARALLEL_POV",
]


class TimelineTickSummary(StrictModel):
    tick_index: int = Field(..., ge=1)
    narrative_seq: int = Field(..., ge=1)
    story_time_tick: int = Field(..., ge=0)
    chapter_index: int = Field(..., ge=0)
    scene_id: str
    time_type: TimelineTimeType = "PRESENT"
    is_flashback: bool
    location_id: str
    location_name: str
    characters_present: list[str] = Field(default_factory=list)
    summary: str


# ============================================================================
# 4. Graph Edge & Co-Occurrence Contracts
# ============================================================================

GraphEdgeType = Literal[
    "CO_OCCURRENCE",
    "INTERACTION",
    "LOCATED_IN",
    "POSSESSES",
    "FAMILY",
    "ALLIANCE",
]


class GraphEdgeSummary(StrictModel):
    edge_id: str
    source_id: str
    target_id: str
    edge_type: GraphEdgeType
    weight: int = Field(default=1, ge=1)
    bidirectional: bool = True


# ============================================================================
# 5. Stage-2 Book Compiler Request & Response Envelopes
# ============================================================================


class CompileBookRequest(StrictModel):
    book_id: str = Field(..., min_length=1)
    use_demo_if_empty: bool = True


class CompiledBookGraphResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str = Field(..., min_length=1)
    book_id: str = Field(..., min_length=1)
    total_chapters: int = Field(..., ge=0)
    total_scenes: int = Field(..., ge=0)
    total_beats: int = Field(..., ge=0)
    entities: dict[str, CompiledEntitySummary]
    locations: dict[str, CompiledLocationSummary]
    timeline: list[TimelineTickSummary]
    edges: list[GraphEdgeSummary]
    has_cycles_detected: bool = False
    cycle_break_count: int = 0
    duration_sec: float = Field(default=0.15, ge=0.0)


class TimelineResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    book_id: str
    total_ticks: int
    flashback_count: int
    ticks: list[TimelineTickSummary]


class CharacterRegistryResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    book_id: str
    characters: list[CompiledEntitySummary]
    tier_counts: dict[str, int]


class LocationTreeResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    book_id: str
    locations: list[CompiledLocationSummary]
    root_locations: list[str]
    cycle_free_verified: bool = True


__all__ = [
    "EntityVisualTier",
    "CompiledEntityType",
    "CompiledEntitySummary",
    "CompiledLocationSummary",
    "TimelineTimeType",
    "TimelineTickSummary",
    "GraphEdgeType",
    "GraphEdgeSummary",
    "CompileBookRequest",
    "CompiledBookGraphResponse",
    "TimelineResponse",
    "CharacterRegistryResponse",
    "LocationTreeResponse",
]
