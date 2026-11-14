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
