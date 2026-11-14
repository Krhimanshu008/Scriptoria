"""Ingestion and Bi-Temporal State Evolution for Chapter 3: The Strings of Fate.

Ingests Chapter 3 of Shadow Slave into Supabase:
1. Extracts Chapter 3 from EPUB.
2. Registers DocumentUnit and SourcePassages.
3. Registers Master Characters, Locations, Items, and Sunny's State Evolution at Tick 3.
4. Breaks down chapter into macro scenes and discourse beats via DiscourseBeatChunker.
5. Computes cinematic shot allocation (80-90 shots) via CinematicPacingAllocator.
6. Persists scenes and shots into domain_fiction tables.
"""

import asyncio
import logging
import os
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.core_sources import Workspace, Book, DocumentUnit, SourcePassage
from app.models.core_knowledge import KnowledgeNode, NodeCategory, NodeState
from app.models.domain_fiction import FictionScene, FictionShot, ShotParticipant
from app.services.phase2_ingestion.epub_parser import EPUBParser
from app.services.phase2_ingestion.beat_chunker import DiscourseBeatChunker
from app.services.phase3_visual.shot_decomposer import CinematicPacingAllocator
from app.services.phase1_core.tick_calculator import BiTemporalTickCalculator

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("ingest_ch3")


async def main():
    logger.info("=== Starting Chapter 3: The Strings of Fate Ingestion ===")

    # 1. Parse Chapter 3 from EPUB
    epub_path = Path("Novels/Shadow Slave - Volume 1 To 7 Collection.epub")
    parser = EPUBParser(epub_path)
    ch3 = parser.extract_chapter(3)
    if not ch3:
        raise RuntimeError("Failed to extract Chapter 3 from EPUB")
    logger.info(f"Loaded Chapter 3: '{ch3.title}' ({ch3.word_count} words)")

    async with AsyncSessionLocal() as session:
        # Retrieve Workspace
        stmt_ws = select(Workspace).where(Workspace.code == "SHADOW-SLAVE-UNIVERSE")
        ws = (await session.execute(stmt_ws)).scalars().first()
        if not ws:
            raise RuntimeError("Workspace SHADOW-SLAVE-UNIVERSE not found")

        # Retrieve Book
        stmt_bk = select(Book).where(Book.workspace_id == ws.workspace_id)
        book = (await session.execute(stmt_bk)).scalars().first()
        if not book:
            raise RuntimeError("Book not found")

        # Retrieve or create DocumentUnit for Chapter 3
        stmt_doc = select(DocumentUnit).where(
            DocumentUnit.book_id == book.book_id,
            DocumentUnit.unit_number == 3,
        )
        doc = (await session.execute(stmt_doc)).scalars().first()
        if not doc:
            doc = DocumentUnit(
                book_id=book.book_id,
                unit_number=3,
                unit_type="CHAPTER",
                title=f"Chapter 3: {ch3.title}",
                raw_text=ch3.raw_text,
                processing_status="PROCESSED",
            )
            session.add(doc)
            await session.flush()
            logger.info(f"Created DocumentUnit for Chapter 3: {doc.unit_id}")

        # 2. Register Master Entities for Chapter 3
        nodes_to_register = [
            (
                "LOC-FATE-CLIFFSIDE-PROMONTORY",
                NodeCategory.LOCATION,
                "Cliffside Promontory Over Abyss",
                ["High Mountain Ledge", "Windswept Ridge"],
                "A perilous narrowing ridge on the mountain trail where the cold gale howls and distant mountain spires pierce dark stormclouds.",
            ),
            (
                "CHAR-OLD-SLAVE",
                NodeCategory.PERSON_OR_CHARACTER,
                "Exhausted Elder Slave",
                ["Old Man", "Gaunt Slave", "Greybeard"],
                "An elderly slave stumbling in the line, hollow-cheeked and barely holding on against the blizzard.",
            ),
            (
                "ITEM-IRON-CHAIN-STRINGS",
                NodeCategory.ITEM_OR_ARTIFACT,
                "Chained Slave Line Connection",
                ["Connecting Iron Links", "Heavy Shackle Chain"],
                "Heavy iron links connecting thirty slaves in an unbreakable line of collective doom.",
            ),
        ]

        node_map = {}
        for code, cat, name, aliases, summary in nodes_to_register:
            stmt = select(KnowledgeNode).where(KnowledgeNode.node_code == code)
            node = (await session.execute(stmt)).scalars().first()
            if not node:
                node = KnowledgeNode(
                    workspace_id=ws.workspace_id,
                    node_code=code,
                    category=cat,
                    canonical_name=name,
                    aliases=aliases,
                    canonical_summary=summary,
                )
                session.add(node)
                await session.flush()
                logger.info(f"Registered KnowledgeNode: {code} -> {node.node_id}")
            node_map[code] = node

        # Also get Sunny's node
        stmt_sunny = select(KnowledgeNode).where(KnowledgeNode.node_code == "CHAR-SUNNY")
        sunny_node = (await session.execute(stmt_sunny)).scalars().first()

        # 3. Register Sunny's Master Character State Evolution at Chapter 3 Tick
        ch3_narrative_tick = BiTemporalTickCalculator.compute_narrative_tick(
            book_num=1, chapter_num=3, scene_num=1, shot_num=1
        )
        ch3_story_tick = 3000000

        if sunny_node:
            state_code = "CHAR-SUNNY-STATE-CH3-EXHAUSTION"
            stmt_st = select(NodeState).where(NodeState.state_code == state_code)
            existing_state = (await session.execute(stmt_st)).scalars().first()
            if not existing_state:
                sunny_ch3_state = NodeState(
                    node_id=sunny_node.node_id,
                    state_code=state_code,
                    state_label="Sunny (First Nightmare - Cold Exhaustion & Fate Contemplation)",
                    compiled_specification={
                        "aspect": "Temple Slave",
                        "rank": "Aspirant",
                        "attributes": ["Fated", "Mark of Divinity", "Child of Shadows"],
                        "apparel": "Tattered coarse burlap tunic, frost-crusted hem",
                        "accessories": "Heavy rusted wrist shackles linking him to the caravan",
                        "physical_condition": "Deep shivering, bruised forearms, whipped shoulder lacerations forming dark scabs, hyper-observant onyx eyes",
                    },
                    valid_from_tick=ch3_story_tick,
                    revealed_at_tick=ch3_narrative_tick,
                    approval_status="APPROVED",
                )
                session.add(sunny_ch3_state)
                logger.info("Recorded Bi-Temporal State Evolution for Sunny at Chapter 3")

        await session.commit()

        # 4. Segment Chapter 3 into Macro Scenes and Narrative Beats
        chunker = DiscourseBeatChunker(target_beat_words=170, min_scene_words=120)
        parsed_scenes = chunker.parse_chapter_text(ch3.raw_text)
        total_beats = sum(len(s.beats) for s in parsed_scenes)
        logger.info(f"Segmented into {len(parsed_scenes)} macro scenes and {total_beats} discourse beats")

        # 5. Cinematic Pacing Allocation (80-90 Shots)
        allocator = CinematicPacingAllocator(target_chapter_shots=82, min_chapter_shots=75, max_chapter_shots=95)
        shot_budgets = allocator.allocate_shot_budgets(parsed_scenes)
        total_allocated_shots = sum(shot_budgets.values())
        logger.info(f"Allocated {total_allocated_shots} total cinematic shots across Chapter 3")

        # 6. Check existing scenes
        stmt_sc = select(FictionScene).where(FictionScene.chapter_unit_id == doc.unit_id)
        existing_scenes = (await session.execute(stmt_sc)).scalars().all()

        if not existing_scenes:
            cliff_node = node_map.get("LOC-FATE-CLIFFSIDE-PROMONTORY")
            passage_counter = 1
            global_shot_counter = 1
            current_story_tick = ch3_story_tick

            for s_idx, p_scene in enumerate(parsed_scenes):
                scene_order = s_idx + 1
                scene_start_tick = BiTemporalTickCalculator.compute_narrative_tick(
                    book_num=1, chapter_num=3, scene_num=min(scene_order, 99), shot_num=1
                )

                fic_scene = FictionScene(
                    workspace_id=ws.workspace_id,
                    chapter_unit_id=doc.unit_id,
                    scene_number=scene_order,
                    location_node_id=cliff_node.node_id if cliff_node else None,
                    start_narrative_tick=scene_start_tick,
                    start_story_tick=current_story_tick,
                )
                session.add(fic_scene)
                await session.flush()

                for b_idx, beat in enumerate(p_scene.beats):
                    # Persist SourcePassage
                    passage = SourcePassage(
                        unit_id=doc.unit_id,
                        book_id=book.book_id,
                        passage_order=passage_counter,
                        exact_quote=beat.text[:2000],
                    )
                    session.add(passage)
                    await session.flush()

                    shots_for_beat = shot_budgets.get(beat.passage_order_in_chapter, 3)

                    for shot_i in range(shots_for_beat):
                        shot_order = shot_i + 1
                        shot_tick = BiTemporalTickCalculator.compute_narrative_tick(
                            book_num=1, chapter_num=3, scene_num=min(scene_order, 99), shot_num=min(shot_order, 999)
                        )
                        current_story_tick = BiTemporalTickCalculator.compute_linear_story_tick(current_story_tick)

                        if shot_i == 0:
                            framing = "EXTREME_WIDE" if b_idx == 0 else "WIDE"
                        elif shot_i == 1:
                            framing = "MEDIUM_TWO_SHOT" if beat.dialogue_intensity > 0.4 else "MEDIUM_FULL"
                        else:
                            framing = "CLOSE_UP" if beat.kinetic_intensity > 0.4 else "MEDIUM_CLOSE_UP"

                        action_text = f"Chapter 3 Beat {passage_counter}: {beat.text[:140]}..."
                        lighting = "Dismal overcast mountain twilight, howling snow flurries, distant violet lightning"

                        shot = FictionShot(
                            scene_id=fic_scene.scene_id,
                            source_passage_id=passage.passage_id,
                            shot_number=shot_order,
                            shot_number_in_chapter=global_shot_counter,
                            shot_tick=shot_tick,
                            narrative_tick=shot_tick,
                            story_tick=current_story_tick,
                            camera_framing=framing,
                            action_description=action_text,
                            lighting_and_atmosphere=lighting,
                            camera_angle="Low-Angle Tracking" if beat.kinetic_intensity > 0.5 else "Eye-Level Cinematic",
                            render_status="PENDING",
                        )
                        session.add(shot)
                        await session.flush()

                        # Add participant (Sunny)
                        if sunny_node:
                            participant = ShotParticipant(
                                shot_id=shot.shot_id,
                                character_node_id=sunny_node.node_id,
                                spatial_position="CENTER",
                                pose_action="Trudging through mountain snow, holding freezing iron shackles",
                            )
                            session.add(participant)

                        global_shot_counter += 1
                    passage_counter += 1

            await session.commit()
            logger.info(f"Successfully created {len(parsed_scenes)} scenes and {global_shot_counter - 1} shots for Chapter 3!")

        logger.info("=== Chapter 3 Ingestion Finished Successfully ===")


if __name__ == "__main__":
    asyncio.run(main())
