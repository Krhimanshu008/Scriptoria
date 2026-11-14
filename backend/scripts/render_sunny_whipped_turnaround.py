"""Hierarchical Reference Lineage Test:
Renders Sunny's Chapter 2 Whipped Micro-Turnaround sheet conditioning on his Level 0 Master Face via IP-Adapter.
"""

import asyncio
import logging
import shutil
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.services.phase3_visual.comfyui_client import ComfyClusterClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("whipped_foundry")

ARTIFACT_DIR = Path(r"C:\Users\5480\.gemini\antigravity\brain\03f3bb64-c295-4aff-a73b-3d8e6b9392e1\output_foundry")


async def main():
    logger.info("=== Rendering Sunny Whipped Micro-Turnaround with Level 0 Face Inheritance ===")
    client = ComfyClusterClient()
    out_dir = Path("output/foundry")
    out_dir.mkdir(parents=True, exist_ok=True)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    gpu0 = settings.COMFYUI_GPU0_URL.rstrip("/")

    whipped_prompt = (
        "masterpiece, best quality, character reference sheet, orthographic 3-angle turnaround, "
        "front view, side view, back view, full body, 1boy, frail 16 year old youth, pale skin, messy black hair, "
        "sharp dark onyx eyes, wearing tattered threadbare coarse hemp burlap slave tunic slashed open across the shoulder blades, "
        "showing deep bleeding raw whip lacerations and welts, heavy rusted iron wrist shackles with broken skin, "
        "bare bleeding bruised feet, neutral solid dark grey studio background #2b2b2b, flat studio lighting"
    )
    overrides = {
        "positive_prompt": whipped_prompt,
        "negative_prompt": "worst quality, normal quality, low quality, bad anatomy, bad hands, missing fingers, modern clothes, jewelry, weapons, scenery",
        "seed": 77001,
        "steps": 28,
        "cfg": 6.5,
        "character_ref_image": "CHAR_SUNNY_FOUNDRY_00001_.png",
        "filename_prefix": "CHAR_SUNNY_TEMPLE_SLAVE_WHIPPED_FOUNDRY",
    }

    files = await client.render_workflow(
        template_name="01B_WF_FOUNDRY_CHAR_MICRO_IPADAPTER.json",
        overrides=overrides,
        target_gpu_url=gpu0,
        output_dir=out_dir,
    )

    if not files:
        raise RuntimeError("No file returned for Sunny Whipped Turnaround")

    whipped_file = files[0]
    logger.info(f"✓ Rendered Sunny Whipped Turnaround: {whipped_file}")

    # Mirror to artifact directory
    shutil.copy(whipped_file, ARTIFACT_DIR / whipped_file.name)
    logger.info(f"Mirrored to artifact directory: {ARTIFACT_DIR / whipped_file.name}")

    # Sync to remote GPU inputs
    for u in [settings.COMFYUI_GPU0_URL, settings.COMFYUI_GPU1_URL]:
        await client.upload_image(whipped_file, target_gpu_url=u)
        logger.info(f"Synced {whipped_file.name} to {u}")

    logger.info("=== Hierarchical Reference Generation Completed! ===")


if __name__ == "__main__":
    asyncio.run(main())

