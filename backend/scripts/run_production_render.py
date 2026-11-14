"""End-to-End Production Pipeline Script for Shadow Slave.

1. Parses Chapter 1 from 'Novels/Shadow Slave - Volume 1 To 7 Collection.epub'.
2. Ingests Chapter 1 into Supabase bi-temporal knowledge graph (Master Character & Location).
3. Compiles production prompts for Sunny (Character Foundry) and the Dystopian Police Station (Environment Plate).
4. Dispatches concurrently to the Kaggle Dual-GPU cluster (GPU 0 & GPU 1).
5. Downloads rendered art to 'output/foundry/' and 'output/shots/'.
"""

import asyncio
import logging
import os
import sys
from pathlib import Path
from uuid import uuid4

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.core_sources import Workspace, WorkspaceDomain, Book, DocumentUnit, SourcePassage
from app.models.core_knowledge import KnowledgeNode, NodeCategory
from app.services.phase2_ingestion.epub_parser import EPUBParser
from app.services.phase3_visual.comfyui_client import ComfyClusterClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("production_pipeline")


async def step1_ingest_novel_chapter():
    """Extracts Chapter 1 and registers entities in Supabase."""
    epub_path = Path("Novels/Shadow Slave - Volume 1 To 7 Collection.epub")
    parser = EPUBParser(epub_path)
    ch1 = parser.extract_chapter(1)
    if not ch1:
        raise ValueError("Could not extract Chapter 1 from EPUB")

    logger.info(f"Loaded Chapter 1: '{ch1.title}' ({ch1.word_count} words)")

    async with AsyncSessionLocal() as session:
        # 1. Get or create Workspace for Shadow Slave
        stmt_ws = select(Workspace).where(Workspace.code == "SHADOW-SLAVE-UNIVERSE")
        ws = (await session.execute(stmt_ws)).scalars().first()
        if not ws:
            ws = Workspace(
                code="SHADOW-SLAVE-UNIVERSE",
                title="Shadow Slave Fiction Universe",
                domain=WorkspaceDomain.FICTION_UNIVERSE,
            )
            session.add(ws)
            await session.flush()
            logger.info(f"Created Workspace {ws.workspace_id}")

        # 2. Get or create Book
        stmt_bk = select(Book).where(Book.title == "Shadow Slave - Volume 1: Children of Fate")
        book = (await session.execute(stmt_bk)).scalars().first()
        if not book:
            book = Book(
                workspace_id=ws.workspace_id,
                title="Shadow Slave - Volume 1: Children of Fate",
                authors=["Guiltythree"],
                edition="Web Novel Collection",
                publication_year=2021,
                book_order_in_workspace=1,
            )
            session.add(book)
            await session.flush()
            logger.info(f"Created Book {book.book_id}")

        # 3. Get or create DocumentUnit
        stmt_doc = select(DocumentUnit).where(
            DocumentUnit.book_id == book.book_id,
            DocumentUnit.unit_number == 1,
        )
        doc = (await session.execute(stmt_doc)).scalars().first()
        if not doc:
            doc = DocumentUnit(
                book_id=book.book_id,
                unit_number=1,
                unit_type="CHAPTER",
                title=f"Chapter 1: {ch1.title}",
                raw_text=ch1.raw_text,
                processing_status="PROCESSED",
            )
            session.add(doc)
            await session.flush()
            logger.info(f"Created DocumentUnit {doc.unit_id}")

            # Add source passage
            passage = SourcePassage(
                unit_id=doc.unit_id,
                book_id=book.book_id,
                passage_order=1,
                exact_quote=ch1.raw_text[:2000],
            )
            session.add(passage)
            logger.info(f"Added SourcePassage for opening section")

        # 4. Ensure Master Character Node exists: Sunny (Lost from Light)
        stmt_char = select(KnowledgeNode).where(
            KnowledgeNode.workspace_id == ws.workspace_id,
            KnowledgeNode.node_code == "CHAR-SUNNY",
        )
        sunny = (await session.execute(stmt_char)).scalars().first()
        if not sunny:
            sunny = KnowledgeNode(
                workspace_id=ws.workspace_id,
                node_code="CHAR-SUNNY",
                category=NodeCategory.PERSON_OR_CHARACTER,
                canonical_name="Sunny",
                aliases=["Sunless", "Lost from Light", "Lord Shadow"],
            )
            session.add(sunny)
            logger.info("Created Master Character node: Sunny (CHAR-SUNNY)")

        # 5. Ensure Master Location Node exists: Dystopian Outskirts Police Station
        stmt_loc = select(KnowledgeNode).where(
            KnowledgeNode.workspace_id == ws.workspace_id,
            KnowledgeNode.node_code == "LOC-OUTSKIRTS-STATION",
        )
        station = (await session.execute(stmt_loc)).scalars().first()
        if not station:
            station = KnowledgeNode(
                workspace_id=ws.workspace_id,
                node_code="LOC-OUTSKIRTS-STATION",
                category=NodeCategory.LOCATION,
                canonical_name="Outskirts Police Station",
                aliases=["Slum Police Station", "Rusty Bench Station"],
            )
            session.add(station)
            logger.info("Created Master Location node: Outskirts Police Station (LOC-OUTSKIRTS-STATION)")

        await session.commit()

    return ch1


async def step2_render_cluster():
    """Dispatches parallel foundry jobs across GPU 0 and GPU 1."""
    client = ComfyClusterClient()

    # Verify nodes
    gpu0 = settings.COMFYUI_GPU0_URL.rstrip("/")
    gpu1 = settings.COMFYUI_GPU1_URL.rstrip("/")

    logger.info(f"GPU 0 Endpoint: {gpu0}")
    logger.info(f"GPU 1 Endpoint: {gpu1}")

    # Job 1: Sunny Character Foundry (3-angle turnaround) on GPU 0
    sunny_prompt = (
        "masterpiece, best quality, character reference sheet, orthographic 3-angle turnaround, "
        "front view, side view, back view, full body, 1boy, frail young man, pale skin, messy black hair, "
        "dark circles under eyes, sharp dark onyx eyes, wearing worn ragged dark jacket and frayed trousers, "
        "slum scavenger, simple solid neutral grey studio background #2b2b2b, flat studio lighting"
    )
    sunny_neg = (
        "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, blurry, "
        "scenery, dramatic shadows, glowing weapons, armor"
    )

    sunny_overrides = {
        "positive_prompt": sunny_prompt,
        "negative_prompt": sunny_neg,
        "seed": 1001,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "CHAR_SUNNY_FOUNDRY",
    }

    # Job 2: Dystopian Outskirts Environment Plate on GPU 1
    env_prompt = (
        "masterpiece, best quality, anime architectural background art, establishing wide vista, no humans, "
        "dilapidated police station exterior in rain-soaked dystopian slum outskirts, rusty iron bench on wet pavement, "
        "cracked asphalt reflecting neon streetlamps, decaying concrete megastructures in misty distance, "
        "overcast rainy sky, volumetric atmospheric haze, cinematic lighting"
    )
    env_neg = (
        "1boy, 1girl, character, person, crowd, silhouette, worst quality, low quality, lowres, bad anatomy, blurry"
    )

    env_overrides = {
        "positive_prompt": env_prompt,
        "negative_prompt": env_neg,
        "seed": 2002,
        "steps": 28,
        "cfg": 6.5,
        "filename_prefix": "LOC_OUTSKIRTS_POLICE_STATION",
    }

    output_dir = Path("output/foundry")
    output_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Dispatching Sunny Character Foundry to GPU 0 and Environment Plate to GPU 1...")

    # Concurrently render across both GPUs
    task_gpu0 = client.render_workflow(
        template_name="01_WF_FOUNDRY_CHAR_VNCCS.json",
        overrides=sunny_overrides,
        target_gpu_url=gpu0,
        output_dir=output_dir,
    )

    task_gpu1 = client.render_workflow(
        template_name="06_WF_SHOT_ENV.json",
        overrides=env_overrides,
        target_gpu_url=gpu1,
        output_dir=output_dir,
    )

    results = await asyncio.gather(task_gpu0, task_gpu1, return_exceptions=True)

    for i, res in enumerate(results):
        target = gpu0 if i == 0 else gpu1
        job_name = "Sunny Character Sheet" if i == 0 else "Outskirts Environment Vista"
        if isinstance(res, Exception):
            logger.error(f"Render failed for {job_name} on {target}: {res}")
        else:
            logger.info(f"Render SUCCESS for {job_name} on {target}: {[str(p) for p in res]}")


async def main():
    logger.info("=== Starting Fiction Novel Production Pipeline for Shadow Slave ===")
    await step1_ingest_novel_chapter()
    await step2_render_cluster()
    logger.info("=== Pipeline Completed ===")


if __name__ == "__main__":
    asyncio.run(main())
