"""Test single production shot rendering on Google Colab GPU (gcgpu.krhimanshu.in).

Tests the full 04_WF_SHOT_SOLO workflow with:
- SDXL Illustrious checkpoint
- SDXL VAE
- CLIP Vision Vit-H
- IP-Adapter Face conditioning (character_ref.png)
- ControlNet Union conditioning (location_plate.png)
- Automatic Colab path adapter and FaceDetailer bypass
"""

import asyncio
import logging
import sys
import time
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("gcgpu_test")

from app.services.phase3_visual.comfyui_client import ComfyClusterClient

async def main():
    colab_url = "https://gcgpu.krhimanshu.in"
    logger.info(f"Targeting Colab GPU Node: {colab_url}")
    
    client = ComfyClusterClient([colab_url])
    status = await client.get_node_status(colab_url)
    logger.info(f"Node Status: is_online={status.is_online}, has_checkpoints={status.has_checkpoints}, free_vram={status.vram_free_mb} MB")
    
    if not status.is_online:
        logger.error(f"Cannot reach {colab_url}! Please verify tunnel and Colab cell.")
        sys.exit(1)
        
    template = "04_WF_SHOT_SOLO.json"
    overrides = {
        "positive_prompt": "masterpiece, best quality, medium close-up shot, 1boy, Sunny from shadow slave, pale skin, messy black hair, sharp dark onyx eyes, battered slave burlap tunic, shivering against freezing blizzard mountain pass, cinematic rim lighting, photorealistic 8k anime visual novel style",
        "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, blurry, watermark, modern clothing",
        "seed": 88001,
        "steps": 25,
        "cfg": 6.5,
        "width": 1024,
        "height": 768,
        "character_ref_image": "character_ref.png",
        "location_plate_image": "location_plate.png",
        "filename_prefix": "GCGPU_PROD_TEST_SHOT",
    }
    
    output_dir = Path("output/shots")
    artifact_dir = Path(r"C:\Users\5480\.gemini\antigravity\brain\03f3bb64-c295-4aff-a73b-3d8e6b9392e1\output_foundry")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    
    t0 = time.time()
    logger.info(f"Dispatching production shot workflow '{template}' to {colab_url}...")
    
    try:
        downloaded = await client.render_workflow(
            template_name=template,
            overrides=overrides,
            target_gpu_url=colab_url,
            output_dir=output_dir,
        )
        elapsed = time.time() - t0
        logger.info(f"✓ Shot generated successfully in {elapsed:.2f} seconds!")
        
        for p in downloaded:
            logger.info(f"✓ Saved to local output: {p} ({p.stat().st_size} bytes)")
            artifact_path = artifact_dir / p.name
            with open(p, "rb") as src, open(artifact_path, "wb") as dst:
                dst.write(src.read())
            logger.info(f"✓ Mirrored to artifact directory: {artifact_path}")
            
    except Exception as e:
        logger.error(f"Render failed with error: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())

