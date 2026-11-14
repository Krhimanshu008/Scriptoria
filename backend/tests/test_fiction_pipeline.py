# tests/test_fiction_pipeline.py
import pytest
from app.core.database import AsyncSessionLocal
from app.models.core_sources import Workspace, WorkspaceDomain, Book, DocumentUnit
from app.models.core_knowledge import KnowledgeNode, NodeCategory, EpistemicStatus
from app.models.domain_fiction import FictionScene, FictionShot, ShotParticipant
from app.services.phase1_core.claim_governance import ClaimGovernanceService
from app.services.phase1_core.retcon_repair import RetconRepairEngine, RetconTriageDecision
from app.services.phase2_ingestion.beat_chunker import DiscourseBeatChunker
from app.services.phase3_visual.shot_decomposer import CinematicPacingAllocator, CameraFraming


SCENE_1_TEXT = (
    "The morning mist clung to the cobblestones of the outer courtyard as Arthur adjusted the heavy iron straps of his leather tunic. "
    "High above the battlements, black crows circled the ancient watchtower in slow, deliberate arcs, their cries echoing across the desolate northern valley. "
    "Cold wind tore through the arrow slits, carrying the sharp scent of oncoming pine smoke and wet timber.\n\n"
    '"You are late, boy," Master Vance growled, stepping out from beneath the shadow of the stone archway with his arms crossed over a scarred chest plate. '
    "His one good eye caught the faint silver glint of the dawn sun.\n\n"
    '"The armory quartermaster refused to release the training blades until the morning horn sounded," Arthur replied quietly, keeping his gaze steady and his breathing disciplined.\n\n"Excuses do not parry steel when the raiders cross the river," Vance snapped, kicking a dulled iron shortsword across the gravel toward Arthur\'s boots. '
    '"Pick it up. If you cannot hold the center of the ring for five minutes, you will sleep in the kennels tonight."'
)

SCENE_2_TEXT = (
    "Three hours later, the midday sun beat down mercilessly upon the chalk sparring pit. "
    "Sweat stung Arthur's eyes as Vance lunged with terrifying speed, his heavy broadsword cleaving the air with a vicious whistle. "
    "Arthur pivoted hard on his back heel, driving his iron guard upward just in time to deflect the iron edge in a blinding shower of sparks.\n\n"
    "The bone-jarring impact vibrated through Arthur's wrists into his shoulders, forcing a sharp gasp of breath from his lungs. "
    "Vance gave him no quarter; spinning effortlessly on his left boot, the veteran warrior drove a brutal armored kick directly into Arthur's ribs, "
    "sending the young squire sprawling across the dust.\n\n"
    "Arthur rolled with the momentum, his fingers clawing into the loose grit as the tip of Vance's blade stabbed deep into the earth where his neck had rested. "
    "Scrambling to his feet, Arthur tightened his two-handed grip on the hilt, feeling the surge of adrenaline sharpen his senses to razor focus."
)

SCENE_3_TEXT = (
    "Across the castle courtyard, Lady Yvaine observed the duel from the high wooden gallery. "
    "The royal banner of the silver griffin fluttered weakly in the stagnant summer heat. "
    "She pressed her fingertips against the carved oak balustrade, watching the boy's footwork with calculated interest.\n\n"
    '"He anticipates the master\'s follow-through," her steward whispered, standing half a pace behind her shoulder. '
    '"Yet his stance is too narrow to withstand another overhead blow."\n\n"He learns faster than his brothers did," Yvaine answered without turning her head. '
    '"Send word to the physician. When this trial concludes, Arthur will have need of willow bark and clean linen."'
)

SAMPLE_CHAPTER_TEXT = (SCENE_1_TEXT + "\n\n* * *\n\n" + SCENE_2_TEXT + "\n\n* * *\n\n" + SCENE_3_TEXT + "\n\n* * *\n\n") * 7


def test_discourse_beat_chunker_and_80_to_100_shot_allocator():
    chunker = DiscourseBeatChunker(target_beat_words=180, min_scene_words=120)
    scenes = chunker.parse_chapter_text(SAMPLE_CHAPTER_TEXT)

    # Verify explicit '* * *' and temporal shifts produced distinct scenes
    assert len(scenes) >= 2
    total_beats = sum(len(s.beats) for s in scenes)
    assert 15 <= total_beats <= 30

    # Verify Pacing Allocator hits exact 80-100 shots and weights combat higher than quiet opening
    allocator = CinematicPacingAllocator(target_chapter_shots=90, min_chapter_shots=80, max_chapter_shots=100)
    budgets = allocator.allocate_shot_budgets(scenes)

    total_allocated_shots = sum(budgets.values())
    assert 80 <= total_allocated_shots <= 100
    assert total_allocated_shots == 90


@pytest.mark.asyncio
async def test_retroactive_retcon_inpainting_triage():
    async with AsyncSessionLocal() as session:
        # 1. Setup Workspace, Book, Chapter, and Protagonist
        ws = Workspace(code="NOVEL-RETCON-TEST", title="Blade of Dawn", domain=WorkspaceDomain.FICTION_UNIVERSE)
        session.add(ws)
        await session.flush()

        book = Book(workspace_id=ws.workspace_id, title="Volume 1", book_order_in_workspace=1)
        session.add(book)
        await session.flush()

        ch1_unit = DocumentUnit(book_id=book.book_id, unit_type="CHAPTER", unit_number=1, title="Chapter 1")
        session.add(ch1_unit)
        await session.flush()

        arthur = KnowledgeNode(
            workspace_id=ws.workspace_id,
            node_code="CHAR-0001",
            category=NodeCategory.PERSON_OR_CHARACTER,
            canonical_name="Arthur Pendragon",
        )
        session.add(arthur)
        await session.flush()

        governance = ClaimGovernanceService(session)
        state_s01 = await governance.evolve_node_state(
            node_id=arthur.node_id,
            new_state_code="CHAR-0001-S01",
            new_state_label="Ch 1 State",
            transition_story_tick=1000,
            revealed_narrative_tick=1000101001,
            attribute_deltas={"eye_color": "blue"},
        )

        # 2. Create 2 Historical Shots in Chapter 1:
        #    Shot 1 = EXTREME_WIDE_ESTABLISHING (Eyes not visible at scale)
        #    Shot 2 = CLOSE_UP (Eyes prominently visible!)
        scene_1 = FictionScene(
            workspace_id=ws.workspace_id,
            chapter_unit_id=ch1_unit.unit_id,
            scene_number=1,
            start_narrative_tick=1000101001,
            end_narrative_tick=1000101002,
            start_story_tick=1000,
            end_story_tick=2000,
        )
        session.add(scene_1)
        await session.flush()

        shot_wide = FictionShot(
            scene_id=scene_1.scene_id,
            shot_number=1,
            shot_number_in_chapter=1,
            narrative_tick=1000101001,
            story_tick=1000,
            action_description="Distant silhouette of Arthur walking across courtyard.",
            camera_framing=CameraFraming.EXTREME_WIDE_ESTABLISHING.value,
            shot_type=CameraFraming.EXTREME_WIDE_ESTABLISHING.value,
        )
        shot_closeup = FictionShot(
            scene_id=scene_1.scene_id,
            shot_number=2,
            shot_number_in_chapter=2,
            narrative_tick=1000101002,
            story_tick=2000,
            action_description="Tight focus on Arthur's eyes narrowing as he catches the sword.",
            camera_framing=CameraFraming.CLOSE_UP.value,
            shot_type=CameraFraming.CLOSE_UP.value,
        )
        session.add_all([shot_wide, shot_closeup])
        await session.flush()

        session.add_all([
            ShotParticipant(
                shot_id=shot_wide.shot_id,
                character_node_id=arthur.node_id,
                resolved_state_id=state_s01.state_id,
                expression="focused",
            ),
            ShotParticipant(
                shot_id=shot_closeup.shot_id,
                character_node_id=arthur.node_id,
                resolved_state_id=state_s01.state_id,
                expression="intense glare",
            ),
        ])
        await session.flush()

        # 3. Simulate Chapter 14 Retcon (narrative_tick = 1001401001): 'blue' -> 'emerald green'
        repair_engine = RetconRepairEngine(session)
        inpaint_queue = await repair_engine.generate_retroactive_inpaint_queue(
            character_node_id=arthur.node_id,
            retconned_attribute="eye_color",
            superseded_value="blue",
            new_canonical_value="emerald green",
            discovery_narrative_tick=1001401001,
            valid_from_story_tick=0,
        )

        assert len(inpaint_queue) == 2
        task_wide = next(t for t in inpaint_queue if t.shot_id == shot_wide.shot_id)
        task_closeup = next(t for t in inpaint_queue if t.shot_id == shot_closeup.shot_id)

        # Verify Shot 1 (Extreme Wide) is skipped while Shot 2 (Close-Up) gets a surgical SAM2 eye inpaint payload
        assert task_wide.triage_decision == RetconTriageDecision.SKIP_NOT_VISIBLE_AT_SCALE
        assert task_closeup.triage_decision == RetconTriageDecision.REQUIRES_TARGETED_INPAINT
        assert "iris" in task_closeup.sam2_segmentation_prompt
        assert "blue" in task_closeup.inpaint_negative_prompt_purge
        assert "emerald green" in task_closeup.inpaint_positive_prompt_delta

        await session.rollback()
