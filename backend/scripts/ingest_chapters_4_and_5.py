"""High-Performance Batch Ingestion for Chapter 4 ('Mountain King') & Chapter 5 ('Broken Chains').

Ingests both chapters into Supabase:
1. Extracts text from EPUB.
2. Registers DocumentUnits, KnowledgeNodes, and NodeStates.
3. Segments chapters into macro scenes and discourse beats via DiscourseBeatChunker.
4. Allocates 75-85 cinematic shots per chapter via CinematicPacingAllocator.
5. Performs bulk inserts of SourcePassages, Scenes, Shots, and Participants in single flushes.
"""

import asyncio
import logging
import sys
from pathlib import Path

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
logger = logging.getLogger("ingest_ch4_ch5")


async def ingest_chapter(ch_num: int, extra_nodes: list, sunny_state_spec: dict, location_code: str):
    logger.info(f"=== Starting Chapter {ch_num} Ingestion ===")
    epub_path = Path("Novels/Shadow Slave - Volume 1 To 7 Collection.epub")
    parser = EPUBParser(epub_path)
    ch_meta = parser.extract_chapter(ch_num)
    if not ch_meta:
        raise RuntimeError(f"Failed to extract Chapter {ch_num} from EPUB")
    logger.info(f"Loaded Chapter {ch_num}: '{ch_meta.title}' ({ch_meta.word_count} words)")

    async with AsyncSessionLocal() as session:
        ws = (await session.execute(select(Workspace).where(Workspace.code == "SHADOW-SLAVE-UNIVERSE"))).scalars().first()
        book = (await session.execute(select(Book).where(Book.workspace_id == ws.workspace_id))).scalars().first()

        # DocumentUnit
        doc = (await session.execute(
            select(DocumentUnit).where(DocumentUnit.book_id == book.book_id, DocumentUnit.unit_number == ch_num)
        )).scalars().first()
        if not doc:
            doc = DocumentUnit(
                book_id=book.book_id,
                unit_number=ch_num,
                unit_type="CHAPTER",
                title=f"Chapter {ch_num}: {ch_meta.title}",
                raw_text=ch_meta.raw_text,
                processing_status="PROCESSED",
            )
            session.add(doc)
            await session.flush()
            logger.info(f"Created DocumentUnit for Chapter {ch_num}: {doc.unit_id}")

        # Register Master Entities
        node_map = {}
        for code, cat, name, aliases, summary in extra_nodes:
            node = (await session.execute(select(KnowledgeNode).where(KnowledgeNode.node_code == code))).scalars().first()
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

        # Retrieve Sunny
        sunny_node = (await session.execute(select(KnowledgeNode).where(KnowledgeNode.node_code == "CHAR-SUNNY"))).scalars().first()
        if sunny_node and sunny_state_spec:
            code = sunny_state_spec["code"]
            st = (await session.execute(select(NodeState).where(NodeState.state_code == code))).scalars().first()
            if not st:
                st = NodeState(
                    node_id=sunny_node.node_id,
                    state_code=code,
                    state_label=sunny_state_spec["label"],
                    compiled_specification=sunny_state_spec["spec"],
                    valid_from_tick=ch_num * 1000000,
                    revealed_at_tick=BiTemporalTickCalculator.compute_narrative_tick(1, ch_num, 1, 1),
                    approval_status="APPROVED",
                )
                session.add(st)
                logger.info(f"Recorded Sunny State: {code}")

        # Check existing scenes
        existing_scenes = (await session.execute(
            select(FictionScene).where(FictionScene.chapter_unit_id == doc.unit_id)
        )).scalars().all()
        if existing_scenes:
            logger.info(f"Chapter {ch_num} already has {len(existing_scenes)} scenes. Skipping scene creation.")
            await session.commit()
            return

        # Chunk beats
        chunker = DiscourseBeatChunker(target_beat_words=170, min_scene_words=120)
        parsed_scenes = chunker.parse_chapter_text(ch_meta.raw_text)
        allocator = CinematicPacingAllocator(target_chapter_shots=80, min_chapter_shots=72, max_chapter_shots=90)
        shot_budgets = allocator.allocate_shot_budgets(parsed_scenes)

        loc_node = node_map.get(location_code) or (
            await session.execute(select(KnowledgeNode).where(KnowledgeNode.node_code == location_code))
        ).scalars().first()

        passage_counter = 1
        global_shot_counter = 1
        current_story_tick = ch_num * 1000000

        for s_idx, p_scene in enumerate(parsed_scenes):
            scene_order = s_idx + 1
            scene_start_tick = BiTemporalTickCalculator.compute_narrative_tick(1, ch_num, min(scene_order, 99), 1)

            fic_scene = FictionScene(
                workspace_id=ws.workspace_id,
                chapter_unit_id=doc.unit_id,
                scene_number=scene_order,
                location_node_id=loc_node.node_id if loc_node else None,
                start_narrative_tick=scene_start_tick,
                start_story_tick=current_story_tick,
            )
            session.add(fic_scene)
            await session.flush()

            # Bulk collect passages, shots, participants
            passages_to_add = []
            shots_to_add = []
            participants_to_add = []

            for b_idx, beat in enumerate(p_scene.beats):
                p_order = passage_counter
                passage = SourcePassage(
                    unit_id=doc.unit_id,
                    book_id=book.book_id,
                    passage_order=p_order,
                    exact_quote=beat.text[:2000],
                )
                session.add(passage)
                await session.flush()  # needed for passage_id FK

                shots_count = shot_budgets.get(beat.passage_order_in_chapter, 3)
                for shot_i in range(shots_count):
                    shot_order = shot_i + 1
                    shot_tick = BiTemporalTickCalculator.compute_narrative_tick(1, ch_num, min(scene_order, 99), min(shot_order, 999))
                    current_story_tick = BiTemporalTickCalculator.compute_linear_story_tick(current_story_tick)

                    framing = "EXTREME_WIDE" if (shot_i == 0 and b_idx == 0) else ("WIDE" if shot_i == 0 else ("MEDIUM_FULL" if shot_i == 1 else "CLOSE_UP"))
                    action = f"Ch {ch_num} Beat {p_order}: {beat.text[:140]}..."

                    shot = FictionShot(
                        scene_id=fic_scene.scene_id,
                        source_passage_id=passage.passage_id,
                        shot_number=shot_order,
                        shot_number_in_chapter=global_shot_counter,
                        shot_tick=shot_tick,
                        narrative_tick=shot_tick,
                        story_tick=current_story_tick,
                        camera_framing=framing,
                        action_description=action,
                        lighting_and_atmosphere="Violent blizzard snowstorm, shattered rock dust, crimson twilight flare",
                        camera_angle="Dynamic Action Tracking" if beat.kinetic_intensity > 0.4 else "Cinematic Eye-Level",
                        render_status="PENDING",
                    )
                    session.add(shot)
                    await session.flush()

                    if sunny_node:
                        participants_to_add.append(
                            ShotParticipant(
                                shot_id=shot.shot_id,
                                character_node_id=sunny_node.node_id,
                                spatial_position="CENTER",
                                pose_action="Desperate combat survival maneuver amidst falling rock shards",
                            )
                        )
                    global_shot_counter += 1
                passage_counter += 1

            if participants_to_add:
                session.add_all(participants_to_add)

        await session.commit()
        logger.info(f"✓ Chapter {ch_num} Ingested successfully with {global_shot_counter - 1} shots!")


async def main():
    # Chapter 4 Nodes & Sunny State
    ch4_nodes = [
        (
            "LOC-AVALANCHE-CHASM",
            NodeCategory.LOCATION,
            "Shattered Avalanche Chasm",
            ["Rockfall Gorge", "The Crushed Pass"],
            "A violent rockfall site on the mountain trail where tons of ice shards and boulders rain down from above.",
        ),
        (
            "CREATURE-MOUNTAIN-KING",
            NodeCategory.PERSON_OR_CHARACTER,
            "Mountain King (Dormant Tyrant)",
            ["Giant Centipede Beast", "Colossal Abomination", "Nightmare Monster"],
            "A horrifying colossal nightmare creature with black chitinous armor plates, hundred scythe legs, and acidic mandibles.",
        ),
        (
            "CREATURE-MOUNTAIN-KING-LARVA",
            NodeCategory.PERSON_OR_CHARACTER,
            "Mountain King Larva",
            ["Dormant Beast", "Caravan Stalker", "Chitinous Larva"],
            "A vicious human-sized larva with razor serrated legs and glistening black carapace hunting panicked slaves.",
        ),
    ]
    ch4_sunny = {
        "code": "CHAR-SUNNY-STATE-CH4-AVALANCHE-SURVIVAL",
        "label": "Sunny (First Nightmare - Avalanche & Beast Encounter)",
        "spec": {
            "aspect": "Temple Slave",
            "attributes": ["Fated", "Mark of Divinity", "Child of Shadows"],
            "physical_condition": "Bleeding cuts from ice shards, torn burlap tunic, frantic adrenaline, desperate calculations",
            "accessories": "Dragging heavy iron chain bound to dead slaves",
        },
    }

    # Chapter 5 Nodes & Sunny State
    ch5_nodes = [
        (
            "ITEM-BROKEN-SLAVE-CHAINS",
            NodeCategory.ITEM_OR_ARTIFACT,
            "Snapped Iron Slave Chains (Flail)",
            ["Bloodied Iron Chain", "Improvised Weapon"],
            "A heavy length of snapped iron chain with sharp jagged fracture link, wielded by Sunny as a lethal garrote and flail.",
        ),
        (
            "LOC-LARVA-BATTLE-SLUSH",
            NodeCategory.LOCATION,
            "Bloodstained Snow Battle Arena",
            ["The Larva Kill Site", "Slush Battlefield"],
            "Snowbank drenched in steaming black monster ichor and red blood where Sunny fought the larva to the death.",
        ),
    ]
    ch5_sunny = {
        "code": "CHAR-SUNNY-STATE-CH5-FIRST-KILL-AWAKENING",
        "label": "Sunny (First Nightmare - Beast Slayer & Shadow Aspect Awakened)",
        "spec": {
            "aspect": "Shadow Slave",
            "true_name": "Lost from Light",
            "rank": "Aspirant",
            "soul_core": "Dormant (1/1000 Shadow Fragments)",
            "apparel": "Shredded bloody burlap, gore splattered across face and chest",
            "weapon": "Snapped iron slave chain weapon",
            "physical_condition": "Bruised ribs, lacerated hands, euphoric exhaustion, cold lethal gaze",
        },
    }

    await ingest_chapter(4, ch4_nodes, ch4_sunny, "LOC-AVALANCHE-CHASM")
    await ingest_chapter(5, ch5_nodes, ch5_sunny, "LOC-LARVA-BATTLE-SLUSH")
    logger.info("=== Both Chapters 4 & 5 Ingestion Finished! ===")


if __name__ == "__main__":
    asyncio.run(main())

