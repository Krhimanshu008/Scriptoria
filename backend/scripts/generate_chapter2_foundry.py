"""Pre-Production Asset Foundry for Chapter 2: Slave Caravan.

Renders Master Foundry Plates concurrently on Kaggle GPU 0 and GPU 1:
- LOC_SHACKLE_MOUNTAIN_PASS: Solitary jagged peak under moonlight, cliff road over abyss.
- CHAR_SUNNY_SLAVE_FOUNDRY: 3-angle turnaround sheet of Sunny in threadbare slave tunic with iron shackles.

Saves rendered plates to 'output/foundry/' and syncs to remote GPU input directories for conditioning downstream shots.
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
logger = logging.getLogger("ch2_foundry")

ARTIFACT_DIR = Path(r"C:\Users\5480\.gemini\antigravity\brain\03f3bb64-c295-4aff-a73b-3d8e6b9392e1\output_foundry")


async def main():
    logger.info("=== Starting Pre-Production Asset Foundry for Chapter 2 ===")
    client = ComfyClusterClient()
    output_dir = Path("output/foundry")
    output_dir.mkdir(parents=True, exist_ok=True)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    gpu0 = settings.COMFYUI_GPU0_URL.rstrip("/")
    gpu1 = settings.COMFYUI_GPU1_URL.rstrip("/")

    logger.info(f"Target GPU 0: {gpu0}")
    logger.info(f"Target GPU 1: {gpu1}")

    # Job A: Location Plate on GPU 0
    loc_prompt = (
        "masterpiece, best quality, anime architectural background, high-angle vista, no humans, "
        "towering jagged solitary mountain peak cutting the dark night sky under a massive radiant pale full moon, "
        "icy wind gusts, weathered stone cliffside road with patches of snow and ancient paving, sheer vertical rock cliff on right, "
        "bottomless black abyss on left, blizzard atmosphere, cold blue and silver moonlight illumination, highly detailed"
    )
    loc_neg = "1boy, 1girl, character, person, crowd, silhouette, worst quality, low quality, lowres, bad anatomy, blurry"
    loc_overrides = {
        "positive_prompt": loc_prompt,
        "negative_prompt": loc_neg,
        "seed": 88001,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "LOC_SHACKLE_MOUNTAIN_PASS",
    }

    # Job B: Character Foundry Sheet on GPU 1
    char_prompt = (
        "masterpiece, best quality, character reference sheet, orthographic 3-angle turnaround, "
        "front view, side view, back view, full body, 1boy, frail 16 year old youth, pale skin, messy black hair, "
        "dark weary eyes, wearing ragged threadbare coarse hemp burlap slave tunic, rope belt, bare bleeding feet, "
        "heavy rusted iron shackles clamped on wrists with raw broken skin, neutral solid dark grey background #2b2b2b, flat studio lighting"
    )
    char_neg = "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, modern clothes, jewelry, weapons"
    char_overrides = {
        "positive_prompt": char_prompt,
        "negative_prompt": char_neg,
        "seed": 88002,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "CHAR_SUNNY_SLAVE_FOUNDRY",
    }

    # Dispatch concurrently: Location on GPU 0, Character on GPU 1
    logger.info("Dispatching Location plate to GPU 0 and Character sheet to GPU 1 concurrently...")
    task_loc = asyncio.create_task(
        client.render_workflow(
            template_name="02_WF_FOUNDRY_LOC_FAETASTIC.json",
            overrides=loc_overrides,
            target_gpu_url=gpu0,
            output_dir=output_dir,
        )
    )
    task_char = asyncio.create_task(
        client.render_workflow(
            template_name="01_WF_FOUNDRY_CHAR_VNCCS.json",
            overrides=char_overrides,
            target_gpu_url=gpu1,
            output_dir=output_dir,
        )
    )

    loc_files, char_files = await asyncio.gather(task_loc, task_char)
    loc_path = loc_files[0]
    char_path = char_files[0]

    logger.info(f"Rendered Location: {loc_path}")
    logger.info(f"Rendered Character: {char_path}")

    # Mirror to artifact directory for markdown preview
    shutil.copy(loc_path, ARTIFACT_DIR / loc_path.name)
    shutil.copy(char_path, ARTIFACT_DIR / char_path.name)
    logger.info(f"Mirrored plates to artifact directory: {ARTIFACT_DIR}")

    # Sync plates to remote input directories across both GPUs for downstream ControlNet & IP-Adapter
    for gpu_url in [gpu0, gpu1]:
        logger.info(f"Syncing plates to remote input on {gpu_url}...")
        await client.upload_image(loc_path, target_gpu_url=gpu_url)
        await client.upload_image(char_path, target_gpu_url=gpu_url)

    logger.info("=== Chapter 2 Pre-Production Asset Foundry Completed Successfully! ===")


if __name__ == "__main__":
    asyncio.run(main())
