# tests/test_agentic_studio.py
import uuid
import pytest
from app.services.phase2_ingestion.beat_chunker import DiscourseBeatChunker
from app.services.phase3_visual.shot_decomposer import (
    CinematicPacingAllocator,
    CinematicShotSpec,
    CameraFraming,
    LensAndDepthSpec,
    LightingAndAtmosphereSpec,
)
from app.agents.studio_graph import AutonomousNovelStudioGraph, ContinuityAuditReport
from tests.test_fiction_pipeline import SAMPLE_CHAPTER_TEXT


class MockLoreAgent:
    async def ainvoke(self, payload):
        return {
            "entities": [{"node_code": "CHAR-0001", "canonical_name": "Arthur", "active_weapon": "iron shortsword"}],
            "new_unapproved_assets": [],
            "retcon_tasks": [],
        }


class MockArtDirectorAgent:
    async def ainvoke(self, payload):
        return payload["pending_assets"]


class MockDoPAgent:
    """Simulates a Director Agent that makes a continuity mistake on Pass 1 and fixes it on Pass 2."""
    async def ainvoke(self, payload):
        critic_feedback = payload.get("critic_feedback")
        is_revision = critic_feedback is not None

        action_text = (
            "Arthur parries with his canonical dulled iron shortsword."
            if is_revision
            else "Arthur blocks with a gleaming royal steel shield."  # <-- Mistake on Pass 1!
        )
        framing = CameraFraming.LOW_ANGLE_HERO if is_revision else CameraFraming.EXTREME_WIDE_ESTABLISHING

        return [
            CinematicShotSpec(
                shot_number_in_chapter=1,
                shot_number_in_scene=1,
                source_passage_order=1,
                narrative_tick=1000101001,
                story_tick=1000,
                camera_framing=framing,
                lens_and_depth=LensAndDepthSpec(
                    focal_length_mm=35,
                    aperture_f_stop="f/2.8",
                    depth_of_field_profile="Cinematic isolation",
                    focus_pull_target="Arthur",
                ),
                lighting_and_atmosphere=LightingAndAtmosphereSpec(
                    lighting_style="Morning mist",
                    key_light_direction="Side-lit dawn sun",
                    volumetric_and_weather_fx=["ground mist"],
                    color_grading_mood="Cool slate dawn",
                ),
                action_beat=action_text,
                emotional_tone="Tense determination",
                character_loadouts=[],
            )
        ]


class MockCriticAgent:
    """Rejects Pass 1 due to the non-canonical 'royal steel shield', approves Pass 2."""
    async def ainvoke(self, payload):
        shots = payload["draft_shots"]
        first_action = shots[0]["action_beat"]
        if "royal steel shield" in first_action:
            return ContinuityAuditReport(
                is_approved=False,
                flagged_shot_numbers=[1],
                critique_directives=[
                    "Shot 1 Violation: CHAR-0001 does not own a 'royal steel shield' at story_tick 1000. "
                    "Replace with canonical 'dulled iron shortsword' and switch framing to LOW_ANGLE_HERO."
                ],
            )
        return ContinuityAuditReport(is_approved=True, flagged_shot_numbers=[], critique_directives=[])


@pytest.mark.asyncio
async def test_langgraph_adversarial_dop_and_critic_self_correction():
    chunker = DiscourseBeatChunker(target_beat_words=200, min_scene_words=120)
    allocator = CinematicPacingAllocator(target_chapter_shots=90)

    studio = AutonomousNovelStudioGraph(
        beat_chunker=chunker,
        pacing_allocator=allocator,
        lore_agent_runnable=MockLoreAgent(),
        art_director_runnable=MockArtDirectorAgent(),
        dop_agent_runnable=MockDoPAgent(),
        critic_agent_runnable=MockCriticAgent(),
    )
    app_graph = studio.compile_graph(interrupt_for_human_approval=False)

    initial_state = {
        "workspace_id": str(uuid.uuid4()),
        "book_id": str(uuid.uuid4()),
        "book_number": 1,
        "chapter_number": 1,
        "raw_chapter_text": SAMPLE_CHAPTER_TEXT,
        "starting_story_tick": 1000,
        "parsed_scenes": [],
        "shot_budget_allocation": {},
        "active_entities_registry": [],
        "pending_new_asset_designs": [],
        "retcon_inpaint_queue": [],
        "draft_chapter_shots": [],
        "continuity_audit": None,
        "dop_revision_count": 0,
        "max_dop_revisions": 3,
        "human_approval_granted": True,
        "agent_execution_log": [],
    }

    config = {"configurable": {"thread_id": "chapter_1_production_thread"}}
    final_state = await app_graph.ainvoke(initial_state, config=config)

    # Verify the graph ran Pass 1 (rejected by Critic), looped back to DoP for Pass 2, and passed!
    assert final_state["dop_revision_count"] == 2
    assert final_state["continuity_audit"]["is_approved"] is True
    assert "dulled iron shortsword" in final_state["draft_chapter_shots"][0]["action_beat"]
    assert len(final_state["agent_execution_log"]) == 7
