"""Batch Production Renderer for Chapter 1 Sequence.

Renders key sequential shots for Scene 1 using our multi-GPU cluster:
- Shot 002: Extreme close-up of paper coffee cup in Sunny's hands, steam rising, rain-slicked pavement.
- Shot 003: Wide angle of Sunny pushing open the doors into the police station lobby.
- Shot 004: Medium close-up of Duty Officer at his terminal looking up with tired skepticism.
- Shot 005: Dramatic two-shot (WF05) / reaction as Code Black alarm flashes red across the lobby.

Dispatches concurrently across GPU 0 and GPU 1, downloads output to 'output/shots/chapter_001/'.
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
logger = logging.getLogger("batch_renderer")


async def main():
    client = ComfyClusterClient()
    output_dir = Path("output/shots/chapter_001")
    output_dir.mkdir(parents=True, exist_ok=True)

    gpu0 = settings.COMFYUI_GPU0_URL.rstrip("/")
    gpu1 = settings.COMFYUI_GPU1_URL.rstrip("/")

    logger.info("=== Starting Scene 1 Batch Production Render ===")

    # Shot 002: Macro Insert / Coffee cup & Sunny
    shot_002_prompt = (
        "masterpiece, best quality, low-angle medium shot, 1boy, frail young man, pale skin, messy black hair, "
        "dark circles under eyes, holding empty crumpled paper coffee cup, standing up from rusty bench, "
        "rain droplets falling, rundown police station entrance ahead, moody overcast lighting, shallow depth of field, 35mm lens"
    )
    shot_002_overrides = {
        "positive_prompt": shot_002_prompt,
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, blurry, deformed",
        "seed": 60201,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": "CHAR_SUNNY_FOUNDRY_00001_.png",
        "location_plate_image": "LOC_OUTSKIRTS_POLICE_STATION_00001_.png",
        "filename_prefix": "SHOT_002_SUNNY_ENTRANCE",
    }

    # Shot 003: Lobby Interior Establishing
    shot_003_prompt = (
        "masterpiece, best quality, cinematic interior wide shot, 1boy from behind, frail young man in dark ragged jacket, "
        "stepping through glass doors into rundown police station lobby, acrylic reception partition, green terminal glow, "
        "atmospheric haze, harsh fluorescent ceiling lighting reflecting on scuffed floor tiles"
    )
    shot_003_overrides = {
        "positive_prompt": shot_003_prompt,
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, blurry, deformed, extra people",
        "seed": 60302,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": "CHAR_SUNNY_FOUNDRY_00001_.png",
        "location_plate_image": "LOC_STATION_LOBBY_00001_.png",
        "filename_prefix": "SHOT_003_LOBBY_ENTRANCE",
    }

    # Shot 004: Duty Officer Solo Reaction
    shot_004_prompt = (
        "masterpiece, best quality, medium close-up, 1man, middle-aged tired police officer, square jaw, dark stubble, "
        "eyes widening in sudden pale shock and horror, mouth open, seated behind scratched armored glass desk, "
        "reaching frantically toward red emergency console button, flashing red alarm lighting casting deep crimson shadows"
    )
    shot_004_overrides = {
        "positive_prompt": shot_004_prompt,
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, blurry",
        "seed": 60403,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": "CHAR_DUTY_OFFICER_FOUNDRY_00001_.png",
        "location_plate_image": "LOC_STATION_LOBBY_00001_.png",
        "filename_prefix": "SHOT_004_OFFICER_PANIC",
    }

    # Shot 005: Code Black Alarm Climax Vista
    shot_005_prompt = (
        "masterpiece, best quality, dramatic cinematic wide shot, no humans, rundown police station lobby bathed in blinding "
        "flashing crimson red emergency strobe lights, green terminal screens flashing 'CODE BLACK', volumetric smoke and red haze, "
        "shattered glass reflection, high-stakes emergency atmosphere, dynamic shadows"
    )
    shot_005_overrides = {
        "positive_prompt": shot_005_prompt,
        "negative_prompt": "1boy, 1girl, character, person, crowd, worst quality, low quality, bad anatomy, blurry",
        "seed": 60504,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "SHOT_005_CODE_BLACK_STROBE",
    }

    # Concurrency Batch 1: Shot 2 on GPU 0 & Shot 3 on GPU 1
    logger.info("Dispatching Concurrency Batch 1: Shot 002 (GPU 0) & Shot 003 (GPU 1)...")
    res_2, res_3 = await asyncio.gather(
        client.render_workflow("04_WF_SHOT_SOLO.json", shot_002_overrides, target_gpu_url=gpu0, output_dir=output_dir),
        client.render_workflow("04_WF_SHOT_SOLO.json", shot_003_overrides, target_gpu_url=gpu1, output_dir=output_dir),
    )
    logger.info(f"Rendered Shot 002: {[str(p) for p in res_2]}")
    logger.info(f"Rendered Shot 003: {[str(p) for p in res_3]}")

    # Concurrency Batch 2: Shot 4 on GPU 0 & Shot 5 on GPU 1
    logger.info("Dispatching Concurrency Batch 2: Shot 004 (GPU 0) & Shot 005 (GPU 1)...")
    res_4, res_5 = await asyncio.gather(
        client.render_workflow("04_WF_SHOT_SOLO.json", shot_004_overrides, target_gpu_url=gpu0, output_dir=output_dir),
        client.render_workflow("06_WF_SHOT_ENV.json", shot_005_overrides, target_gpu_url=gpu1, output_dir=output_dir),
    )
    logger.info(f"Rendered Shot 004: {[str(p) for p in res_4]}")
    logger.info(f"Rendered Shot 005: {[str(p) for p in res_5]}")

    all_rendered = res_2 + res_3 + res_4 + res_5
    logger.info(f"=== Successfully Rendered All {len(all_rendered)} Scene 1 Shots! ===")


if __name__ == "__main__":
    asyncio.run(main())

