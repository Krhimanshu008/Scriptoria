"""Ingestion and Bi-Temporal State Evolution for Chapter 2: Slave Caravan.

Ingests Chapter 2 of Shadow Slave into Supabase:
1. Extracts Chapter 2 from EPUB.
2. Registers DocumentUnit and SourcePassages.
3. Registers Master Characters, Locations, Items, and Sunny's State Evolution at Tick 2.
4. Breaks down chapter into scenes and beats via DiscourseBeatChunker.
5. Computes cinematic shot allocation (80-90 shots) via CinematicPacingAllocator.
6. Persists scenes and shots into domain_fiction tables.
"""

import asyncio
import logging
import os
import sys
from pathlib import Path
from uuid import uuid4

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.core_sources import Workspace, Book, DocumentUnit, SourcePassage
from app.models.core_knowledge import KnowledgeNode, NodeCategory, NodeState
from app.models.domain_fiction import FictionScene, FictionShot, ShotParticipant, CameraFraming
from app.services.phase2_ingestion.epub_parser import EPUBParser
from app.services.phase2_ingestion.beat_chunker import DiscourseBeatChunker
from app.services.phase3_visual.shot_decomposer import CinematicPacingAllocator
from app.services.phase1_core.tick_calculator import BiTemporalTickCalculator

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("ingest_ch2")


async def main():
    logger.info("=== Starting Chapter 2: Slave Caravan Ingestion ===")

    # 1. Parse Chapter 2 from EPUB
    epub_path = Path("Novels/Shadow Slave - Volume 1 To 7 Collection.epub")
    parser = EPUBParser(epub_path)
    ch2 = parser.extract_chapter(2)
    logger.info(f"Loaded Chapter 2: '{ch2.title}' ({ch2.word_count} words)")

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

        # Retrieve or create DocumentUnit for Chapter 2
        stmt_doc = select(DocumentUnit).where(
            DocumentUnit.book_id == book.book_id,
            DocumentUnit.unit_number == 2,
        )
        doc = (await session.execute(stmt_doc)).scalars().first()
        if not doc:
            doc = DocumentUnit(
                book_id=book.book_id,
                unit_number=2,
                unit_type="CHAPTER",
                title=f"Chapter 2: {ch2.title}",
                raw_text=ch2.raw_text,
                processing_status="PROCESSED",
            )
            session.add(doc)
            await session.flush()
            logger.info(f"Created DocumentUnit for Chapter 2: {doc.unit_id}")

        # 2. Register Master Entities
        nodes_to_register = [
            # Locations
            (
                "LOC-SHACKLE-MOUNTAIN-PASS",
                NodeCategory.LOCATION,
                "Shackle Mountain Pass",
                ["Frozen Mountain Road", "Impregnable Cliff Trail", "The Abyss Cliff"],
                "Desolate snow-covered high-altitude mountain path carved into sheer vertical cliffs hanging over an endless black abyss.",
            ),
            (
                "LOC-SLAVE-CARAVAN-LINE",
                NodeCategory.LOCATION,
                "The Slave Caravan",
                ["Chained March", "The Slaves' Line", "Imperial Slave Column"],
                "A serpentine line of dozens of starving, hollow-eyed slaves chained by heavy iron shackles marching backwards into antiquity.",
            ),
            # Characters
            (
                "CHAR-HERO-SOLDIER",
                NodeCategory.PERSON_OR_CHARACTER,
                "Heroic Imperial Soldier",
                ["Young Guard", "Handsome Soldier", "White Horse Rider"],
                "A noble, youthful imperial soldier clad in leather cuirass riding a pure white horse, showing pity toward Sunny.",
            ),
            (
                "CHAR-VETERAN-SOLDIER",
                NodeCategory.PERSON_OR_CHARACTER,
                "Veteran Imperial Whip-Master",
                ["Senior Guard", "Cruel Officer", "Older Soldier"],
                "A scarred, ruthless veteran guard who drives the slave caravan with a barbed leather whip and zero mercy.",
            ),
            (
                "CHAR-SLAVE-SHIFTY",
                NodeCategory.PERSON_OR_CHARACTER,
                "Shifty Slave",
                ["Nervous Slave", "Quick-Eyed Slave"],
                "A superstitious, desperate fellow slave shackled directly behind Sunny who curses and panics whenever the chain jerks.",
            ),
            (
                "CHAR-SLAVE-BROAD",
                NodeCategory.PERSON_OR_CHARACTER,
                "Broad-Shouldered Slave",
                ["The Veteran Slave", "Bloodied Back Slave"],
                "A stoic, cynical slave walking ahead of Sunny with a heavily whipped back, resigned to the freezing mountain's death.",
            ),
            (
                "CHAR-SLAVE-SCHOLAR",
                NodeCategory.PERSON_OR_CHARACTER,
                "Scholar Slave",
                ["Gentle Voice Slave", "Educated Slave"],
                "An intelligent, soft-spoken fellow slave who recognizes the divine markings of the destroyed Shadow God temple on Sunny's skin.",
            ),
            # Items
            (
                "ITEM-IRON-SLAVE-SHACKLES",
                NodeCategory.ITEM_OR_ARTIFACT,
                "Iron Slave Shackles",
                ["Wrist Chains", "Freezing Iron Collar", "Imperial Shackles"],
                "Heavy rusted iron cuffs clamped around the wrists of the slaves, biting into bleeding raw flesh and linking the entire column.",
            ),
            (
                "ITEM-SOLDIER-WATER-FLASK",
                NodeCategory.ITEM_OR_ARTIFACT,
                "Imperial Soldier Water Canteen",
                ["Leather Water Flask", "Soldier's Canteen"],
                "A polished military water flask offered by the young soldier to ease Sunny's parched throat.",
            ),
            (
                "ITEM-PUNISHMENT-WHIP",
                NodeCategory.ITEM_OR_ARTIFACT,
                "Imperial Punishment Scourge",
                ["Barbed Whip", "Slave Driver Whip"],
                "A heavy braided leather whip used by the senior guard to enforce obedience and slice through slave tunics.",
            ),
        ]

        mountain_pass_node = None
        for code, category, name, aliases, summary in nodes_to_register:
            stmt_n = select(KnowledgeNode).where(
                KnowledgeNode.workspace_id == ws.workspace_id,
                KnowledgeNode.node_code == code,
            )
            node = (await session.execute(stmt_n)).scalars().first()
            if not node:
                node = KnowledgeNode(
                    workspace_id=ws.workspace_id,
                    node_code=code,
                    category=category,
                    canonical_name=name,
                    aliases=aliases,
                    canonical_summary=summary,
                )
                session.add(node)
                await session.flush()
                logger.info(f"Registered Master Node: {code} ({name})")
            if code == "LOC-SHACKLE-MOUNTAIN-PASS":
                mountain_pass_node = node

        # 3. Register Sunny's Master Character State Evolution at Tick
        ch2_narrative_tick = BiTemporalTickCalculator.compute_narrative_tick(
            book_num=1, chapter_num=2, scene_num=1, shot_num=1
        )
        ch2_story_tick = 2000000  # Story tick for Chapter 2 First Nightmare

        # Retrieve Sunny Node
        stmt_sunny = select(KnowledgeNode).where(
            KnowledgeNode.workspace_id == ws.workspace_id,
            KnowledgeNode.node_code == "CHAR-SUNNY",
        )
        sunny_node = (await session.execute(stmt_sunny)).scalars().first()
        if sunny_node:
            state_code = "CHAR-SUNNY-STATE-CH2-SLAVE"
            stmt_st = select(NodeState).where(NodeState.state_code == state_code)
            existing_state = (await session.execute(stmt_st)).scalars().first()
            if not existing_state:
                sunny_slave_state = NodeState(
                    node_id=sunny_node.node_id,
                    state_code=state_code,
                    state_label="Sunny (First Nightmare - Temple Slave Loadout)",
                    compiled_specification={
                        "aspect": "Temple Slave",
                        "rank": "Aspirant",
                        "soul_core": "Dormant",
                        "attributes": ["Fated", "Mark of Divinity", "Child of Shadows"],
                        "apparel": "Threadbare hemp slave tunic, bare bleeding feet",
                        "accessories": "Heavy iron wrist shackles linking him to the caravan",
                        "physical_condition": "Freezing, malnourished, whipped laceration across back",
                    },
                    valid_from_tick=ch2_story_tick,
                    revealed_at_tick=ch2_narrative_tick,
                    approval_status="APPROVED",
                )
                session.add(sunny_slave_state)
                logger.info("Recorded Bi-Temporal State Evolution (NodeState) for Sunny (Aspect: Temple Slave)")

        await session.commit()

        # 4. Segment Chapter 2 into Macro Scenes and Narrative Beats
        chunker = DiscourseBeatChunker(target_beat_words=170, min_scene_words=120)
        parsed_scenes = chunker.parse_chapter_text(ch2.raw_text)
        total_beats = sum(len(s.beats) for s in parsed_scenes)
        logger.info(f"Segmented into {len(parsed_scenes)} macro scenes and {total_beats} discourse beats")

        # 5. Cinematic Pacing Allocation (80-90 Shots)
        allocator = CinematicPacingAllocator(target_chapter_shots=85, min_chapter_shots=75, max_chapter_shots=95)
        shot_budgets = allocator.allocate_shot_budgets(parsed_scenes)
        total_allocated_shots = sum(shot_budgets.values())
        logger.info(f"Allocated {total_allocated_shots} total cinematic shots across Chapter 2")

        # 6. Persist Scenes and Shots to domain_fiction tables
        passage_counter = 1
        global_shot_counter = 1
        current_story_tick = ch2_story_tick

        for s_idx, p_scene in enumerate(parsed_scenes):
            scene_order = s_idx + 1
            scene_start_tick = BiTemporalTickCalculator.compute_narrative_tick(
                book_num=1, chapter_num=2, scene_num=min(scene_order, 99), shot_num=1
            )

            fic_scene = FictionScene(
                workspace_id=ws.workspace_id,
                chapter_unit_id=doc.unit_id,
                scene_number=scene_order,
                location_node_id=mountain_pass_node.node_id if mountain_pass_node else None,
                start_narrative_tick=scene_start_tick,
                start_story_tick=current_story_tick,
            )
            session.add(fic_scene)
            await session.flush()

            for b_idx, beat in enumerate(p_scene.beats):
                p_tick = BiTemporalTickCalculator.compute_narrative_tick(
                    book_num=1, chapter_num=2, scene_num=min(scene_order, 99), shot_num=min(b_idx + 1, 999)
                )

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

                # Create FictionShot records
                for shot_i in range(shots_for_beat):
                    shot_order = shot_i + 1
                    shot_tick = BiTemporalTickCalculator.compute_narrative_tick(
                        book_num=1, chapter_num=2, scene_num=min(scene_order, 99), shot_num=min(shot_order, 999)
                    )
                    current_story_tick = BiTemporalTickCalculator.compute_linear_story_tick(current_story_tick)

                    if shot_i == 0:
                        framing = "EXTREME_WIDE" if b_idx == 0 else "WIDE"
                    elif shot_i == 1:
                        framing = "MEDIUM_TWO_SHOT" if beat.dialogue_intensity > 0.4 else "MEDIUM_FULL"
                    else:
                        framing = "CLOSE_UP" if beat.kinetic_intensity > 0.4 else "MEDIUM_CLOSE_UP"

                    action_text = f"Action in beat {passage_counter}: {beat.text[:120]}..."
                    lighting = "Pale ghostly moonlight clashing with freezing blizzard drift"

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
                    )
                    session.add(shot)
                    await session.flush()

                    # Add participant (Sunny)
                    if sunny_node:
                        participant = ShotParticipant(
                            shot_id=shot.shot_id,
                            character_node_id=sunny_node.node_id,
                            spatial_position="CENTER",
                            pose_action="Shivering in snow, clutching chains",
                        )
                        session.add(participant)

                    global_shot_counter += 1

                passage_counter += 1

        await session.commit()
        logger.info(f"Successfully committed Chapter 2 ({passage_counter - 1} passages, {global_shot_counter - 1} shots) to Supabase!")


if __name__ == "__main__":
    asyncio.run(main())
