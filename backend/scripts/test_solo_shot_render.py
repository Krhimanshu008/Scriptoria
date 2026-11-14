"""Test Solo Shot Render with IP-Adapter & ControlNet.

Renders Shot 1 of Chapter 1 using '04_WF_SHOT_SOLO.json' on the 3-GPU cluster.
Locks Sunny's face via IP-Adapter and background plate via ControlNet.
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.phase3_visual.comfyui_client import ComfyClusterClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("solo_shot_test")


async def main():
    client = ComfyClusterClient()
    logger.info(f"Available Cluster Nodes: {client.node_urls}")

    best_gpu = await client.select_best_gpu()
    logger.info(f"Selected GPU for Shot 1: {best_gpu}")

    shot_prompt = (
        "masterpiece, best quality, medium close-up, 1boy, frail young man, pale skin, messy black hair, "
        "dark circles under sharp onyx eyes, exhausted cynical smirk, wearing worn dark ragged jacket, "
        "cradling a steaming paper coffee cup in hands, sitting on a rusty iron bench, rain droplets on shoulders, "
        "rundown police station blurred in background, moody overcast lighting, cinematic depth of field, 50mm lens"
    )
    shot_neg = (
        "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, signature, watermark, blurry, deformed eyes"
    )

    overrides = {
        "positive_prompt": shot_prompt,
        "negative_prompt": shot_neg,
        "seed": 40401,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": "CHAR_SUNNY_FOUNDRY_00001_.png",
        "location_plate_image": "LOC_OUTSKIRTS_POLICE_STATION_00001_.png",
        "filename_prefix": "SHOT_001_SUNNY_BENCH",
    }

    output_dir = Path("output/shots")
    output_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Dispatching Shot 1 to ComfyUI Cluster...")
    images = await client.render_workflow(
        template_name="04_WF_SHOT_SOLO.json",
        overrides=overrides,
        target_gpu_url=best_gpu,
        output_dir=output_dir,
    )

    logger.info(f"Successfully generated and downloaded Shot 1: {[str(p) for p in images]}")


if __name__ == "__main__":
    asyncio.run(main())
