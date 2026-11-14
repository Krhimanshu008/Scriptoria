# app/services/phase3_visual/shot_decomposer.py
import math
from enum import Enum
from typing import List, Optional, Dict, Any, Tuple
from uuid import UUID
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core_sources import SourcePassage
from app.models.domain_fiction import FictionScene, FictionShot, ShotParticipant, CameraFraming
from app.services.phase1_core.tick_calculator import BiTemporalTickCalculator
from app.services.phase2_ingestion.beat_chunker import SceneSegmentSpec, BeatPassageSpec


# ============================================================================
# 1. PYDANTIC V2 CINEMATIC STRUCTURED OUTPUT CONTRACTS
# ============================================================================



class LensAndDepthSpec(BaseModel):
    focal_length_mm: int = Field(
        description="Lens focal length in mm: 16 (ultra-wide), 24 (wide), 35 (anamorphic cinema), 50 (natural), 85 (portrait), 100 (macro insert), 135 (telephoto compression)."
    )
    aperture_f_stop: str = Field(
        description="Aperture setting controlling DOF, e.g., 'f/1.4' (razor-thin bokeh), 'f/2.8' (cinematic isolation), 'f/8.0' (deep environmental focus)."
    )
    depth_of_field_profile: str = Field(
        description="Description of foreground/background blur, e.g., 'Shallow DOF isolating protagonist eyes, blurred torchlit background'."
    )
    focus_pull_target: str = Field(
        description="Exact subject or prop locked in tack-sharp focus."
    )


class LightingAndAtmosphereSpec(BaseModel):
    lighting_style: str = Field(
        description="Primary lighting motif: e.g., 'Volumetric god rays', 'High-contrast chiaroscuro', 'Warm torchlight flicker', 'Cold moonlight mist', 'Golden hour rim light'."
    )
    key_light_direction: str = Field(
        description="Direction and color temperature of primary light source, e.g., 'Top-left 45-degree amber firelight'."
    )
    volumetric_and_weather_fx: List[str] = Field(
        default_factory=list,
        description="Atmospheric particles/effects: e.g., ['drifting embers', 'heavy rain streaks', 'swirling ground fog']."
    )
    color_grading_mood: str = Field(
        description="Color palette & emotional tone, e.g., 'Desaturated slate-blue with crimson accents, tense & claustrophobic'."
    )


class CharacterLoadoutBinding(BaseModel):
    character_node_code: str = Field(
        description="Canonical code from core_knowledge.nodes, e.g., 'CHAR-0001'."
    )
    character_node_id: UUID = Field(
        description="UUID of the character node."
    )
    resolved_state_id: UUID = Field(
        description="Exact UUID of core_knowledge.node_states active at this shot's story_tick."
    )
    resolved_state_code: str = Field(
        description="State code, e.g., 'CHAR-0001-S02'."
    )
    active_wardrobe_and_weapons: Dict[str, Any] = Field(
        default_factory=dict,
        description="Snapshot of compiled_specification + equipped slot items locked for this state."
    )
    canvas_blocking_zone: str = Field(
        description="Spatial placement in frame: 'FOREGROUND_LEFT', 'CENTER_HERO', 'FOREGROUND_RIGHT', 'BACKGROUND_LEFT', 'OVER_SHOULDER_FG'."
    )
    pose_and_choreography: str = Field(
        description="Exact physical posture and motion vector in this specific frame."
    )
    facial_micro_expression: str = Field(
        description="Specific eye, brow, and mouth expression, e.g., 'Dilated pupils, clenched jaw, slight grimace'."
    )
    transient_shot_modifiers: List[str] = Field(
        default_factory=list,
        description="Temporary within-shot visual conditions (do not alter canonical DB state): e.g., ['rain-soaked hair', 'unsheathed glowing blade', 'blood spatter on left cheek']."
    )


class CinematicShotSpec(BaseModel):
    shot_number_in_chapter: int = Field(description="Sequential index 1..100 across the chapter.")
    shot_number_in_scene: int = Field(description="Sequential index within the parent scene.")
    source_passage_order: int = Field(description="Links back to the BeatPassageSpec order.")
    narrative_tick: int = Field(description="Deterministic reading-order coordinate.")
    story_tick: int = Field(description="Chronological universe timeline coordinate.")
    camera_framing: CameraFraming
    lens_and_depth: LensAndDepthSpec
    lighting_and_atmosphere: LightingAndAtmosphereSpec
    action_beat: str = Field(
        description="Complete visual choreography describing what the camera sees at this exact instant."
    )
    dialogue_subtitle: Optional[str] = Field(
        default=None,
        description="Exact spoken dialogue line accompanying this shot, if any."
    )
    emotional_tone: str = Field(description="Dominant dramatic emotion of the frame.")
    character_loadouts: List[CharacterLoadoutBinding] = Field(
        default_factory=list,
        description="All characters visible in this shot bound to their exact temporal state."
    )


class SceneDecompositionPlan(BaseModel):
    scene_number: int
    location_node_code: str
    location_node_id: UUID
    environment_state_id: Optional[UUID] = None
    time_of_day: str
    is_flashback: bool
    total_allocated_shots: int
    shots: List[CinematicShotSpec]


# ============================================================================
# 2. MATHEMATICAL PACING & SHOT DENSITY ALLOCATOR
# ============================================================================

class CinematicPacingAllocator:
    """
    Distributes a chapter's target shot budget (e.g., 80-100 shots, default 90)
    across all BeatPassages using Largest-Remainder (Hamilton) allocation weighted
    by word count, combat kinetic intensity, dialogue turn density, and scene anchors.
    """

    def __init__(
        self,
        target_chapter_shots: int = 90,
        min_chapter_shots: int = 80,
        max_chapter_shots: int = 100,
        min_shots_per_beat: int = 2,
        max_shots_per_beat: int = 8,
    ):
        self.target_shots = max(min_chapter_shots, min(max_chapter_shots, target_chapter_shots))
        self.min_per_beat = min_shots_per_beat
        self.max_per_beat = max_shots_per_beat

    def allocate_shot_budgets(self, scenes: List[SceneSegmentSpec]) -> Dict[int, int]:
        """
        Returns a mapping: {passage_order_in_chapter: allocated_shot_count}
        """
        all_beats: List[Tuple[BeatPassageSpec, bool, bool]] = []
        for s in scenes:
            for idx, b in enumerate(s.beats):
                is_first = (idx == 0)
                is_last = (idx == len(s.beats) - 1)
                all_beats.append((b, is_first, is_last))

        num_beats = len(all_beats)
        if num_beats == 0:
            return {}

        avg_words = sum(b[0].word_count for b in all_beats) / float(num_beats)
        raw_weights: Dict[int, float] = {}

        for beat, is_first, is_last in all_beats:
            length_factor = beat.word_count / max(1.0, avg_words)
            intensity_multiplier = 1.0 + (0.85 * beat.kinetic_intensity) + (0.50 * beat.dialogue_intensity)
            anchor_bonus = (0.65 if is_first else 0.0) + (0.30 if is_last else 0.0)
            raw_weights[beat.passage_order_in_chapter] = (length_factor * intensity_multiplier) + anchor_bonus

        total_weight = sum(raw_weights.values())
        exact_quotas: Dict[int, float] = {
            k: (w / total_weight) * self.target_shots for k, w in raw_weights.items()
        }

        # Step 1: Assign integer parts clamped to [min_per_beat, max_per_beat]
        allocations: Dict[int, int] = {}
        remainders: Dict[int, float] = {}

        for k, quota in exact_quotas.items():
            floored = int(math.floor(quota))
            clamped = max(self.min_per_beat, min(self.max_per_beat, floored))
            allocations[k] = clamped
            remainders[k] = quota - floored

        # Step 2: Reconcile difference to hit exact self.target_shots (80-100)
        current_total = sum(allocations.values())
        diff = self.target_shots - current_total

        if diff > 0:
            # Distribute remaining shots to passages with highest remainders that haven't hit max_per_beat
            sorted_keys = sorted(remainders.keys(), key=lambda k: remainders[k], reverse=True)
            while diff > 0:
                progressed = False
                for k in sorted_keys:
                    if allocations[k] < self.max_per_beat and diff > 0:
                        allocations[k] += 1
                        diff -= 1
                        progressed = True
                if not progressed:
                    break
        elif diff < 0:
            # Trim excess shots from passages with smallest remainders above min_per_beat
            sorted_keys = sorted(remainders.keys(), key=lambda k: remainders[k])
            while diff < 0:
                progressed = False
                for k in sorted_keys:
                    if allocations[k] > self.min_per_beat and diff < 0:
                        allocations[k] -= 1
                        diff += 1
                        progressed = True
                if not progressed:
                    break

        return allocations


# ============================================================================
# 3. CINEMATIC SHOT DECOMPOSITION STATE MACHINE
# ============================================================================

class CinematicShotDecomposer:
    """
    Orchestrates the decomposition of Chapter Scenes + Beat Passages into 80-100
    database-locked CinematicShotSpecs, binding each participant to their exact
    bi-temporal state from `core_knowledge.node_states`.
    """

    def __init__(self, session: AsyncSession, llm_structured_client):
        self.session = session
        self.llm = llm_structured_client
        self.allocator = CinematicPacingAllocator(target_chapter_shots=90)

    async def resolve_character_state_at_tick(
        self,
        character_node_id: UUID,
        story_tick: int,
        narrative_tick: int
    ) -> Dict[str, Any]:
        """
        Queries core_knowledge.node_states and domain_fiction.state_loadouts
        to fetch the exact active state and equipment at (story_tick, narrative_tick).
        """
        sql = text("""
            SELECT 
                n.node_code,
                n.canonical_name,
                ns.state_id,
                ns.state_code,
                ns.compiled_specification,
                COALESCE(
                    (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'slot', sl.slot,
                                'item_code', eq_n.node_code,
                                'item_name', eq_n.canonical_name,
                                'item_state_code', eq_ns.state_code,
                                'item_spec', eq_ns.compiled_specification
                            )
                        )
                        FROM domain_fiction.state_loadouts sl
                        JOIN core_knowledge.nodes eq_n ON eq_n.node_id = sl.equipped_node_id
                        JOIN core_knowledge.node_states eq_ns ON eq_ns.state_id = sl.equipped_state_id
                        WHERE sl.holder_state_id = ns.state_id
                    ),
                    '[]'::jsonb
                ) AS equipped_loadout
            FROM core_knowledge.nodes n
            JOIN core_knowledge.node_states ns ON ns.node_id = n.node_id
            WHERE n.node_id = :node_id
              AND ns.valid_from_tick <= :s_tick
              AND (ns.valid_to_tick IS NULL OR ns.valid_to_tick >= :s_tick)
              AND ns.revealed_at_tick <= :n_tick
            ORDER BY ns.valid_from_tick DESC, ns.revealed_at_tick DESC
            LIMIT 1;
        """)
        row = (
            await self.session.execute(
                sql, {"node_id": character_node_id, "s_tick": story_tick, "n_tick": narrative_tick}
            )
        ).mappings().first()

        if not row:
            raise ValueError(
                f"No valid NodeState found for character {character_node_id} at story_tick={story_tick}"
            )

        merged_spec = dict(row["compiled_specification"] or {})
        merged_spec["equipped_loadout"] = row["equipped_loadout"]
        return {
            "character_node_id": character_node_id,
            "character_node_code": row["node_code"],
            "canonical_name": row["canonical_name"],
            "resolved_state_id": row["state_id"],
            "resolved_state_code": row["state_code"],
            "active_wardrobe_and_weapons": merged_spec,
        }

    async def decompose_chapter_into_shots(
        self,
        book_number: int,
        chapter_number: int,
        scenes: List[SceneSegmentSpec],
        db_scenes: List[FictionScene],
        db_passages: List[SourcePassage],
        scene_cast_Ids: Dict[int, List[UUID]],
        scene_location_map: Dict[int, Tuple[UUID, str]],
        starting_story_tick: int,
    ) -> List[SceneDecompositionPlan]:
        """
        Executes the full state machine:
        1. Allocates 80-100 shots across all beat passages.
        2. Computes deterministic narrative_tick & story_tick per shot.
        3. Resolves exact character states & loadouts at each tick.
        4. Invokes LLM Cinematographer with strict shot count & framing grammar.
        5. Persists FictionShot and ShotParticipant records to PostgreSQL.
        """
        shot_budgets = self.allocator.allocate_shot_budgets(scenes)
        passage_lookup = {p.passage_order: p for p in db_passages}
        db_scene_lookup = {s.scene_number: s for s in db_scenes}

        chapter_shot_counter = 1
        current_story_tick = starting_story_tick
        decomposition_plans: List[SceneDecompositionPlan] = []

        for scene_spec in scenes:
            db_scene = db_scene_lookup[scene_spec.scene_number]
            loc_id, loc_code = scene_location_map[scene_spec.scene_number]
            cast_uuids = scene_cast_Ids.get(scene_spec.scene_number, [])

            scene_shots: List[CinematicShotSpec] = []
            scene_shot_counter = 1

            for beat in scene_spec.beats:
                allocated_count = shot_budgets[beat.passage_order_in_chapter]
                db_passage = passage_lookup[beat.passage_order_in_chapter]

                # Pre-calculate coordinates and resolve active character loadouts for this beat
                beat_tick_schedule = []
                for _ in range(allocated_count):
                    n_tick = BiTemporalTickCalculator.compute_narrative_tick(
                        book_number, chapter_number, scene_spec.scene_number, scene_shot_counter
                    )
                    current_story_tick = BiTemporalTickCalculator.compute_linear_story_tick(current_story_tick)
                    beat_tick_schedule.append(
                        {
                            "shot_number_in_chapter": chapter_shot_counter,
                            "shot_number_in_scene": scene_shot_counter,
                            "narrative_tick": n_tick,
                            "story_tick": current_story_tick,
                        }
                    )
                    chapter_shot_counter += 1
                    scene_shot_counter += 1

                # Resolve canonical loadouts at the beat's entry tick
                sample_tick = beat_tick_schedule[0]
                resolved_cast = []
                for char_uuid in cast_uuids:
                    state_bundle = await self.resolve_character_state_at_tick(
                        char_uuid, sample_tick["story_tick"], sample_tick["narrative_tick"]
                    )
                    resolved_cast.append(state_bundle)

                # Generate the exact allocated shots for this Beat Passage via LLM Structured Output
                beat_shots = await self.llm.generate_shots_for_beat(
                    beat_text=beat.text,
                    passage_order=beat.passage_order_in_chapter,
                    tick_schedule=beat_tick_schedule,
                    location_code=loc_code,
                    time_of_day=scene_spec.inferred_time_of_day,
                    resolved_cast=resolved_cast,
                    is_scene_opening=(beat.passage_order_in_scene == 1),
                )

                # Persist generated shots & participant bindings to Supabase
                for shot_spec in beat_shots:
                    db_shot = FictionShot(
                        scene_id=db_scene.scene_id,
                        source_passage_id=db_passage.passage_id,
                        shot_number_in_chapter=shot_spec.shot_number_in_chapter,
                        narrative_tick=shot_spec.narrative_tick,
                        story_tick=shot_spec.story_tick,
                        action_description=shot_spec.action_beat,
                        dialogue_snippet=shot_spec.dialogue_subtitle,
                        shot_type=shot_spec.camera_framing.value,
                        camera_angle=f"{shot_spec.lens_and_depth.focal_length_mm}mm {shot_spec.lens_and_depth.aperture_f_stop} | {shot_spec.lighting_and_atmosphere.lighting_style}",
                        emotional_tone=shot_spec.emotional_tone,
                    )
                    self.session.add(db_shot)
                    await self.session.flush()

                    for loadout in shot_spec.character_loadouts:
                        participant = ShotParticipant(
                            shot_id=db_shot.shot_id,
                            character_node_id=loadout.character_node_id,
                            resolved_state_id=loadout.resolved_state_id,
                            transient_modifiers=loadout.transient_shot_modifiers,
                            pose_action=f"[{loadout.canvas_blocking_zone}] {loadout.pose_and_choreography}",
                            expression=loadout.facial_micro_expression,
                        )
                        self.session.add(participant)

                    scene_shots.append(shot_spec)

            # Update parent scene's exact tick boundaries
            if scene_shots:
                db_scene.location_node_id = loc_id
                db_scene.start_narrative_tick = scene_shots[0].narrative_tick
                db_scene.end_narrative_tick = scene_shots[-1].narrative_tick
                db_scene.start_story_tick = scene_shots[0].story_tick
                db_scene.end_story_tick = scene_shots[-1].story_tick

            decomposition_plans.append(
                SceneDecompositionPlan(
                    scene_number=scene_spec.scene_number,
                    location_node_code=loc_code,
                    location_node_id=loc_id,
                    time_of_day=scene_spec.inferred_time_of_day,
                    is_flashback=scene_spec.is_flashback,
                    total_allocated_shots=len(scene_shots),
                    shots=scene_shots,
                )
            )

        await self.session.flush()
        return decomposition_plans
