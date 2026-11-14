# app/services/phase3_visual/prompt_compiler.py
"""
5-Layer Cinematic Visual Production Compiler.
Compiles high-level narrative beats, character state DNA, camera specifications,
and lighting into ready-to-render ComfyUI workflows and prompt dictionaries.
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from enum import Enum

from app.services.phase3_visual.shot_decomposer import CinematicShotSpec, CameraFraming


class WorkflowType(str, Enum):
    TEXT_TO_IMAGE = "TEXT_TO_IMAGE"
    INPAINT_SURGICAL = "INPAINT_SURGICAL"
    CHARACTER_REFERENCE_SHEET = "CHARACTER_REFERENCE_SHEET"


class ComfyUIPromptPayload(BaseModel):
    """Execution contract for ComfyUI headless image rendering."""
    shot_number_in_chapter: int
    narrative_tick: int
    story_tick: int
    workflow_type: WorkflowType
    aspect_ratio: str = "16:9"
    width: int = 1344
    height: int = 768
    seed: int
    steps: int = 30
    cfg_scale: float = 7.0
    sampler_name: str = "dpmpp_2m_karras"
    positive_prompt: str
    negative_prompt: str
    denoise: float = 1.0
    lora_tags: List[str] = Field(default_factory=list)
    controlnet_hints: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class CinematicPromptCompiler:
    """
    Transforms structured shot specifications and character DNA into rich,
    photorealistic prompts formatted for SDXL, Flux, or SD 1.5 pipelines.
    """

    DEFAULT_NEGATIVE_PROMPT = (
        "blurry, out of focus, low quality, deformed anatomy, bad hands, extra limbs, "
        "missing fingers, mutated eyes, oversaturated, modern clothing, modern accessories, "
        "sunglasses, digital artifacts, text, watermark, signature, cartoon, 3d render"
    )

    FRAMING_PROMPT_MAP = {
        CameraFraming.EXTREME_WIDE_ESTABLISHING: "extreme wide establishing cinema shot, distant vista, grand scale environment, tiny subject in massive scale",
        CameraFraming.WIDE_MASTER: "wide master shot, environmental context, full body composition, cinematic framing",
        CameraFraming.MEDIUM_FULL: "medium full shot, knees-up composition, balanced character and environmental presence",
        CameraFraming.COWBOY_SHOT: "cowboy shot, waist-up composition, western hero framing, clear weapon visibility",
        CameraFraming.MEDIUM_CLOSE_UP: "medium close-up, chest-up composition, intimate cinematic drama, focused emotional gravity",
        CameraFraming.CLOSE_UP: "intense close-up portrait, shallow depth of field, razor-sharp focus on facial micro-expressions and eyes",
        CameraFraming.EXTREME_CLOSE_UP_INSERT: "macro extreme close-up insert, hyper-detailed focal texture, tach-sharp macro cinematography",
        CameraFraming.OVER_THE_SHOULDER: "over-the-shoulder shot, shallow foreground shoulder blur, deep dramatic dialogue staging",
        CameraFraming.LOW_ANGLE_HERO: "low-angle hero shot, upward perspective, monumental power dynamic, commanding presence",
        CameraFraming.HIGH_ANGLE_VULNERABLE: "high-angle downshot, looking down, vulnerable isolated composition, oppressive atmospheric weight",
        CameraFraming.DUTCH_ANGLE_TENSION: "dutch angle tilted horizon, off-kilter dynamic tension, psychological disorientation, diagonal energy",
        CameraFraming.POV_FIRST_PERSON: "first-person point-of-view shot, subjective camera, foreground hands in combat frame",
    }

    @classmethod
    def compile_shot_payload(
        cls,
        shot_spec: CinematicShotSpec,
        workflow_type: WorkflowType = WorkflowType.TEXT_TO_IMAGE,
        custom_negative_purge: Optional[str] = None,
        inpaint_denoise: float = 0.60,
    ) -> ComfyUIPromptPayload:
        """
        Compiles the 5 visual context layers:
          Layer 1: Subject / Character Visual DNA
          Layer 2: Environment & World Architecture
          Layer 3: Composition, Lens & Depth of Field
          Layer 4: Lighting, Color Palette & Atmosphere
          Layer 5: Transient Choreography & Action FX
        """
        prompt_parts: List[str] = []

        # --- Layer 3: Composition & Lens Grammar ---
        framing_text = cls.FRAMING_PROMPT_MAP.get(
            shot_spec.camera_framing,
            "cinematic shot, 35mm anamorphic film capture"
        )
        lens_text = (
            f"({framing_text}:1.2), {shot_spec.lens_and_depth.focal_length_mm}mm lens, "
            f"{shot_spec.lens_and_depth.aperture_f_stop}, {shot_spec.lens_and_depth.depth_of_field_profile}, "
            f"tack-sharp focus on {shot_spec.lens_and_depth.focus_pull_target}"
        )
        prompt_parts.append(lens_text)

        # --- Layer 1: Subject / Character DNA & Loadouts ---
        character_prompts = []
        lora_tags = []
        for loadout in shot_spec.character_loadouts:
            char_desc = (
                f"{loadout.character_node_code} on {loadout.canvas_blocking_zone}, "
                f"micro-expression: {loadout.facial_micro_expression}, "
                f"wearing {', '.join(loadout.active_wardrobe_and_weapons.get('wardrobe', ['practical attire']))}, "
                f"wielding {', '.join(loadout.active_wardrobe_and_weapons.get('weapons', ['unarmed']))}"
            )
            if loadout.transient_shot_modifiers:
                char_desc += f", with {', '.join(loadout.transient_shot_modifiers)}"
            character_prompts.append(char_desc)
            if "lora_trigger" in loadout.active_wardrobe_and_weapons:
                lora_tags.append(loadout.active_wardrobe_and_weapons["lora_trigger"])

        if character_prompts:
            prompt_parts.append(" | ".join(character_prompts))

        # --- Layer 5: Action Choreography & Dynamics ---
        action_text = f"action beat: {shot_spec.action_beat}"
        prompt_parts.append(action_text)

        # --- Layer 4: Lighting & Atmosphere ---
        lighting = shot_spec.lighting_and_atmosphere
        lighting_text = (
            f"{lighting.lighting_style}, key light direction: {lighting.key_light_direction}, "
            f"atmosphere: {', '.join(lighting.volumetric_and_weather_fx)}, "
            f"color grading: {lighting.color_grading_mood}"
        )
        prompt_parts.append(lighting_text)

        # --- Layer 2: Master Cinematic Production Aesthetic ---
        production_text = (
            "masterpiece cinematic film still, shot on ARRI Alexa 65, Panavision Ultra Vista lenses, "
            "subtle film grain, volumetric god rays, hyper-detailed skin pores and fabric weave, photorealistic 8k"
        )
        prompt_parts.append(production_text)

        positive_prompt = ", ".join(prompt_parts)

        # Assemble negative prompt with retcon purge words
        negative_prompt = cls.DEFAULT_NEGATIVE_PROMPT
        if custom_negative_purge:
            negative_prompt = f"({custom_negative_purge}:1.4), {negative_prompt}"

        # Deterministic seed from narrative tick for reproducibility
        deterministic_seed = abs(hash(str(shot_spec.narrative_tick))) % (2**31 - 1)

        # Aspect ratio dimensions (16:9 widescreen: 1344x768)
        width, height = (1344, 768)
        denoise_val = inpaint_denoise if workflow_type == WorkflowType.INPAINT_SURGICAL else 1.0

        return ComfyUIPromptPayload(
            shot_number_in_chapter=shot_spec.shot_number_in_chapter,
            narrative_tick=shot_spec.narrative_tick,
            story_tick=shot_spec.story_tick,
            workflow_type=workflow_type,
            aspect_ratio="16:9",
            width=width,
            height=height,
            seed=deterministic_seed,
            steps=30,
            cfg_scale=7.0,
            positive_prompt=positive_prompt,
            negative_prompt=negative_prompt,
            denoise=denoise_val,
            lora_tags=lora_tags,
            metadata={
                "emotional_tone": shot_spec.emotional_tone,
                "dialogue_subtitle": shot_spec.dialogue_subtitle,
                "camera_framing": shot_spec.camera_framing.value,
            },
        )
