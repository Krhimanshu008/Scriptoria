"""Chapter 1 Climax Production Renderer (Shots 006 to 012).

Renders the complete narrative climax of Chapter 1:
- Shot 006: Dystopian lore montage - crumbling skyscrapers under fractured aurora sky (Arrival of the Spell).
- Shot 007: Terrifying shadow of an awakened Nightmare Creature looming over mist.
- Shot 008: Tactical guards in bio-hazard gear escorting Sunny down industrial steel corridor.
- Shot 009: Sunny strapped into the heavy alloy restraint chair with steel wrist cuffs & telemetry electrodes.
- Shot 010: Medical doctors & armed officers observing Sunny behind the thick blast-proof observation glass.
- Shot 011: Extreme close-up of Sunny's face slipping into the deep, irresistible Nightmare slumber.
- Shot 012: The Void awakening with glowing ancient golden runes: "[Aspirant! Welcome to the Nightmare Spell...]".

Dispatches in concurrent pairs across the GPU cluster and downloads to 'output/shots/chapter_001/'.
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.services.phase3_visual.comfyui_client import ComfyClusterClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("chapter1_climax")


async def main():
    client = ComfyClusterClient()
    output_dir = Path("output/shots/chapter_001")
    output_dir.mkdir(parents=True, exist_ok=True)

    gpu0 = settings.COMFYUI_GPU0_URL.rstrip("/")
    gpu1 = settings.COMFYUI_GPU1_URL.rstrip("/")

    logger.info("=== Starting Chapter 1 Climax Production Render (Shots 006–012) ===")

    # Shot 006: Dystopian Lore Montage
    shot_006_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, establishing cinematic wide shot, no humans, futuristic decaying city skyline, "
            "crumbling megastructures under an ominous fractured purple and crimson aurora sky, swirling dimensional mist, "
            "arrival of the supernatural calamity, atmospheric volumetric clouds, moody cinematic lighting"
        ),
        "negative_prompt": "1boy, 1girl, character, person, crowd, worst quality, low quality, blurry",
        "seed": 70601,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "SHOT_006_SPELL_LORE_VISTA",
    }

    # Shot 007: Nightmare Creature Shadow
    shot_007_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, dark fantasy cinematic horror shot, terrifying gargantuan demonic beast silhouette with multiple glowing crimson eyes, "
            "looming through cold ground fog, sharp obsidian claws, nightmare creature manifested from a fallen sleeper, "
            "dramatic chiaroscuro lighting, deep shadows, mist, cinematic dread"
        ),
        "negative_prompt": "cute, cartoon, worst quality, low quality, lowres, blurry, bad anatomy",
        "seed": 70702,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "SHOT_007_NIGHTMARE_BEAST_SHADOW",
    }

    # Shot 008: Tactical Escort Corridor
    shot_008_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, tracking medium shot, 1boy, frail young man in ragged dark clothes with pale skin and messy black hair, "
            "escorted between two heavily armored tactical bio-hazard police guards in dark ballistic armor and tinted respirators, "
            "walking down subterranean industrial concrete corridor with overhead fluorescent tube lighting, cold dystopian atmosphere"
        ),
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, blurry, deformed",
        "seed": 70803,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": "CHAR_SUNNY_FOUNDRY_00001_.png",
        "location_plate_image": "LOC_ISOLATION_CELL_00001_.png",
        "filename_prefix": "SHOT_008_TACTICAL_ESCORT",
    }

    # Shot 009: Restrained in Containment Chair
    shot_009_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, medium close-up, 1boy, frail young man, pale skin, dark circles under sharp onyx eyes, "
            "firmly strapped into a bulky mechanical steel containment chair, heavy alloy magnetic cuffs locking his wrists, "
            "biometric telemetry electrodes attached to temples, cold harsh overhead spotlight, subterranean containment room"
        ),
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, blurry",
        "seed": 70904,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": "CHAR_SUNNY_FOUNDRY_00001_.png",
        "location_plate_image": "LOC_ISOLATION_CELL_00001_.png",
        "filename_prefix": "SHOT_009_RESTRAINED_CHAIR",
    }

    # Shot 010: Observation Window
    shot_010_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, cinematic interior shot from inside containment cell looking out, "
            "thick blast-proof reinforced observation glass window, silhouette of medical doctors in white coats and armed officers "
            "observing the infected patient, glowing biometric telemetry computer screens displaying spiking vital signs, green phosphor readouts"
        ),
        "negative_prompt": "worst quality, low quality, blurry, deformed, cartoon",
        "seed": 71005,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "SHOT_010_OBSERVATION_GLASS",
    }

    # Shot 011: Falling into Sleep
    shot_011_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, extreme close-up of face, 1boy, pale sickly skin, dark onyx eyes half-closed in irresistible heavy slumber, "
            "dark circles under eyes, relaxed mouth, yawning, head leaning back against steel headrest, biometric wire taped to temple, "
            "harsh spotlight falling on pale features, shallow depth of field, 85mm portrait lens, f/1.4 aperture"
        ),
        "negative_prompt": "worst quality, low quality, bad anatomy, bad eyes, blurry, deformed face",
        "seed": 71106,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": "CHAR_SUNNY_FOUNDRY_00001_.png",
        "location_plate_image": "LOC_ISOLATION_CELL_00001_.png",
        "filename_prefix": "SHOT_011_SLUMBER_CLOSEUP",
    }

    # Shot 012: The Void & Spell Voice
    shot_012_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, mysterious dark void, total pitch black darkness, ancient ethereal glowing golden runes and cosmic script "
            "floating in the abyss, sparkling golden light particles, mystical awakening portal, words of the Nightmare Spell echoing in the void, "
            "dramatic contrast, radiant golden glow, epic dark fantasy aesthetic"
        ),
        "negative_prompt": "1boy, 1girl, character, person, text, words, worst quality, low quality, blurry",
        "seed": 71207,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "SHOT_012_SPELL_VOID_AWAKENING",
    }

    # === BATCH 1: Shot 006 (GPU 0) & Shot 007 (GPU 1) ===
    logger.info("--- Dispatching Batch 1: Shot 006 (Lore Vista) & Shot 007 (Creature Shadow) ---")
    r6, r7 = await asyncio.gather(
        client.render_workflow("06_WF_SHOT_ENV.json", shot_006_overrides, target_gpu_url=gpu0, output_dir=output_dir),
        client.render_workflow("06_WF_SHOT_ENV.json", shot_007_overrides, target_gpu_url=gpu1, output_dir=output_dir),
    )
    logger.info(f"Rendered Shot 006: {[str(p) for p in r6]}")
    logger.info(f"Rendered Shot 007: {[str(p) for p in r7]}")

    # === BATCH 2: Shot 008 (GPU 0) & Shot 009 (GPU 1) ===
    logger.info("--- Dispatching Batch 2: Shot 008 (Tactical Escort) & Shot 009 (Restrained Chair) ---")
    r8, r9 = await asyncio.gather(
        client.render_workflow("04_WF_SHOT_SOLO.json", shot_008_overrides, target_gpu_url=gpu0, output_dir=output_dir),
        client.render_workflow("04_WF_SHOT_SOLO.json", shot_009_overrides, target_gpu_url=gpu1, output_dir=output_dir),
    )
    logger.info(f"Rendered Shot 008: {[str(p) for p in r8]}")
    logger.info(f"Rendered Shot 009: {[str(p) for p in r9]}")

    # === BATCH 3: Shot 010 (GPU 0) & Shot 011 (GPU 1) ===
    logger.info("--- Dispatching Batch 3: Shot 010 (Observation Glass) & Shot 011 (Slumber Close-up) ---")
    r10, r11 = await asyncio.gather(
        client.render_workflow("06_WF_SHOT_ENV.json", shot_010_overrides, target_gpu_url=gpu0, output_dir=output_dir),
        client.render_workflow("04_WF_SHOT_SOLO.json", shot_011_overrides, target_gpu_url=gpu1, output_dir=output_dir),
    )
    logger.info(f"Rendered Shot 010: {[str(p) for p in r10]}")
    logger.info(f"Rendered Shot 011: {[str(p) for p in r11]}")

    # === BATCH 4: Shot 012 (GPU 0) ===
    logger.info("--- Dispatching Batch 4: Shot 012 (Spell Void Awakening) ---")
    r12 = await client.render_workflow(
        "06_WF_SHOT_ENV.json", shot_012_overrides, target_gpu_url=gpu0, output_dir=output_dir
    )
    logger.info(f"Rendered Shot 012: {[str(p) for p in r12]}")

    total_climax = r6 + r7 + r8 + r9 + r10 + r11 + r12
    logger.info(f"=== Successfully Rendered All {len(total_climax)} Climax Shots for Chapter 1! ===")


if __name__ == "__main__":
    asyncio.run(main())

