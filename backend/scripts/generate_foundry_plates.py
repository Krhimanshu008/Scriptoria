"""Pre-Production Asset Foundry Pipeline for Chapter 1.

Generates the missing Master Location plates and Character reference sheets:
1. LOC-STATION-LOBBY (Police station lobby with Code Black emergency strobe)
2. CHAR-DUTY-OFFICER (Desk police officer Sunny reports to)
3. LOC-ISOLATION-CELL (Containment chamber with heavy mechanical restraint chair)

Dispatches concurrently across the ComfyUI GPU cluster, downloads assets,
registers nodes in Supabase, and uploads the new plates to ComfyUI for downstream shot conditioning.
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.core_sources import Workspace
from app.models.core_knowledge import KnowledgeNode, NodeCategory
from app.services.phase3_visual.comfyui_client import ComfyClusterClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("asset_foundry")


async def register_nodes_in_supabase():
    """Registers the new location and character nodes in the bi-temporal database."""
    async with AsyncSessionLocal() as session:
        stmt_ws = select(Workspace).where(Workspace.code == "SHADOW-SLAVE-UNIVERSE")
        ws = (await session.execute(stmt_ws)).scalars().first()
        if not ws:
            raise RuntimeError("Workspace SHADOW-SLAVE-UNIVERSE not found")

        # 1. Station Lobby Node
        stmt = select(KnowledgeNode).where(
            KnowledgeNode.workspace_id == ws.workspace_id,
            KnowledgeNode.node_code == "LOC-STATION-LOBBY",
        )
        lobby = (await session.execute(stmt)).scalars().first()
        if not lobby:
            lobby = KnowledgeNode(
                workspace_id=ws.workspace_id,
                node_code="LOC-STATION-LOBBY",
                category=NodeCategory.LOCATION,
                canonical_name="Police Station Lobby",
                aliases=["Reception Desk", "Front Desk", "Code Black Lobby"],
                canonical_summary="Rundown police lobby with reinforced acrylic partition and emergency alarm strobes.",
            )
            session.add(lobby)
            logger.info("Registered KnowledgeNode: LOC-STATION-LOBBY")

        # 2. Duty Officer Node
        stmt = select(KnowledgeNode).where(
            KnowledgeNode.workspace_id == ws.workspace_id,
            KnowledgeNode.node_code == "CHAR-DUTY-OFFICER",
        )
        officer = (await session.execute(stmt)).scalars().first()
        if not officer:
            officer = KnowledgeNode(
                workspace_id=ws.workspace_id,
                node_code="CHAR-DUTY-OFFICER",
                category=NodeCategory.PERSON_OR_CHARACTER,
                canonical_name="Duty Police Officer",
                aliases=["Desk Sergeant", "Intake Officer"],
                canonical_summary="Tired middle-aged police officer who receives Sunny's Nightmare Spell confession.",
            )
            session.add(officer)
            logger.info("Registered KnowledgeNode: CHAR-DUTY-OFFICER")

        # 3. Isolation Cell Node
        stmt = select(KnowledgeNode).where(
            KnowledgeNode.workspace_id == ws.workspace_id,
            KnowledgeNode.node_code == "LOC-ISOLATION-CELL",
        )
        cell = (await session.execute(stmt)).scalars().first()
        if not cell:
            cell = KnowledgeNode(
                workspace_id=ws.workspace_id,
                node_code="LOC-ISOLATION-CELL",
                category=NodeCategory.LOCATION,
                canonical_name="Subterranean Isolation Cell",
                aliases=["Containment Room", "Restraint Cell", "Holding Room"],
                canonical_summary="Reinforced medical containment chamber with heavy restraint chair for infected Aspirants.",
            )
            session.add(cell)
            logger.info("Registered KnowledgeNode: LOC-ISOLATION-CELL")

        await session.commit()


async def main():
    logger.info("=== Starting Pre-Production Asset Foundry for Chapter 1 ===")
    await register_nodes_in_supabase()

    client = ComfyClusterClient()
    output_dir = Path("output/foundry")
    output_dir.mkdir(parents=True, exist_ok=True)

    gpu0 = settings.COMFYUI_GPU0_URL.rstrip("/")
    gpu1 = settings.COMFYUI_GPU1_URL.rstrip("/")

    # Job A: Station Lobby Plate on GPU 0
    lobby_prompt = (
        "masterpiece, best quality, anime architectural background art, establishing wide interior shot, no humans, "
        "rundown futuristic police station lobby, worn armored reception desk with acrylic glass partition, "
        "flickering green phosphor computer terminals, flashing red Code Black emergency strobe alarm casting crimson light "
        "over grey concrete walls and scuffed tiled floor, cyberpunk dystopian aesthetic, volumetric atmospheric haze"
    )
    lobby_neg = "1boy, 1girl, character, person, crowd, silhouette, worst quality, low quality, lowres, bad anatomy, blurry"
    lobby_overrides = {
        "positive_prompt": lobby_prompt,
        "negative_prompt": lobby_neg,
        "seed": 3001,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "LOC_STATION_LOBBY",
    }

    # Job B: Duty Police Officer Reference Sheet on GPU 1
    officer_prompt = (
        "masterpiece, best quality, character reference sheet, orthographic 3-angle turnaround, "
        "front view, side view, back view, full body, 1man, middle-aged tired police officer, square jaw, dark stubble, "
        "weary dark eyes, wearing dark blue tactical police uniform, utility belt, ballistic vest with silver badge, "
        "sturdy black combat boots, neutral solid grey studio background #2b2b2b, flat studio lighting"
    )
    officer_neg = (
        "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, blurry, "
        "scenery, dramatic shadows, glowing weapons, armor"
    )
    officer_overrides = {
        "positive_prompt": officer_prompt,
        "negative_prompt": officer_neg,
        "seed": 4002,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "CHAR_DUTY_OFFICER_FOUNDRY",
    }

    # Job C: Isolation Cell Plate
    cell_prompt = (
        "masterpiece, best quality, anime architectural interior background art, wide shot, no humans, "
        "subterranean medical isolation containment room, heavy mechanical alloy restraint chair in center with thick steel arm "
        "and leg cuffs and biometric wiring, reinforced blast-proof observation glass window on side wall, "
        "cold harsh overhead medical lighting, brushed steel and reinforced concrete walls, dystopian containment chamber"
    )
    cell_neg = "1boy, 1girl, character, person, crowd, silhouette, worst quality, low quality, lowres, bad anatomy, blurry"
    cell_overrides = {
        "positive_prompt": cell_prompt,
        "negative_prompt": cell_neg,
        "seed": 5003,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "LOC_ISOLATION_CELL",
    }

    logger.info("Dispatching Batch 1: Station Lobby (GPU 0) & Duty Officer Turnaround (GPU 1)...")
    res_a, res_b = await asyncio.gather(
        client.render_workflow("02_WF_FOUNDRY_LOC_FAETASTIC.json", lobby_overrides, target_gpu_url=gpu0, output_dir=output_dir),
        client.render_workflow("01_WF_FOUNDRY_CHAR_VNCCS.json", officer_overrides, target_gpu_url=gpu1, output_dir=output_dir),
    )
    logger.info(f"Rendered Station Lobby: {[str(p) for p in res_a]}")
    logger.info(f"Rendered Duty Officer: {[str(p) for p in res_b]}")

    logger.info("Dispatching Batch 2: Isolation Containment Cell (GPU 0)...")
    res_c = await client.render_workflow(
        "02_WF_FOUNDRY_LOC_FAETASTIC.json", cell_overrides, target_gpu_url=gpu0, output_dir=output_dir
    )
    logger.info(f"Rendered Isolation Cell: {[str(p) for p in res_c]}")

    # Upload all newly generated plates to cluster nodes for downstream shot conditioning
    all_generated = res_a + res_b + res_c
    logger.info(f"Uploading {len(all_generated)} new foundry assets to cluster inputs...")
    for p in all_generated:
        for gpu in client.node_urls:
            await client.upload_image(p, target_gpu_url=gpu)
        logger.info(f"Synced {p.name} across cluster nodes")

    logger.info("=== Pre-Production Foundry Complete: All Chapter 1 Assets Ready ===")


if __name__ == "__main__":
    asyncio.run(main())

