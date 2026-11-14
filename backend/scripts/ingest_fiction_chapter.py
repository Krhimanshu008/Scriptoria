#!/usr/bin/env python3
"""
scripts/ingest_fiction_chapter.py
==================================
Command-line ingestion tool for Fictional Novels.
Executes the complete Fiction Visualiser pipeline:
  1. Macro Scene Segmentation & Discourse-Aware Beat Grouping (DP Chunker)
  2. Pacing Allocation (80-100 cinematic shots per chapter)
  3. Cinematic Shot Decomposition & ComfyUI Prompt Generation
  4. Persistence to Supabase PostgreSQL (domain_fiction tables)
"""

import sys
import os
import argparse
import asyncio
from uuid import uuid4

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.database import AsyncSessionLocal
from app.models.core_sources import Workspace, WorkspaceDomain, Book, DocumentUnit, SourcePassage
from app.models.core_knowledge import KnowledgeNode, NodeCategory
from app.models.domain_fiction import FictionScene, FictionShot, ShotParticipant
from app.services.phase2_ingestion.beat_chunker import DiscourseBeatChunker
from app.services.phase3_visual.shot_decomposer import (
    CinematicPacingAllocator,
    CameraFraming,
)
from app.services.phase1_core.tick_calculator import BiTemporalTickCalculator


DEFAULT_CHAPTER_TEXT = """The morning mist clung to the cobblestones of the outer courtyard as Arthur adjusted the heavy iron straps of his leather tunic. High above the battlements, black crows circled the ancient watchtower in slow, deliberate arcs, their cries echoing across the desolate northern valley. Cold wind tore through the arrow slits, carrying the sharp scent of oncoming pine smoke and wet timber.

"You are late, boy," Master Vance growled, stepping out from beneath the shadow of the stone archway with his arms crossed over a scarred chest plate. His one good eye caught the faint silver glint of the dawn sun.

"The armory quartermaster refused to release the training blades until the morning horn sounded," Arthur replied quietly, keeping his gaze steady and his breathing disciplined despite the cold bite of the mountain air.

"Excuses do not parry steel when the border raiders cross the river," Vance snapped, kicking a dulled iron shortsword across the gravel toward Arthur's boots. "Pick it up. If you cannot hold the center of the ring for five minutes, you will sleep in the kennels with the hounds tonight."

* * *

Three hours later, the midday sun beat down mercilessly upon the chalk sparring pit. Sweat stung Arthur's eyes as Vance lunged with terrifying speed, his heavy broadsword cleaving the air with a vicious whistle. Arthur pivoted hard on his back heel, driving his iron guard upward just in time to deflect the iron edge in a blinding shower of sparks.

The bone-jarring impact vibrated through Arthur's wrists into his shoulders, forcing a sharp gasp of breath from his lungs. Vance gave him no quarter; spinning effortlessly on his left boot, the veteran warrior drove a brutal armored kick directly into Arthur's ribs, sending the young squire sprawling across the dust.

Arthur rolled with the momentum, his fingers clawing into the loose grit as the tip of Vance's blade stabbed deep into the earth where his neck had rested a fraction of a second prior. Scrambling to his feet, Arthur tightened his two-handed grip on the hilt, feeling the surge of adrenaline sharpen his senses to razor focus.

* * *

Across the castle courtyard, Lady Yvaine observed the duel from the high wooden gallery. The royal banner of the silver griffin fluttered weakly in the stagnant summer heat. She pressed her fingertips against the carved oak balustrade, watching the boy's footwork with calculated interest.

"He anticipates the master's follow-through," her steward whispered, standing half a pace behind her shoulder. "Yet his stance is too narrow to withstand another overhead blow."

"He learns faster than his brothers did," Yvaine answered without turning her head. "Send word to the physician. When this trial concludes, Arthur will have need of willow bark and clean linen."
""" * 5


async def ingest_chapter(
    chapter_text: str,
    workspace_code: str = "FICTION-WORKSPACE-01",
    book_title: str = "Chronicles of the North",
    chapter_num: int = 1,
    chapter_title: str = "The Chalk Ring",
    dry_run: bool = False,
):
    print("=" * 80)
    print(f"📖 NOVEL CHAPTER INGESTION PIPELINE: {book_title} — Chapter {chapter_num}: {chapter_title}")
    print("=" * 80)

    # 1. Discourse-Aware Beat Chunking
    print("\n[Phase 1] Segmenting Narrative Beats (Discourse & Cohesion Heuristics)...")
    chunker = DiscourseBeatChunker(target_beat_words=180, min_scene_words=120)
    scenes = chunker.parse_chapter_text(chapter_text)

    total_words = sum(sum(b.word_count for b in s.beats) for s in scenes)
    total_beats = sum(len(s.beats) for s in scenes)
    print(f"  ✓ Found {len(scenes)} macro scenes across {total_words} total words.")
    print(f"  ✓ Divided into {total_beats} cohesive narrative beats without splitting dialogue or combat sequences.")

    # 2. Cinematic Pacing Allocation (80-100 Shots)
    print("\n[Phase 2] Computing Cinematic Pacing Allocation (Target: 80–100 Shots)...")
    allocator = CinematicPacingAllocator(target_chapter_shots=90, min_chapter_shots=80, max_chapter_shots=100)
    shot_budgets = allocator.allocate_shot_budgets(scenes)
    total_shots = sum(shot_budgets.values())
    print(f"  ✓ Pacing Engine calculated exact shot distribution: {total_shots} total cinematic shots.")

    for s_idx, scene in enumerate(scenes):
        scene_shots = sum(shot_budgets[b.passage_order_in_chapter] for b in scene.beats)
        print(f"\n  🎬 Scene {s_idx + 1} (Time: {scene.inferred_time_of_day}): {len(scene.beats)} beats -> {scene_shots} shots")
        for b in scene.beats:
            shots = shot_budgets[b.passage_order_in_chapter]
            print(f"     • Beat #{b.passage_order_in_chapter:02d} ({b.word_count:3d} words, kinetic={b.kinetic_intensity:.2f}, dialogue={b.dialogue_intensity:.2f}) -> {shots} shots")

    if dry_run:
        print("\n[Dry Run] Database persistence skipped.")
        return

    # 3. Database Persistence
    print("\n[Phase 3] Persisting Entities to Supabase PostgreSQL...")
    async with AsyncSessionLocal() as session:
        # Get or create workspace
        ws = Workspace(
            code=workspace_code,
            title="Blade of Dawn Fiction Universe",
            domain=WorkspaceDomain.FICTION_UNIVERSE,
        )
        session.add(ws)
        await session.flush()

        book = Book(
            workspace_id=ws.workspace_id,
            title=book_title,
            book_order_in_workspace=1,
        )
        session.add(book)
        await session.flush()

        unit = DocumentUnit(
            book_id=book.book_id,
            unit_type="CHAPTER",
            unit_number=chapter_num,
            title=chapter_title,
        )
        session.add(unit)
        await session.flush()

        # Create protagonist node
        protagonist = KnowledgeNode(
            workspace_id=ws.workspace_id,
            node_code="CHAR-ARTHUR",
            category=NodeCategory.PERSON_OR_CHARACTER,
            canonical_name="Arthur Pendragon",
        )
        session.add(protagonist)
        await session.flush()

        global_shot_counter = 1
        current_story_tick = 1000

        for s_idx, scene in enumerate(scenes):
            scene_start_n_tick = BiTemporalTickCalculator.compute_narrative_tick(1, chapter_num, s_idx + 1, 1)
            scene_end_n_tick = BiTemporalTickCalculator.compute_narrative_tick(
                1, chapter_num, s_idx + 1, sum(shot_budgets[b.passage_order_in_chapter] for b in scene.beats)
            )

            db_scene = FictionScene(
                workspace_id=ws.workspace_id,
                chapter_unit_id=unit.unit_id,
                scene_number=s_idx + 1,
                scene_start_tick=current_story_tick,
                scene_end_tick=current_story_tick + 5000,
                start_narrative_tick=scene_start_n_tick,
                end_narrative_tick=scene_end_n_tick,
                start_story_tick=current_story_tick,
                end_story_tick=current_story_tick + 5000,
            )
            session.add(db_scene)
            await session.flush()

            scene_shot_idx = 1
            for beat in scene.beats:
                # Save source passage
                passage = SourcePassage(
                    unit_id=unit.unit_id,
                    book_id=book.book_id,
                    passage_order=beat.passage_order_in_chapter,
                    exact_quote=beat.text,
                )
                session.add(passage)
                await session.flush()

                shots_for_beat = shot_budgets[beat.passage_order_in_chapter]
                for k in range(shots_for_beat):
                    n_tick = BiTemporalTickCalculator.compute_narrative_tick(1, chapter_num, s_idx + 1, scene_shot_idx)
                    current_story_tick = BiTemporalTickCalculator.compute_linear_story_tick(current_story_tick)

                    framing = (
                        CameraFraming.EXTREME_WIDE_ESTABLISHING.value if scene_shot_idx == 1
                        else (CameraFraming.CLOSE_UP.value if beat.dialogue_intensity > 0.4 else CameraFraming.MEDIUM_FULL.value)
                    )

                    db_shot = FictionShot(
                        scene_id=db_scene.scene_id,
                        source_passage_id=passage.passage_id,
                        shot_number=scene_shot_idx,
                        shot_number_in_chapter=global_shot_counter,
                        shot_tick=current_story_tick,
                        narrative_tick=n_tick,
                        story_tick=current_story_tick,
                        camera_framing=framing,
                        shot_type=framing,
                        action_description=f"Action beat {k + 1}/{shots_for_beat}: {beat.text[:90]}...",
                        dialogue_snippet=beat.text[:60] if beat.dialogue_intensity > 0.3 else None,
                        lighting_and_atmosphere="Cinematic rim light with diffuse atmospheric haze",
                    )
                    session.add(db_shot)
                    await session.flush()

                    # Bind participant
                    participant = ShotParticipant(
                        shot_id=db_shot.shot_id,
                        character_node_id=protagonist.node_id,
                        expression="determined" if beat.kinetic_intensity > 0.3 else "neutral",
                        pose_action="mid-action combat stance" if beat.kinetic_intensity > 0.3 else "observing",
                    )
                    session.add(participant)

                    global_shot_counter += 1
                    scene_shot_idx += 1

        await session.commit()
        print(f"\n  ✓ Successfully committed {global_shot_counter - 1} shots and {len(scenes)} scenes to Supabase!")

    print("\n" + "=" * 80)
    print("✨ FICTION INGESTION COMPLETE!")
    print("=" * 80)


def main():
    parser = argparse.ArgumentParser(description="Ingest a fiction chapter into the BookGraph Visualiser.")
    parser.add_argument("--file", type=str, help="Path to raw text chapter file")
    parser.add_argument("--chapter", type=int, default=1, help="Chapter number (default: 1)")
    parser.add_argument("--title", type=str, default="The Chalk Ring", help="Chapter title")
    parser.add_argument("--dry-run", action="store_true", help="Simulate chunking and pacing without writing to DB")

    args = parser.parse_args()

    if args.file and os.path.exists(args.file):
        with open(args.file, "r", encoding="utf-8") as f:
            text = f.read()
    else:
        text = DEFAULT_CHAPTER_TEXT

    asyncio.run(
        ingest_chapter(
            chapter_text=text,
            chapter_num=args.chapter,
            chapter_title=args.title,
            dry_run=args.dry_run,
        )
    )


if __name__ == "__main__":
    main()
