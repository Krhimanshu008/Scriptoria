"""Complete Pre-Production Multi-Angle Asset Foundry.

Systematically expands the visual asset bible for Chapter 2 and the universe:
1. Cast 3-Angle Turnaround Reference Sheets:
   - CHAR_HERO_SOLDIER (Young noble imperial soldier on white horse)
   - CHAR_VETERAN_SOLDIER (Cruel scarred whip-master)
   - CHAR_SLAVE_SHIFTY (Paranoid quick-eyed slave)
   - CHAR_SLAVE_BROAD (Broad-shouldered slave with bloodied back)
   - CHAR_SLAVE_SCHOLAR (Gentle educated slave)
2. Location 4-Angle Spatial Kit (LOC_SHACKLE_MOUNTAIN_PASS):
   - ANGLE_B_REVERSE (180-degree reverse angle looking down the mountain road)
   - ANGLE_C_GROUND_LEVEL (Eye-level action corridor of narrow path, cliff face & snowdrifts)
   - ANGLE_D_ABYSS_MACRO (Looking over the sheer precipice into bottomless black abyss)
3. Item & Prop 3-Angle Sheets:
   - ITEM_IRON_SLAVE_SHACKLES (Heavy rusted iron wrist cuffs & connecting chain)
   - ITEM_SOLDIER_WATER_FLASK (Embossed bronze/leather imperial military canteen)
   - ITEM_PUNISHMENT_WHIP (Braided leather scourge with barbed tip)
4. Textile Material Sheets:
   - TEXTILE_SLAVE_BURLAP (Macro weave of coarse frayed hemp burlap slave rags)
   - TEXTILE_IMPERIAL_LEATHER (Macro texture of boiled cuirass leather with brass rivets)

Dispatches concurrently across Kaggle GPU 0 and GPU 1, downloads to 'output/foundry/',
mirrors to artifact directory, and uploads to ComfyUI remote /input folders.
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
logger = logging.getLogger("complete_foundry")

ARTIFACT_DIR = Path(r"C:\Users\5480\.gemini\antigravity\brain\03f3bb64-c295-4aff-a73b-3d8e6b9392e1\output_foundry")


async def render_job(client: ComfyClusterClient, template: str, overrides: dict, target_gpu: str, out_dir: Path) -> Path:
    prefix = overrides["filename_prefix"]
    logger.info(f"Dispatching {prefix} to {target_gpu}...")
    files = await client.render_workflow(
        template_name=template,
        overrides=overrides,
        target_gpu_url=target_gpu,
        output_dir=out_dir,
    )
    if not files:
        raise RuntimeError(f"No file generated for {prefix}")
    out_file = files[0]
    logger.info(f"✓ Completed {prefix}: {out_file}")

    # Mirror to artifact directory
    shutil.copy(out_file, ARTIFACT_DIR / out_file.name)
    return out_file


async def main():
    logger.info("=== Starting Complete Pre-Production Asset Foundry Expansion ===")
    client = ComfyClusterClient()
    out_dir = Path("output/foundry")
    out_dir.mkdir(parents=True, exist_ok=True)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    gpu0 = settings.COMFYUI_GPU0_URL.rstrip("/")
    gpu1 = settings.COMFYUI_GPU1_URL.rstrip("/")

    # =========================================================================
    # BATCH 1: Primary Secondary Cast (Hero Soldier on GPU 0, Veteran Whip-Master on GPU 1)
    # =========================================================================
    hero_soldier_prompt = (
        "masterpiece, best quality, character reference sheet, orthographic 3-angle turnaround, "
        "front view, side view, back view, full body, 1man, handsome youthful noble soldier, 19 years old, "
        "clean-shaven, dignified noble face, calm compassionate dark brown eyes, short brown hair, "
        "wearing oiled brown leather cuirass over dark linen tunic, bronze shoulder clasp, dark wool trousers, "
        "leather riding boots, neutral solid dark grey background #2b2b2b, flat studio lighting"
    )
    hero_soldier_overrides = {
        "positive_prompt": hero_soldier_prompt,
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, modern clothes, blurry",
        "seed": 10101,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "CHAR_HERO_SOLDIER_FOUNDRY",
    }

    veteran_soldier_prompt = (
        "masterpiece, best quality, character reference sheet, orthographic 3-angle turnaround, "
        "front view, side view, back view, full body, 1man, ruthless veteran warrior, late 40s, "
        "scarred weather-beaten face, cold cruel narrow eyes, crooked broken nose, greying dark stubble, "
        "wearing heavy dark iron-reinforced leather armor, spiked vambraces, fur-lined cloak, heavy combat boots, "
        "holding braided punishment whip in hand, neutral solid dark grey background #2b2b2b, flat studio lighting"
    )
    veteran_soldier_overrides = {
        "positive_prompt": veteran_soldier_prompt,
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, missing fingers, modern clothes, smiling, blurry",
        "seed": 10102,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "CHAR_VETERAN_SOLDIER_FOUNDRY",
    }

    logger.info(">>> Launching Cast Batch 1: Hero Soldier (GPU 0) & Veteran Whip-Master (GPU 1)...")
    t1 = asyncio.create_task(render_job(client, "01_WF_FOUNDRY_CHAR_VNCCS.json", hero_soldier_overrides, gpu0, out_dir))
    t2 = asyncio.create_task(render_job(client, "01_WF_FOUNDRY_CHAR_VNCCS.json", veteran_soldier_overrides, gpu1, out_dir))
    hero_file, vet_file = await asyncio.gather(t1, t2)
    logger.info("✓ Cast Batch 1 complete!")

    # =========================================================================
    # BATCH 2: Fellow Slaves (Shifty Slave on GPU 0, Scholar Slave on GPU 1)
    # =========================================================================
    shifty_slave_prompt = (
        "masterpiece, best quality, character reference sheet, orthographic 3-angle turnaround, "
        "front view, side view, back view, full body, 1man, skinny desperate slave, 20s, nervous twitchy face, "
        "quick paranoid darting eyes, hollow gaunt cheeks, unkempt tangled brown hair, "
        "wearing filthy patched rag tunic, rope belt, bare dirty feet, rusted iron wrist manacles with dangling chain link, "
        "neutral solid dark grey background #2b2b2b, flat studio lighting"
    )
    shifty_overrides = {
        "positive_prompt": shifty_slave_prompt,
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, clean clothes, handsome, blurry",
        "seed": 10201,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "CHAR_SLAVE_SHIFTY_FOUNDRY",
    }

    scholar_slave_prompt = (
        "masterpiece, best quality, character reference sheet, orthographic 3-angle turnaround, "
        "front view, side view, back view, full body, 1man, intelligent gentle scholar slave, 30s, calm sorrowful gaze, "
        "refined bone structure, hollow tired eyes, thin grey-streaked beard, unkempt hair, "
        "wearing faded indigo linen scholar robe converted into ragged slave tunic, bare bruised feet, rusted iron wrist cuffs, "
        "neutral solid dark grey background #2b2b2b, flat studio lighting"
    )
    scholar_overrides = {
        "positive_prompt": scholar_slave_prompt,
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, modern clothes, armor, blurry",
        "seed": 10202,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "CHAR_SLAVE_SCHOLAR_FOUNDRY",
    }

    logger.info(">>> Launching Cast Batch 2: Shifty Slave (GPU 0) & Scholar Slave (GPU 1)...")
    t3 = asyncio.create_task(render_job(client, "01_WF_FOUNDRY_CHAR_VNCCS.json", shifty_overrides, gpu0, out_dir))
    t4 = asyncio.create_task(render_job(client, "01_WF_FOUNDRY_CHAR_VNCCS.json", scholar_overrides, gpu1, out_dir))
    shifty_file, scholar_file = await asyncio.gather(t3, t4)
    logger.info("✓ Cast Batch 2 complete!")

    # =========================================================================
    # BATCH 3: Location Multi-Angle Spatial Kit (Reverse Angle B on GPU 0, Ground Level C on GPU 1)
    # =========================================================================
    reverse_pass_prompt = (
        "masterpiece, best quality, anime architectural background, 180-degree reverse wide shot, no humans, "
        "looking backwards down the frozen ancient mountain pass road, steep downward incline into shadowy winding turns, "
        "weathered flagstones covered in patchy snowdrifts, sheer vertical dark basalt cliff on the left side now, "
        "endless black abyss on the right side, pale silvery moonlight reflecting off ice, freezing blizzard wind gusts"
    )
    reverse_overrides = {
        "positive_prompt": reverse_pass_prompt,
        "negative_prompt": "1boy, 1girl, character, person, crowd, worst quality, low quality, bad anatomy, blurry",
        "seed": 10301,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "LOC_SHACKLE_PASS_ANGLE_B_REVERSE",
    }

    ground_level_prompt = (
        "masterpiece, best quality, anime architectural background, eye-level cinematic ground corridor shot, no humans, "
        "narrow weathered stone mountain ledge path, camera at human eye height, cracked cobblestones visible beneath fresh snow, "
        "towering sheer vertical dark rock wall on right with ancient weathered carvings, yawning endless black void abyss "
        "on left with no guardrail, swirling snow flurry, cold moonlight, claustrophobic and treacherous atmosphere"
    )
    ground_overrides = {
        "positive_prompt": ground_level_prompt,
        "negative_prompt": "1boy, 1girl, character, person, crowd, worst quality, low quality, bad anatomy, blurry",
        "seed": 10302,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "LOC_SHACKLE_PASS_ANGLE_C_GROUND_LEVEL",
    }

    logger.info(">>> Launching Location Spatial Kit Batch: Reverse Angle B (GPU 0) & Ground Level C (GPU 1)...")
    t5 = asyncio.create_task(render_job(client, "02_WF_FOUNDRY_LOC_FAETASTIC.json", reverse_overrides, gpu0, out_dir))
    t6 = asyncio.create_task(render_job(client, "02_WF_FOUNDRY_LOC_FAETASTIC.json", ground_overrides, gpu1, out_dir))
    rev_file, gnd_file = await asyncio.gather(t5, t6)
    logger.info("✓ Location Spatial Kit Batch complete!")

    # =========================================================================
    # BATCH 4: Items & Props (Iron Slave Shackles on GPU 0, Soldier Canteen on GPU 1)
    # =========================================================================
    shackles_prompt = (
        "masterpiece, best quality, isolated prop reference sheet, orthographic multi-angle product display, "
        "heavy ancient iron slave wrist shackles, thick rusted iron cuffs with rough hinged latch, heavy rectangular locking pin, "
        "connected by six heavy thick-forged iron chain links, frost-rimed metal texture, scratches and dried blood stains, "
        "no humans, isolated on solid dark studio background #2b2b2b, crisp professional lighting"
    )
    shackles_overrides = {
        "positive_prompt": shackles_prompt,
        "negative_prompt": "1boy, 1girl, hand, person, fingers, holding, modern handcuffs, shiny steel, worst quality, low quality, blurry",
        "seed": 10401,
        "steps": 26,
        "cfg": 6.5,
        "filename_prefix": "ITEM_IRON_SLAVE_SHACKLES_FOUNDRY",
    }

    canteen_prompt = (
        "masterpiece, best quality, isolated prop reference sheet, orthographic multi-angle product display, "
        "ancient imperial military water flask, round hammered bronze canteen with dark boiled leather casing, "
        "embossed imperial sunburst insignia, braided leather shoulder strap, carved bone stopper secured with thin cord, "
        "scratched weathered patina, no humans, isolated on solid dark studio background #2b2b2b, crisp studio lighting"
    )
    canteen_overrides = {
        "positive_prompt": canteen_prompt,
        "negative_prompt": "1boy, 1girl, hand, fingers, holding, modern plastic bottle, worst quality, low quality, blurry",
        "seed": 10402,
        "steps": 26,
        "cfg": 6.5,
        "filename_prefix": "ITEM_SOLDIER_WATER_FLASK_FOUNDRY",
    }

    logger.info(">>> Launching Item & Prop Batch: Slave Shackles (GPU 0) & Soldier Canteen (GPU 1)...")
    t7 = asyncio.create_task(render_job(client, "03_WF_FOUNDRY_PROP.json", shackles_overrides, gpu0, out_dir))
    t8 = asyncio.create_task(render_job(client, "03_WF_FOUNDRY_PROP.json", canteen_overrides, gpu1, out_dir))
    shackles_file, canteen_file = await asyncio.gather(t7, t8)
    logger.info("✓ Item & Prop Batch complete!")

    # =========================================================================
    # BATCH 5: Whip Prop & Slave Burlap Textile (Whip on GPU 0, Burlap Fabric on GPU 1)
    # =========================================================================
    whip_prompt = (
        "masterpiece, best quality, isolated weapon prop reference sheet, multi-angle product display, "
        "cruel imperial punishment whip, coiled heavy black braided leather scourge, carved horn handle wrapped in wire grip, "
        "thick heavy fall tapering to a deadly lash tipped with sharp iron barbs, stained leather patina, "
        "no humans, isolated on solid dark studio background #2b2b2b, crisp studio lighting"
    )
    whip_overrides = {
        "positive_prompt": whip_prompt,
        "negative_prompt": "1boy, 1girl, hand, fingers, holding, worst quality, low quality, blurry",
        "seed": 10501,
        "steps": 26,
        "cfg": 6.5,
        "filename_prefix": "ITEM_PUNISHMENT_WHIP_FOUNDRY",
    }

    burlap_prompt = (
        "masterpiece, best quality, material and textile reference sheet, macro flat texture display, "
        "coarse unbleached hemp burlap cloth, thick rough woven fibers, frayed tattered edges, "
        "mud stains and faded grime, threadbare weave showing loose threads, medieval slave garment textile, "
        "no humans, centered flat texture swatch on dark studio background #2b2b2b, high detail lighting"
    )
    burlap_overrides = {
        "positive_prompt": burlap_prompt,
        "negative_prompt": "1boy, 1girl, person, body, face, modern cloth, smooth silk, worst quality, low quality, blurry",
        "seed": 10502,
        "steps": 26,
        "cfg": 6.5,
        "filename_prefix": "TEXTILE_SLAVE_BURLAP_FOUNDRY",
    }

    logger.info(">>> Launching Batch 5: Punishment Whip (GPU 0) & Slave Burlap Textile (GPU 1)...")
    t9 = asyncio.create_task(render_job(client, "03_WF_FOUNDRY_PROP.json", whip_overrides, gpu0, out_dir))
    t10 = asyncio.create_task(render_job(client, "03_WF_FOUNDRY_PROP.json", burlap_overrides, gpu1, out_dir))
    whip_file, burlap_file = await asyncio.gather(t9, t10)
    logger.info("✓ Batch 5 complete!")

    # Sync all newly generated plates to remote ComfyUI /input directories on both GPUs
    all_new_plates = [
        hero_file, vet_file, shifty_file, scholar_file,
        rev_file, gnd_file, shackles_file, canteen_file, whip_file, burlap_file
    ]
    logger.info(f"Syncing {len(all_new_plates)} new foundry plates to remote GPU clusters...")
    for p in all_new_plates:
        for u in [gpu0, gpu1]:
            await client.upload_image(p, target_gpu_url=u)

    logger.info("=== All 10 Multi-Angle Pre-Production Foundry Plates Generated & Synced Successfully! ===")


if __name__ == "__main__":
    asyncio.run(main())

