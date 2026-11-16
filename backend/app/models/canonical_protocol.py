"""
Canonical Protocol Schemas (v1.0.0) for Scriptoria
Enforces strict contracts across Deterministic Parsing, LLM Extraction,
Knowledge Graph Compilation, and Downstream Retrieval.
"""

from __future__ import annotations

import enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict, field_validator


class TimeClueType(str, enum.Enum):
    PRESENT = "PRESENT"
    FLASHBACK = "FLASHBACK"
    DREAM = "DREAM"
    TIME_SKIP = "TIME_SKIP"
    PARALLEL_POV = "PARALLEL_POV"


class EntityType(str, enum.Enum):
    CHARACTER = "CHARACTER"
    LOCATION = "LOCATION"
    ITEM = "ITEM"
    FACTION = "FACTION"


# ---------------------------------------------------------------------------
# Layer B: Visual Scene Breakdown & Narrative Clues
# ---------------------------------------------------------------------------

class TimeClue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_text: str = Field(..., description="Exact textual excerpt indicating time (e.g., 'Three days later', 'Ten years earlier')")
    time_type: TimeClueType = Field(default=TimeClueType.PRESENT, description="Temporal classification")
    delta_hint: Optional[str] = Field(None, description="Inferred delta like '+3 days', '-10 years', 'same afternoon'")


class LocationClue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_text: str = Field(..., description="Exact textual excerpt describing location hierarchy or movement")
    parent_hint: Optional[str] = Field(None, description="Inferred parent container (e.g., 'Vance Manor' for 'the cellar')")
    environment_tags: List[str] = Field(default_factory=list, description="Visual environmental attributes: interior, stormy, cavernous")


class CharacterMention(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str = Field(..., description="Normalized entity ID, e.g. 'char_mira_vance'")
    name_in_scene: str = Field(..., description="Name or designation used in this scene, e.g. 'the hooded stranger' or 'Mira'")
    action: str = Field(..., description="Physical action currently being performed in the scene")
    emotional_state: str = Field(..., description="Observed emotional/psychological state")
    visual_changes: Optional[str] = Field(None, description="Any injuries, scars, soot, blood, or physical markers discovered in this scene")
    clothing_mention: Optional[str] = Field(None, description="Specific clothing explicitly mentioned in this scene, or null if unmentioned")


class ItemMention(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: str = Field(..., description="Normalized item ID, e.g. 'item_cracked_brass_lantern'")
    item_name: str = Field(..., description="Name of the item in scene")
    held_by_entity_id: Optional[str] = Field(None, description="Character currently in custody of this item")
    condition: str = Field(default="intact", description="Physical state: intact, broken, glowing, ignited, stained")


class SettingObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location_id: str = Field(..., description="Normalized location ID, e.g. 'loc_glass_forge'")
    location_name: str = Field(..., description="Canonical or descriptive name of the setting")
    time_of_day: str = Field(default="unknown", description="dusk, dawn, noon, midnight, afternoon, etc.")
    weather_atmosphere: str = Field(default="clear", description="Atmospheric condition, e.g. 'howling blizzard, sub-zero chill'")
    lighting: str = Field(default="natural", description="Lighting source and quality, e.g. 'flickering amber embers, heavy shadows'")
    color_palette: List[str] = Field(default_factory=list, description="Dominant visual colors (e.g., ['#1C1917', '#B45309'])")


class VisualBeat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    beat_order: int = Field(..., ge=1, description="Sequential order within the scene (1, 2, 3...)")
    shot_suggestion: str = Field(..., description="Cinematographic suggestion, e.g. 'Wide establishing shot of cavernous forge with glowing cracks'")
    focal_elements: List[str] = Field(..., description="Key elements to anchor visual generation")
    quote_anchor: str = Field(..., description="Verbatim prose excerpt anchoring this visual beat to the text")


class SceneObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(..., description="Unique scene identifier, e.g. 'ch001_sc01'")
    scene_order_in_chapter: int = Field(..., ge=1, description="Order of the scene within the chapter")
    start_char_offset: int = Field(..., ge=0, description="Start character offset in source markdown")
    end_char_offset: int = Field(..., ge=0, description="End character offset in source markdown")
    verbatim_excerpt_summary: str = Field(..., description="1-2 sentence neutral summary of what occurs")
    setting: SettingObservation = Field(..., description="Setting, atmosphere, and lighting")
    characters_present: List[CharacterMention] = Field(default_factory=list, description="Characters physically present in this scene")
    items_interacted: List[ItemMention] = Field(default_factory=list, description="Key items and artifacts used or referenced")
    key_visual_beats: List[VisualBeat] = Field(..., min_length=1, description="Chronological visual shots for illustration")
    time_clue: Optional[TimeClue] = Field(None, description="Any explicit time jump or narrative shift")

    @field_validator("end_char_offset")
    @classmethod
    def validate_offsets(cls, v: int, info):
        start = info.data.get("start_char_offset")
        if start is not None and v < start:
            raise ValueError(f"end_char_offset ({v}) cannot be less than start_char_offset ({start})")
        return v


# ---------------------------------------------------------------------------
# Layer C: Entity Continuity Registry (Observations)
# ---------------------------------------------------------------------------

class EntityObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str = Field(..., description="Unique identifier, e.g. 'char_sunny'")
    canonical_name: str = Field(..., description="Most recognized canonical name")
    aliases: List[str] = Field(default_factory=list, description="Alternative names, titles, pronouns used")
    entity_type: EntityType = Field(..., description="CHARACTER, LOCATION, ITEM, or FACTION")
    static_traits: str = Field(..., description="Permanent visual/physical traits (height, eyes, hair, species, scars)")
    chapter_state_delta: Dict[str, Any] = Field(
        default_factory=dict,
        description="State changes introduced in this chapter: clothing, injuries, weapons equipped, custody changes"
    )


# ---------------------------------------------------------------------------
# Layer A: Verbatim & Chapter Checkpoint Protocol
# ---------------------------------------------------------------------------

class ChapterObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="1.0.0", description="Contract schema version")
    book_id: str = Field(..., description="UUID or unique slug of the book")
    chapter_index: int = Field(..., ge=1, description="1-indexed chapter number")
    chapter_title: str = Field(..., description="Chapter title as found in source")
    raw_text_r2_key: str = Field(..., description="R2 object path to cleaned chapter markdown")
    scenes: List[SceneObservation] = Field(default_factory=list, description="Extracted visual scenes")
    discovered_entities: List[EntityObservation] = Field(default_factory=list, description="New or updated entities from this chapter")
    time_clues: List[TimeClue] = Field(default_factory=list, description="All time indicators detected in the chapter")
    location_clues: List[LocationClue] = Field(default_factory=list, description="All spatial cues detected in the chapter")


class RollingEntityGlossaryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str
    canonical_name: str
    aliases: List[str] = Field(default_factory=list)
    short_visual_tag: str = Field(..., description="Minimal concise tag (e.g. 'mid-20s, dark braids, amber eyes') to preserve context tokens")
    entity_type: EntityType


class RollingEntityGlossary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    book_id: str
    last_completed_chapter: int = Field(default=0)
    entities: List[RollingEntityGlossaryItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Layer D: Stage-2 Compiled Temporal Knowledge Graph Protocols
# ---------------------------------------------------------------------------

class EntityVisualTier(str, enum.Enum):
    TIER_1_CORE = "TIER_1_CORE"
    TIER_2_SUPPORTING = "TIER_2_SUPPORTING"
    TIER_3_EXTRAS = "TIER_3_EXTRAS"


class EntityStateSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    story_tick: int = Field(..., description="Chronological story tick")
    narrative_seq: int = Field(..., description="Sequential reader discovery order")
    scene_id: str = Field(..., description="Scene in which state was observed or updated")
    outfit: Optional[str] = Field(None, description="Clothing worn")
    physical_condition: Optional[str] = Field(None, description="Physical state e.g. exhausted, wounded, energetic")
    injuries: List[str] = Field(default_factory=list, description="Active wounds, scars, burns")
    items_held: List[str] = Field(default_factory=list, description="Items currently in custody")
    is_stale: bool = Field(default=False, description="Flagged true when a time-skip invalidates ephemeral state")


class CompiledEntity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str
    canonical_name: str
    aliases: List[str] = Field(default_factory=list)
    entity_type: EntityType
    static_traits: str
    visual_tier: EntityVisualTier
    importance_score: float = Field(..., ge=0.0, le=1.0)
    presence_score: float = Field(default=0.0)
    agency_score: float = Field(default=0.0)
    centrality_score: float = Field(default=0.0)
    detail_density: float = Field(default=0.0)
    state_history: List[EntityStateSnapshot] = Field(default_factory=list)


class CompiledLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location_id: str
    canonical_name: str
    parent_location_id: Optional[str] = Field(None, description="Direct parent container location ID")
    materialized_path: str = Field(..., description="Hierarchical tree path e.g. /andalusia/church/sacristy")
    environment_tags: List[str] = Field(default_factory=list)


class CompiledTimelineTick(BaseModel):
    model_config = ConfigDict(extra="forbid")

    narrative_seq: int = Field(..., ge=1, description="Sequential reading order (1, 2, 3...)")
    story_time_tick: int = Field(..., description="Chronological story timeline tick")
    chapter_index: int
    scene_id: str
    time_type: TimeClueType
    time_delta_hint: Optional[str] = None
    location_id: str
    active_characters: List[str] = Field(default_factory=list)
    active_items: List[str] = Field(default_factory=list)


class CompiledGraphEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    target_id: str
    relationship_type: str
    weight: float = Field(default=1.0)
    narrative_seq: Optional[int] = None


class CompiledBookGraph(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="1.0.0")
    book_id: str
    total_chapters: int
    total_scenes: int
    total_beats: int
    timeline: List[CompiledTimelineTick] = Field(default_factory=list)
    entities: Dict[str, CompiledEntity] = Field(default_factory=dict)
    locations: Dict[str, CompiledLocation] = Field(default_factory=dict)
    edges: List[CompiledGraphEdge] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Layer E: High-Density Visual Storyboard Protocols (80-100 Frames / Chapter)
# ---------------------------------------------------------------------------

class ShotType(str, enum.Enum):
    EXTREME_WIDE_ESTABLISHING = "EXTREME_WIDE_ESTABLISHING"  # 24mm
    WIDE_ESTABLISHING = "WIDE_ESTABLISHING"                  # 28mm
    MEDIUM_TWO_SHOT = "MEDIUM_TWO_SHOT"                      # 35mm
    MEDIUM_SINGLE = "MEDIUM_SINGLE"                          # 50mm
    OVER_THE_SHOULDER = "OVER_THE_SHOULDER"                  # 50mm
    CLOSE_UP_EMOTIONAL = "CLOSE_UP_EMOTIONAL"                # 85mm
    EXTREME_CLOSE_UP = "EXTREME_CLOSE_UP"                    # 85mm macro
    INSERT_PROP_DETAIL = "INSERT_PROP_DETAIL"                # 85mm macro
    LOW_ANGLE_HEROIC = "LOW_ANGLE_HEROIC"                    # 28mm low
    HIGH_ANGLE_VULNERABLE = "HIGH_ANGLE_VULNERABLE"          # 35mm high
    POINT_OF_VIEW = "POINT_OF_VIEW"                          # 35mm eye-level


class CameraLens(str, enum.Enum):
    MM_24 = "24mm anamorphic wide-angle lens"
    MM_28 = "28mm dynamic wide lens"
    MM_35 = "35mm prime cinematic lens"
    MM_50 = "50mm prime portrait lens"
    MM_85 = "85mm prime telephoto lens"


class CharacterFrameState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    handle: str = Field(..., description="Canonical handle e.g. '@CaptainAhab'")
    pose_and_blocking: str = Field(..., description="Physical stance, spatial positioning relative to camera and other entities")
    facial_expression: str = Field(..., description="Exact micro-expression (e.g. grim fury, dilated eyes, tense jaw)")
    gaze_direction: str = Field(..., description="Where eyes are focused (e.g. looking down at the nail on the mast)")
    wardrobe_state: str = Field(..., description="Active state of clothing (e.g. coat whipping in wind, salt-crusted, unbuttoned)")
    held_props: List[str] = Field(default_factory=list, description="Items held in hand during this frame")


class SubSceneFrame(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame_index: int = Field(..., ge=1, le=200, description="Sequential frame number in chapter (1 to 100)")
    scene_id: str = Field(..., description="Parent macro scene identifier e.g. 'sc01'")
    sentence_span: str = Field(..., description="Verbatim 15-25 word excerpt from the novel text")
    char_start: int = Field(..., ge=0, description="Character offset start in chapter markdown")
    char_end: int = Field(..., ge=0, description="Character offset end in chapter markdown")
    shot_type: ShotType = Field(..., description="Cinematographic shot grammar")
    lens: CameraLens = Field(..., description="Focal length")
    lighting_and_atmosphere: str = Field(..., description="Exact lighting key, rim, direction, and atmospheric particles")
    active_characters: List[CharacterFrameState] = Field(default_factory=list, description="Characters visible in frame with posture/gaze")
    spatial_environment_focus: str = Field(..., description="Specific zone of the location in view")
    compiled_image_prompt: str = Field(..., description="Complete production prompt formatted for Imagen 3 / Nano Banana / Flux")


class MacroScene(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(..., description="Unique scene ID e.g. 'sc01'")
    scene_order: int = Field(..., ge=1, description="Order of macro scene in chapter")
    scene_heading: str = Field(..., description="Narrative heading e.g. 'The Golden Doubloon on the Mast'")
    location_handle: str = Field(..., description="Canonical location e.g. '@PequodQuarterDeck'")
    time_of_day: str = Field(..., description="e.g. 'late afternoon brewing storm'")
    summary: str = Field(..., description="2-3 sentence narrative summary")
    sub_scenes: List[SubSceneFrame] = Field(default_factory=list, description="10-20 micro-frames per scene")


class HighDensityChapterStoryboard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default="2.0.0")
    book_id: str
    chapter_index: int
    chapter_title: str
    total_words: int
    total_frames: int = Field(..., ge=1, le=200, description="Total storyboard frames (typically 80 to 100)")
    scenes: List[MacroScene] = Field(default_factory=list)


