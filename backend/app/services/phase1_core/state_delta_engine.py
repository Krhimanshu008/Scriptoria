"""Temporal State Delta Engine.

Algorithmic engine for detecting timeline events, micro-state changes,
and continuous physical/environmental evolution across novel chapters:
1. Timeline Events:
   - Reader Discovery Tick (Narrative) vs Universe Chronology Tick (Story)
   - Flashbacks, Time-Reversals (e.g. Ch 2 opening), Time-Skips ("3 hours later")
2. Micro-Deltas across 5 Dimensions:
   - Characters: Physical condition, fresh wounds/scars, stamina/fatigue, expression, stance, aspect aura
   - Textiles & Apparel: Garment integrity (0.0-1.0), tears/slashes, blood soaking, mud/grime, frost crust
   - Environment: Sun/moon phase, precipitation, surface condition (snowdrift, blood on stone), lighting tone
   - Locations: Spatial zone advancement (mountain pass -> ledge chokepoint -> sacrificial altar -> cave)
   - Items & Props: Durability, coatings (blood/venom), active magical glow, broken chains/mechanisms
3. Foundry Trigger Classifier:
   - Determines whether a change requires:
     A) New Master Entity Sheet (Brand new person/location/item)
     B) Micro-State Turnaround Sheet (Costume change, severe mutilation, aspect transformation)
     C) Multi-Angle Spatial Kit (New spatial zone or reverse angle)
     D) Transient Prompt Injection Only (Sweat, mild dirt, fleeting emotions)
"""

from __future__ import annotations

import enum
import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class TimelineShiftType(str, enum.Enum):
    LINEAR_PROGRESSION = "LINEAR_PROGRESSION"
    FLASHBACK = "FLASHBACK"
    TIME_REVERSAL = "TIME_REVERSAL"
    TIME_SKIP = "TIME_SKIP"
    PARALLEL_CUT = "PARALLEL_CUT"


class FoundryAction(str, enum.Enum):
    NONE_TRANSIENT_PROMPT_ONLY = "NONE_TRANSIENT_PROMPT_ONLY"
    GENERATE_NEW_MASTER_NODE = "GENERATE_NEW_MASTER_NODE"
    GENERATE_MICRO_TURNAROUND = "GENERATE_MICRO_TURNAROUND"
    GENERATE_LOCATION_ANGLE = "GENERATE_LOCATION_ANGLE"
    GENERATE_ITEM_PROP_SHEET = "GENERATE_ITEM_PROP_SHEET"
    GENERATE_TEXTILE_SHEET = "GENERATE_TEXTILE_SHEET"


class CharacterMicroDelta(BaseModel):
    character_code: str
    physical_condition: str = Field(description="e.g. Malnourished, Shivering, Fatigued, Unconscious")
    fresh_injuries: List[str] = Field(default_factory=list, description="e.g. 'Whip laceration across shoulder blades', 'Bleeding soles'")
    healed_injuries: List[str] = Field(default_factory=list)
    emotional_affect: str = Field(description="e.g. Cold murderous calculation, terror, cynical resignation")
    posture_and_stance: str = Field(description="e.g. Kneeling in snowdrifts, clutching chain, combat crouch")
    aspect_aura: Optional[str] = Field(None, description="e.g. Shimmering golden runes, dormant void, shadow tendril")
    recommended_action: FoundryAction = FoundryAction.NONE_TRANSIENT_PROMPT_ONLY
    action_justification: Optional[str] = None


class TextileApparelDelta(BaseModel):
    worn_by_character: str
    textile_code: str
    garment_type: str = Field(description="e.g. Threadbare hemp slave tunic, Imperial leather cuirass")
    integrity_percentage: float = Field(default=1.0, ge=0.0, le=1.0, description="1.0 pristine, 0.0 destroyed")
    damage_events: List[str] = Field(default_factory=list, description="e.g. 'Sliced open by barbed whip tip'")
    contaminants: List[str] = Field(default_factory=list, description="e.g. 'Fresh blood soaking fabric', 'Crusted frost', 'Mud'")
    recommended_action: FoundryAction = FoundryAction.NONE_TRANSIENT_PROMPT_ONLY


class EnvironmentalDelta(BaseModel):
    location_code: str
    spatial_zone: str = Field(description="e.g. Cliffside path, Caravan center, Abyss precipice, Altar ruins")
    camera_angle_needed: str = Field(description="e.g. ANGLE_A_WIDE, ANGLE_B_REVERSE, ANGLE_C_GROUND, ANGLE_D_MACRO")
    time_of_day: str = Field(description="e.g. Night, Dawn, Void darkness, Storm overcast")
    illumination_source: str = Field(description="e.g. Pale silver moonlight, Crimson strobe alarm, Torchlight")
    weather_state: str = Field(description="e.g. Screaming blizzard wind, Freezing snowdrifts, Stagnant heat")
    surface_condition: str = Field(description="e.g. Weathered cobblestones beneath ice, Pools of dark blood")
    acoustic_ambience: str = Field(description="e.g. Howling mountain gale, clanking iron chains, creature screech")
    recommended_action: FoundryAction = FoundryAction.NONE_TRANSIENT_PROMPT_ONLY


class ItemPropDelta(BaseModel):
    item_code: str
    held_or_worn_by: Optional[str] = None
    physical_integrity: str = Field(description="e.g. Intact, Dented, Cracked, Snapped link, Sharpened")
    surface_coatings: List[str] = Field(default_factory=list, description="e.g. 'Blood stained', 'Frost-rimed', 'Venom dripping'")
    is_active_magical: bool = False
    active_forces: Optional[str] = Field(None, description="e.g. Taut chain dragging boy forward, Whip cracking through air")
    recommended_action: FoundryAction = FoundryAction.NONE_TRANSIENT_PROMPT_ONLY


class TemporalStateDeltaReport(BaseModel):
    """Complete multi-dimensional delta extraction for a narrative beat."""
    chapter_number: int
    passage_order: int
    timeline_shift: TimelineShiftType = TimelineShiftType.LINEAR_PROGRESSION
    elapsed_story_seconds: Optional[int] = Field(default=10, description="Estimated chronological time passed")
    environment: EnvironmentalDelta
    character_deltas: List[CharacterMicroDelta] = Field(default_factory=list)
    textile_deltas: List[TextileApparelDelta] = Field(default_factory=list)
    item_deltas: List[ItemPropDelta] = Field(default_factory=list)
    summary_of_continuity_changes: str
    required_foundry_triggers: List[Dict[str, Any]] = Field(default_factory=list)


class TemporalStateDeltaEngine:
    """
    Analyzes raw chapter prose to extract timeline shifts and micro-state deltas.
    Uses rule-based semantic NLP combined with LLM structured parsing.
    """

    def __init__(self, gemini_client: Optional[Any] = None) -> None:
        self.gemini_client = gemini_client

    def detect_timeline_shift(self, text: str) -> TimelineShiftType:
        """Rule-based heuristic for narrative time jumps, flashbacks, and reversals."""
        t_low = text.lower()
        if "flow of time in reverse" in t_low or "moving backwards" in t_low or "time reversed" in t_low:
            return TimelineShiftType.TIME_REVERSAL
        if "years ago" in t_low or "he remembered" in t_low or "in his childhood" in t_low or "past memory" in t_low:
            return TimelineShiftType.FLASHBACK
        if "hours later" in t_low or "the next morning" in t_low or "days passed" in t_low or "by sunrise" in t_low:
            return TimelineShiftType.TIME_SKIP
        return TimelineShiftType.LINEAR_PROGRESSION

    def extract_state_deltas_heuristic(
        self,
        chapter_number: int,
        passage_order: int,
        text: str,
        active_character_codes: List[str],
        current_location_code: str = "LOC-SHACKLE-MOUNTAIN-PASS",
    ) -> TemporalStateDeltaReport:
        """
        Fast deterministic heuristic extractor for timeline and entity state evolution.
        Runs when LLM API is offline or as pre-filtering step.
        """
        shift_type = self.detect_timeline_shift(text)
        t_low = text.lower()

        # 1. Environment extraction
        time_of_day = "Night"
        if "sunrise" in t_low or "dawn" in t_low:
            time_of_day = "Dawn"
        elif "midday" in t_low or "sun beat down" in t_low:
            time_of_day = "Midday"
        elif "black" in t_low and "darkness" in t_low:
            time_of_day = "Void Darkness"

        weather = "Freezing blizzard wind gusts and snowdrifts"
        if "strong winds" in t_low or "biting wind" in t_low:
            weather = "Howling blizzard mountain gale"

        spatial_zone = "Cliffside mountain trail"
        cam_angle = "ANGLE_C_GROUND_LEVEL"
        if "dwarfed other peaks" in t_low or "cutting the night sky" in t_low:
            cam_angle = "ANGLE_A_WIDE_ESTABLISHING"
            spatial_zone = "Solitary mountain peak vista"
        elif "abyss" in t_low or "sea of nothingness" in t_low:
            cam_angle = "ANGLE_D_TEXTURE_MACRO"
            spatial_zone = "Precipice over black abyss"
        elif "down the mountain" in t_low or "looking back" in t_low:
            cam_angle = "ANGLE_B_REVERSE_OPPOSITE"
            spatial_zone = "Descending mountain road"

        env = EnvironmentalDelta(
            location_code=current_location_code,
            spatial_zone=spatial_zone,
            camera_angle_needed=cam_angle,
            time_of_day=time_of_day,
            illumination_source="Radiant ghostly pale moonlight" if time_of_day == "Night" else "Cold overcast",
            weather_state=weather,
            surface_condition="Weathered flagstones under patchy snowdrifts",
            acoustic_ambience="Howling gale, rattling iron chains, groans of shivering slaves",
            recommended_action=FoundryAction.NONE_TRANSIENT_PROMPT_ONLY,
        )

        # 2. Character Deltas
        char_deltas = []
        textile_deltas = []
        item_deltas = []
        foundry_triggers = []

        if "CHAR-SUNNY" in active_character_codes or "sunny" in t_low or "sunless" in t_low:
            injuries = []
            if "bleeding feet" in t_low:
                injuries.append("Raw bleeding soles from frozen rocks")
            if "wrists were the main source of agony" in t_low or "broken skin" in t_low:
                injuries.append("Rusted iron cuffs biting into raw swollen wrists")
            if "whip cracked" in t_low or "drew blood" in t_low or "tasting my whip" in t_low:
                injuries.append("Severe bleeding diagonal whip laceration across shoulder blades")

            affect = "Exhausted calculation and cold malice"
            if "kill you first" in t_low:
                affect = "Cold murderous malice, lethal focus"
            elif "what kind of a situation" in t_low:
                affect = "Bewildered shock and desperation"

            posture = "Stumbling in snow, shivering violently"
            if "on the ground" in t_low or "stumbled" in t_low:
                posture = "Kneeling on hands and knees in snowdrift, clutching chain"

            # Check if major injury triggers micro-turnaround
            char_action = FoundryAction.NONE_TRANSIENT_PROMPT_ONLY
            if "whip cracked" in t_low and "drew blood" in t_low:
                char_action = FoundryAction.GENERATE_MICRO_TURNAROUND
                foundry_triggers.append({
                    "type": "MICRO_TURNAROUND",
                    "entity": "CHAR-SUNNY",
                    "reason": "Sustained severe whipped back laceration and torn tunic; permanent visual change",
                })

            char_deltas.append(CharacterMicroDelta(
                character_code="CHAR-SUNNY",
                physical_condition="Severely malnourished, shivering from freezing blizzard, bleeding",
                fresh_injuries=injuries,
                emotional_affect=affect,
                posture_and_stance=posture,
                aspect_aura="Shimmering ancient golden runes [Aspect: Temple Slave]" if "aspect" in t_low else None,
                recommended_action=char_action,
                action_justification="Severe injury and torn clothing" if char_action != FoundryAction.NONE_TRANSIENT_PROMPT_ONLY else None,
            ))

            # Textile delta
            garment_integrity = 0.8
            damages = []
            contaminants = ["Mud and grime from road", "Frost accumulation on collar"]
            if "whip that sliced the back of sunny's tunic open" in t_low or "sliced the back" in t_low:
                garment_integrity = 0.45
                damages.append("Tunic slashed open across back exposing bleeding skin")
                contaminants.append("Dark crimson blood soaking through burlap weave")
                foundry_triggers.append({
                    "type": "TEXTILE_DAMAGE",
                    "entity": "TEXTILE-SLAVE-BURLAP",
                    "reason": "Tunic sliced by whip with blood staining; update prompt modifier",
                })

            textile_deltas.append(TextileApparelDelta(
                worn_by_character="CHAR-SUNNY",
                textile_code="TEXTILE-SLAVE-BURLAP",
                garment_type="Threadbare coarse hemp slave tunic",
                integrity_percentage=garment_integrity,
                damage_events=damages,
                contaminants=contaminants,
                recommended_action=FoundryAction.NONE_TRANSIENT_PROMPT_ONLY,
            ))

        # 3. Item Deltas
        if "chain" in t_low or "shackles" in t_low:
            item_deltas.append(ItemPropDelta(
                item_code="ITEM-IRON-SLAVE-SHACKLES",
                held_or_worn_by="CHAR-SUNNY",
                physical_integrity="Intact but rusted and frozen",
                surface_coatings=["Frost rimed", "Smears of fresh blood from broken wrists"],
                is_active_magical=False,
                active_forces="Heavy iron chain dragging downward with column momentum",
                recommended_action=FoundryAction.NONE_TRANSIENT_PROMPT_ONLY,
            ))

        if "flask" in t_low or "canteen" in t_low or "water" in t_low:
            item_deltas.append(ItemPropDelta(
                item_code="ITEM-SOLDIER-WATER-FLASK",
                held_or_worn_by="CHAR-HERO-SOLDIER",
                physical_integrity="Hammered bronze canteen with leather strap",
                surface_coatings=["Pristine oiled leather patina"],
                is_active_magical=False,
                active_forces="Extended outward by young soldier toward boy",
                recommended_action=FoundryAction.NONE_TRANSIENT_PROMPT_ONLY,
            ))

        if "whip" in t_low:
            item_deltas.append(ItemPropDelta(
                item_code="ITEM-PUNISHMENT-WHIP",
                held_or_worn_by="CHAR-VETERAN-SOLDIER",
                physical_integrity="Braided heavy black leather scourge with barbed iron tip",
                surface_coatings=["Dripping fresh blood drops in cold air"],
                is_active_magical=False,
                active_forces="Cracking viciously through freezing mountain wind",
                recommended_action=FoundryAction.NONE_TRANSIENT_PROMPT_ONLY,
            ))

        summary = (
            f"Beat {passage_order}: Shift={shift_type.value}, Time={time_of_day}, Zone={spatial_zone}, "
            f"Active Characters={len(char_deltas)}, Active Items={len(item_deltas)}, Triggers={len(foundry_triggers)}"
        )

        return TemporalStateDeltaReport(
            chapter_number=chapter_number,
            passage_order=passage_order,
            timeline_shift=shift_type,
            elapsed_story_seconds=15,
            environment=env,
            character_deltas=char_deltas,
            textile_deltas=textile_deltas,
            item_deltas=item_deltas,
            summary_of_continuity_changes=summary,
            required_foundry_triggers=foundry_triggers,
        )

