# app/services/phase1_core/retcon_repair.py
from enum import Enum
from typing import List, Optional, Dict, Set
from uuid import UUID
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core_knowledge import KnowledgeNode
from app.models.domain_fiction import FictionShot, ShotParticipant, CameraFraming


class RetconTriageDecision(str, Enum):
    REQUIRES_TARGETED_INPAINT = "REQUIRES_TARGETED_INPAINT"
    REQUIRES_FULL_CHARACTER_PASS = "REQUIRES_FULL_CHARACTER_PASS"
    SKIP_NOT_VISIBLE_AT_SCALE = "SKIP_NOT_VISIBLE_AT_SCALE"


class ComfyUIInpaintingTask(BaseModel):
    shot_id: UUID
    shot_number_in_chapter: int
    narrative_tick: int
    story_tick: int
    camera_framing: str
    character_node_id: UUID
    character_node_code: str
    resolved_state_id: Optional[UUID]
    triage_decision: RetconTriageDecision

    # Retcon Provenance
    retconned_attribute: str
    superseded_value: str
    new_canonical_value: str

    # Surgical ComfyUI SAM2 / GroundingDINO + KSampler Inpaint Directives
    sam2_segmentation_prompt: str = Field(
        description="Target mask prompt for GroundingDINO/SAM2 node in ComfyUI, e.g., 'eyes, iris' or 'hair' or 'armor torso'."
    )
    mask_dilation_px: int = Field(
        default=8,
        description="Pixelfeather/dilation radius around the segmented mask."
    )
    recommended_denoise: float = Field(
        description="KSampler denoise strength (0.40-0.50 for color/iris shifts; 0.60-0.75 for structural prop/scar/outfit changes)."
    )
    inpaint_positive_prompt_delta: str = Field(
        description="Prompt tokens injected into the masked region conditioning."
    )
    inpaint_negative_prompt_purge: str = Field(
        description="Superseded visual traits injected into Negative Conditioning to force removal."
    )


# --- Visibility & Segmentation Heuristics Matrix ---
ATTRIBUTE_VISIBILITY_RULES: Dict[str, Dict[str, any]] = {
    "eye_color": {
        "visible_framings": {
            CameraFraming.EXTREME_CLOSE_UP_INSERT.value,
            CameraFraming.CLOSE_UP.value,
            CameraFraming.MEDIUM_CLOSE_UP.value,
            CameraFraming.LOW_ANGLE_HERO.value,
            CameraFraming.HIGH_ANGLE_VULNERABLE.value,
            CameraFraming.DUTCH_ANGLE_TENSION.value,
            CameraFraming.OVER_THE_SHOULDER.value,
        },
        "sam2_prompt": "character eyes, iris, pupils",
        "dilation_px": 6,
        "denoise": 0.44,
    },
    "facial_scar": {
        "visible_framings": {
            CameraFraming.EXTREME_CLOSE_UP_INSERT.value,
            CameraFraming.CLOSE_UP.value,
            CameraFraming.MEDIUM_CLOSE_UP.value,
            CameraFraming.COWBOY_SHOT.value,
            CameraFraming.LOW_ANGLE_HERO.value,
            CameraFraming.HIGH_ANGLE_VULNERABLE.value,
            CameraFraming.DUTCH_ANGLE_TENSION.value,
        },
        "sam2_prompt": "character face, cheek, brow",
        "dilation_px": 10,
        "denoise": 0.58,
    },
    "hair_color": {
        "visible_framings": {
            f.value for f in CameraFraming if f != CameraFraming.POV_FIRST_PERSON
        },
        "sam2_prompt": "character hair, bangs, locks",
        "dilation_px": 12,
        "denoise": 0.52,
    },
    "hair_style": {
        "visible_framings": {
            f.value for f in CameraFraming
            if f not in {CameraFraming.EXTREME_WIDE_ESTABLISHING, CameraFraming.POV_FIRST_PERSON}
        },
        "sam2_prompt": "character hair, head silhouette",
        "dilation_px": 18,
        "denoise": 0.65,
    },
    "outfit": {
        "visible_framings": {
            f.value for f in CameraFraming
            if f not in {CameraFraming.EXTREME_CLOSE_UP_INSERT, CameraFraming.POV_FIRST_PERSON}
        },
        "sam2_prompt": "character clothing, tunic, armor, torso",
        "dilation_px": 16,
        "denoise": 0.68,
    },
}


class RetconRepairEngine:
    """
    Traverses historical shots backwards in time when a canonical retcon occurs,
    triages each shot by camera framing scale and visibility, and builds surgical
    ComfyUI Inpainting payloads.
    """

    def __init__(self, session: AsyncSession):
        self.session = session

    async def generate_retroactive_inpaint_queue(
        self,
        character_node_id: UUID,
        retconned_attribute: str,
        superseded_value: str,
        new_canonical_value: str,
        discovery_narrative_tick: int,
        valid_from_story_tick: int = 0,
        valid_to_story_tick: Optional[int] = None,
    ) -> List[ComfyUIInpaintingTask]:
        """
        Finds all historical shots rendered prior to `discovery_narrative_tick`
        where `character_node_id` participated during the chronological window
        `[valid_from_story_tick, valid_to_story_tick]`.
        """
        node = await self.session.get(KnowledgeNode, character_node_id)
        if not node:
            raise ValueError(f"Character node {character_node_id} not found.")

        # 1. Backward Bi-Temporal Join across domain_fiction.shot_participants & domain_fiction.shots
        stmt = (
            select(FictionShot, ShotParticipant)
            .join(ShotParticipant, ShotParticipant.shot_id == FictionShot.shot_id)
            .where(
                ShotParticipant.character_node_id == character_node_id,
                FictionShot.narrative_tick < discovery_narrative_tick,
                FictionShot.story_tick >= valid_from_story_tick,
            )
            .order_by(FictionShot.narrative_tick.asc())
        )

        if valid_to_story_tick is not None:
            stmt = stmt.where(FictionShot.story_tick <= valid_to_story_tick)

        rows = (await self.session.execute(stmt)).all()

        # 2. Fetch visibility & segmentation rules for the retconned attribute
        attr_key = retconned_attribute.lower().strip()
        rule = ATTRIBUTE_VISIBILITY_RULES.get(
            attr_key,
            {
                "visible_framings": {
                    f.value for f in CameraFraming
                    if f not in {CameraFraming.EXTREME_WIDE_ESTABLISHING, CameraFraming.POV_FIRST_PERSON}
                },
                "sam2_prompt": f"character {attr_key}",
                "dilation_px": 12,
                "denoise": 0.60,
            },
        )
        visible_set: Set[str] = rule["visible_framings"]

        tasks: List[ComfyUIInpaintingTask] = []

        for shot, participant in rows:
            framing = shot.shot_type or CameraFraming.MEDIUM_FULL.value

            # Check if transient modifiers in that specific shot hid the feature (e.g., helmet/blindfold)
            raw_mods = getattr(participant, "transient_modifiers", None) or []
            modifiers_lower = " ".join(raw_mods).lower()
            is_occluded = (
                (attr_key == "eye_color" and ("eyes closed" in modifiers_lower or "blindfold" in modifiers_lower))
                or (attr_key in {"hair_color", "hair_style"} and "full helmet" in modifiers_lower)
            )

            if framing not in visible_set or is_occluded:
                decision = RetconTriageDecision.SKIP_NOT_VISIBLE_AT_SCALE
            elif attr_key in {"outfit", "armor"} and framing in {CameraFraming.WIDE_MASTER.value, CameraFraming.MEDIUM_FULL.value}:
                decision = RetconTriageDecision.REQUIRES_FULL_CHARACTER_PASS
            else:
                decision = RetconTriageDecision.REQUIRES_TARGETED_INPAINT

            pos_delta = (
                f"{node.canonical_name} with {new_canonical_value} ({attr_key.replace('_', ' ')}), "
                f"{participant.expression or 'neutral expression'}, high detail"
            )
            neg_purge = f"{superseded_value}, {superseded_value} {attr_key.replace('_', ' ')}"

            tasks.append(
                ComfyUIInpaintingTask(
                    shot_id=shot.shot_id,
                    shot_number_in_chapter=shot.shot_number_in_chapter,
                    narrative_tick=shot.narrative_tick,
                    story_tick=shot.story_tick,
                    camera_framing=framing,
                    character_node_id=character_node_id,
                    character_node_code=node.node_code,
                    resolved_state_id=participant.resolved_state_id,
                    triage_decision=decision,
                    retconned_attribute=attr_key,
                    superseded_value=superseded_value,
                    new_canonical_value=new_canonical_value,
                    sam2_segmentation_prompt=rule["sam2_prompt"],
                    mask_dilation_px=rule["dilation_px"],
                    recommended_denoise=rule["denoise"],
                    inpaint_positive_prompt_delta=pos_delta,
                    inpaint_negative_prompt_purge=neg_purge,
                )
            )

        return tasks
