"""Production Batch Renderer for Chapter 2: Slave Caravan.

Renders sequential cinematic shots across Kaggle GPU 0 & GPU 1:
- Shot 001: Solitary jagged mountain peak cutting night sky under radiant pale moon (WF06 Env)
- Shot 002: Serpentine slave column marching along narrow cliff road over black abyss (WF06 Env)
- Shot 003: Sunny shivering in ragged slave tunic, frozen iron shackles on raw wrists (WF04 Solo)
- Shot 004: Shimmering ancient golden runes hovering in air: Aspect [Temple Slave] (WF04 Solo)
- Shot 005: Young noble soldier on white horse offering his water canteen (WF04 Solo)
- Shot 006: Cruel older soldier cracking the whip across Sunny's back, spray of blood & snow (WF04 Solo)

Downloads rendered frames to 'output/shots/chapter_002/' and mirrors them to the artifacts directory.
"""

import asyncio
import logging
import os
import shutil
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.services.phase3_visual.comfyui_client import ComfyClusterClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("ch2_renderer")

ARTIFACT_DIR = Path(r"C:\Users\5480\.gemini\antigravity\brain\03f3bb64-c295-4aff-a73b-3d8e6b9392e1\output_foundry")


async def render_shot(client: ComfyClusterClient, template: str, overrides: dict, target_gpu: str, out_dir: Path) -> Path:
    logger.info(f"Dispatching {overrides['filename_prefix']} to {target_gpu}...")
    files = await client.render_workflow(
        template_name=template,
        overrides=overrides,
        target_gpu_url=target_gpu,
        output_dir=out_dir,
    )
    if not files:
        raise RuntimeError(f"No output returned for {overrides['filename_prefix']}")
    shot_path = files[0]
    logger.info(f"Finished {overrides['filename_prefix']}: {shot_path}")

    # Mirror to artifact directory
    shutil.copy(shot_path, ARTIFACT_DIR / shot_path.name)
    return shot_path


async def main():
    logger.info("=== Starting Chapter 2 Batch Production Render ===")
    client = ComfyClusterClient()
    output_dir = Path("output/shots/chapter_002")
    output_dir.mkdir(parents=True, exist_ok=True)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    gpu0 = settings.COMFYUI_GPU0_URL.rstrip("/")
    gpu1 = settings.COMFYUI_GPU1_URL.rstrip("/")

    ref_char = "CHAR_SUNNY_SLAVE_FOUNDRY_00001_.png"
    ref_loc = "LOC_SHACKLE_MOUNTAIN_PASS_00001_.png"

    # --- BATCH 1: Shots 001 & 002 (Environment & Atmosphere) ---
    shot_001_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, cinematic landscape, extreme wide establishing shot, no humans, "
            "towering jagged solitary mountain peak cutting the dark night sky, surrounded by massive radiant pale full moon, "
            "ghostly silver moonlight casting dramatic shadows over icy slopes and jagged crags, blizzard winds, ethereal and cold"
        ),
        "negative_prompt": "1boy, 1girl, character, person, crowd, worst quality, low quality, bad anatomy, blurry",
        "seed": 92001,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "CH2_SHOT_001_MOUNTAIN_PEAK",
    }

    shot_002_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, cinematic wide shot, ancient weathered stone road clinging stubbornly to sheer vertical cliff, "
            "snowdrifts and freezing blizzard wind, black bottomless abyss on left side, long serpentine line of chained hollow-eyed slaves "
            "trudging backwards through snow, armed imperial horsemen riding along the column, eerie moonlight"
        ),
        "negative_prompt": "worst quality, low quality, bad anatomy, deformed, modern clothes, cars, neon",
        "seed": 92002,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "CH2_SHOT_002_SLAVE_COLUMN_MARCH",
    }

    logger.info(">>> Launching Batch 1: Shot 001 on GPU 0 & Shot 002 on GPU 1...")
    t1 = asyncio.create_task(render_shot(client, "06_WF_SHOT_ENV.json", shot_001_overrides, gpu0, output_dir))
    t2 = asyncio.create_task(render_shot(client, "06_WF_SHOT_ENV.json", shot_002_overrides, gpu1, output_dir))
    await asyncio.gather(t1, t2)
    logger.info("✓ Batch 1 completed successfully!")

    # --- BATCH 2: Shots 003 & 004 (Sunny Shivering & Temple Slave Status Runes) ---
    shot_003_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, low-angle medium shot, 1boy, frail 16yo youth, pale skin, messy black hair, "
            "dark exhausted eyes, wearing threadbare hemp slave tunic, bare bleeding feet walking in snow, "
            "heavy rusted iron wrist shackles clamped tight on raw skin, shivering violently against biting blizzard wind, 35mm lens"
        ),
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, modern clothes, blurry",
        "seed": 92003,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": ref_char,
        "location_plate_image": ref_loc,
        "filename_prefix": "CH2_SHOT_003_SUNNY_BLEEDING_CHAINS",
    }

    shot_004_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, over-the-shoulder medium close-up, 1boy, pale youth with messy black hair, "
            "wide stunned onyx eyes, looking at glowing translucent golden ancient runes floating in mid-air in front of him, "
            "mystical runic status screen shimmering in the dark mountain night, Aspect Temple Slave text, magical glow reflecting on face"
        ),
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, blurry",
        "seed": 92004,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": ref_char,
        "location_plate_image": ref_loc,
        "filename_prefix": "CH2_SHOT_004_TEMPLE_SLAVE_RUNES",
    }

    logger.info(">>> Launching Batch 2: Shot 003 on GPU 0 & Shot 004 on GPU 1...")
    t3 = asyncio.create_task(render_shot(client, "04_WF_SHOT_SOLO.json", shot_003_overrides, gpu0, output_dir))
    t4 = asyncio.create_task(render_shot(client, "04_WF_SHOT_SOLO.json", shot_004_overrides, gpu1, output_dir))
    await asyncio.gather(t3, t4)
    logger.info("✓ Batch 2 completed successfully!")

    # --- BATCH 3: Shots 005 & 006 (Young Guard Water Flask & The Cruel Whip Strike) ---
    shot_005_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, medium two-shot, handsome noble young imperial soldier with noble features, "
            "wearing leather cuirass and simple helmet, mounted on pure white warhorse, looking down with pity and extending "
            "a leather water canteen toward a frail young black-haired slave boy in ragged tunic, snowy mountain pass background"
        ),
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, blurry",
        "seed": 92005,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": ref_char,
        "location_plate_image": ref_loc,
        "filename_prefix": "CH2_SHOT_005_HERO_SOLDIER_WATER",
    }

    shot_006_overrides = {
        "positive_prompt": (
            "masterpiece, best quality, high-intensity cinematic action shot, harsh older scarred veteran soldier on dark warhorse "
            "cracking a heavy barbed leather whip through the air, whip tip striking across the back of frail slave boy, "
            "torn tunic and spray of blood drops in freezing air, violent impact, snowy mountain blizzard, dramatic motion blur"
        ),
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, blurry",
        "seed": 92006,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": ref_char,
        "location_plate_image": ref_loc,
        "filename_prefix": "CH2_SHOT_006_WHIP_STRIKE_CLIMAX",
    }

    logger.info(">>> Launching Batch 3: Shot 005 on GPU 0 & Shot 006 on GPU 1...")
    t5 = asyncio.create_task(render_shot(client, "04_WF_SHOT_SOLO.json", shot_005_overrides, gpu0, output_dir))
    t6 = asyncio.create_task(render_shot(client, "04_WF_SHOT_SOLO.json", shot_006_overrides, gpu1, output_dir))
    await asyncio.gather(t5, t6)
    logger.info("✓ Batch 3 completed successfully!")

    logger.info("=== All 6 Chapter 2 Production Shots Rendered and Verified Successfully! ===")


if __name__ == "__main__":
    asyncio.run(main())

