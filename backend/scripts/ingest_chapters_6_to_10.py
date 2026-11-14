"""High-Performance Batch Ingestion for Chapters 6 through 10 of Shadow Slave.

Ingests Chapters 6, 7, 8, 9, 10 into Supabase:
1. Extracts text from EPUB.
2. Registers DocumentUnits, KnowledgeNodes, and NodeStates.
3. Segments chapters into macro scenes and discourse beats via DiscourseBeatChunker.
4. Allocates 70-85 cinematic shots per chapter via CinematicPacingAllocator.
5. Performs bulk inserts of SourcePassages, Scenes, Shots, and Participants.
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
logger = logging.getLogger("ingest_ch6_10")


CHAPTERS_CONFIG = [
    {
        "ch_num": 6,
        "location_code": "LOC-CARAVAN-CARNAGE",
        "nodes": [
            (
                "LOC-CARAVAN-CARNAGE",
                NodeCategory.LOCATION,
                "Caravan Carnage Crossroads",
                ["The Slaughter Site", "Crushed Caravan Center"],
                "The shattered middle section of the caravan trail strewn with trampled snow, shattered iron shackles, and bloodied guard armor.",
            ),
        ],
        "sunny_state": {
            "code": "CHAR-SUNNY-STATE-CH6-SHADOW-STEALTH",
            "label": "Sunny (First Nightmare - Shadow Stealth & Combat Calculation)",
            "spec": {
                "aspect": "Shadow Slave",
                "attributes": ["Fated", "Mark of Divinity", "Child of Shadows"],
                "tactics": "Stealth observation from rocky crevices, utilizing falling snow as visual camouflage",
                "physical_condition": "Adrenaline surge, blackened fingertips from cold metal chains, razor focus",
            },
        },
    },
    {
        "ch_num": 7,
        "location_code": "LOC-SUPPLY-WAGON-LINE",
        "nodes": [
            (
                "LOC-SUPPLY-WAGON-LINE",
                NodeCategory.LOCATION,
                "Supply Wagon Ridge Road",
                ["Overturned Wagon Site", "The Slope Barrier"],
                "A steep descending trail where a heavy wooden baggage wagon sits abandoned amidst howling blizzard winds.",
            ),
            (
                "ITEM-SUPPLY-WAGON",
                NodeCategory.ITEM_OR_ARTIFACT,
                "Imperial Baggage Supply Wagon",
                ["Wooden Wagon", "Heavy Freight Cart"],
                "A sturdy oak baggage wagon with iron-rimmed spoke wheels, used as an improvised battering ram down the snowy slope.",
            ),
        ],
        "sunny_state": {
            "code": "CHAR-SUNNY-STATE-CH7-COOPERATIVE-SURVIVAL",
            "label": "Sunny (First Nightmare - Four Survivors Alliance)",
            "spec": {
                "aspect": "Shadow Slave",
                "allies": ["Hero Soldier", "Shifty Slave", "Scholar Slave"],
                "physical_condition": "Bruised shoulders from pushing wagon, frost-bitten ears, cynical camaraderie",
            },
        },
    },
    {
        "ch_num": 8,
        "location_code": "LOC-WAGON-CRASH-DEBRIS",
        "nodes": [
            (
                "LOC-WAGON-CRASH-DEBRIS",
                NodeCategory.LOCATION,
                "Wagon Crash Debris Field",
                ["Splintered Wood Chasm", "The Beast's Grave"],
                "A smoke-tinged crash zone filled with splintered timber, spilled grains, and a motionless mound of snow covering the beast.",
            ),
        ],
        "sunny_state": {
            "code": "CHAR-SUNNY-STATE-CH8-PARANOID-PERCEPTION",
            "label": "Sunny (First Nightmare - Paranoid Spell Instinct)",
            "spec": {
                "aspect": "Shadow Slave",
                "perception": "Shadow senses warning that the dormant tyrant has not been registered as slain by the Spell",
                "physical_condition": "Tense posture, gripping jagged chain link, shivering in freezing gale",
            },
        },
    },
    {
        "ch_num": 9,
        "location_code": "LOC-UNTRACKED-HIGH-SLOPE",
        "nodes": [
            (
                "LOC-UNTRACKED-HIGH-SLOPE",
                NodeCategory.LOCATION,
                "Untracked Mountain Snowfield",
                ["Upper Mountain Traverse", "The Blind Ascent"],
                "A treacherous pathless snowfield high above the road, flanked by unstable ice cornices and bottomless drops.",
            ),
        ],
        "sunny_state": {
            "code": "CHAR-SUNNY-STATE-CH9-BLIND-ASCENT",
            "label": "Sunny (First Nightmare - High Altitude Traverse)",
            "spec": {
                "aspect": "Shadow Slave",
                "physical_condition": "Severe hypothermia onset, ragged breathing in thin air, bare feet frozen numb in snow drifts",
            },
        },
    },
    {
        "ch_num": 10,
        "location_code": "LOC-CREVASSE-AMBUSH-CRUST",
        "nodes": [
            (
                "LOC-CREVASSE-AMBUSH-CRUST",
                NodeCategory.LOCATION,
                "Crevasse Ambush Fissure",
                ["The Shattered Crust", "Under-Ice Tunnel"],
                "A sudden cavernous sinkhole in the deep snow where the Mountain King bursts upward through the frozen crust.",
            ),
        ],
        "sunny_state": {
            "code": "CHAR-SUNNY-STATE-CH10-FIRST-CASUALTY-SHOCK",
            "label": "Sunny (First Nightmare - Subterranean Tyrant Strike)",
            "spec": {
                "aspect": "Shadow Slave",
                "emotional_tone": "Visceral horror, grim fatalism, lightning evasion reflexes",
                "physical_condition": "Dragged along snow crust, bloody elbows, icy adrenaline overdrive",
            },
        },
    },
]


async def ingest_single_chapter(cfg: dict):
    ch_num = cfg["ch_num"]
    logger.info(f"=== Ingesting Chapter {ch_num} ===")

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
        for code, cat, name, aliases, summary in cfg["nodes"]:
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
        if sunny_node and cfg.get("sunny_state"):
            s_cfg = cfg["sunny_state"]
            st = (await session.execute(select(NodeState).where(NodeState.state_code == s_cfg["code"]))).scalars().first()
            if not st:
                st = NodeState(
                    node_id=sunny_node.node_id,
                    state_code=s_cfg["code"],
                    state_label=s_cfg["label"],
                    compiled_specification=s_cfg["spec"],
                    valid_from_tick=ch_num * 1000000,
                    revealed_at_tick=BiTemporalTickCalculator.compute_narrative_tick(1, ch_num, 1, 1),
                    approval_status="APPROVED",
                )
                session.add(st)
                logger.info(f"Recorded Sunny State: {s_cfg['code']}")

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
        allocator = CinematicPacingAllocator(target_chapter_shots=80, min_chapter_shots=70, max_chapter_shots=90)
        shot_budgets = allocator.allocate_shot_budgets(parsed_scenes)

        loc_code = cfg["location_code"]
        loc_node = node_map.get(loc_code) or (
            await session.execute(select(KnowledgeNode).where(KnowledgeNode.node_code == loc_code))
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
                await session.flush()

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
                        lighting_and_atmosphere="High mountain blizzard twilight, icy jagged cliffs, ominous shadows in snowfall",
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
                                pose_action="Trudging through mountain snow, vigilant survival stance",
                            )
                        )
                    global_shot_counter += 1
                passage_counter += 1

            if participants_to_add:
                session.add_all(participants_to_add)

        await session.commit()
        logger.info(f"✓ Chapter {ch_num} successfully ingested with {global_shot_counter - 1} shots!")


async def main():
    logger.info("=== Starting Ingestion for Chapters 6 through 10 ===")
    for cfg in CHAPTERS_CONFIG:
        await ingest_single_chapter(cfg)
    logger.info("=== Successfully Ingested Chapters 6 through 10! ===")


if __name__ == "__main__":
    asyncio.run(main())

