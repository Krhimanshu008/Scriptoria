# tests/test_staging_models.py
import uuid
import pytest
from app.models.core_staging import (
    StagedScene,
    StagedBeat,
    StagedCharacter,
    StagedCostume,
    StagedLocation,
    StagedEnvironment,
    StagingProcessingStatus,
    StagingEntityStatus,
)


def test_staged_scene_instantiation_and_structure():
    ws_id = uuid.uuid4()
    scene_id = uuid.uuid4()
    char_id = uuid.uuid4()

    # 1. Staged Costume
    costume = StagedCostume(
        costume_id=uuid.uuid4(),
        character_mention_id=char_id,
        headwear="Silver circlet",
        upper_body="Tattered black wool tunic",
        lower_body="Dark leather breeches",
        footwear="Riding boots",
        accessories_and_jewelry=["Dragon amulet"],
        equipped_weapon="Broadsword",
        color_palette=["#111114", "#8B0000"],
        wear_tear_level="BATTLE_DAMAGED",
    )

    # 2. Staged Character
    char = StagedCharacter(
        mention_id=char_id,
        scene_id=scene_id,
        raw_name="Arthur the Wanderer",
        canonical_name="Arthur Pendragon",
        tier="MAIN",
        emotional_state="Determined",
        physical_condition="Limping, bleeding right arm",
        active_posture="Kneeling before the shrine",
        dialogue_snippets=["The dawn has not yet broken..."],
        status=StagingEntityStatus.APPROVED,
        costumes=[costume],
    )

    # 3. Staged Location
    loc = StagedLocation(
        location_id=uuid.uuid4(),
        scene_id=scene_id,
        location_name="Ruins of Avalon Shrine",
        category="EXTERIOR",
        architectural_style="Ancient Celtic Megalith",
        spatial_dimensions="Wide open circular stone circle",
        key_landmarks=["Shattered sundial", "Central runic altar"],
        floor_surface="Overgrown mossy cobblestones",
        status=StagingEntityStatus.APPROVED,
    )

    # 4. Staged Environment
    env = StagedEnvironment(
        env_id=uuid.uuid4(),
        scene_id=scene_id,
        primary_light_source="Pre-dawn twilight & waning crescent moon",
        lighting_quality="High-contrast moody chiaroscuro",
        color_cast="#1c2541",
        weather="Dense cold mist",
        atmospheric_particles="Swirling fog motes",
        wind_intensity="Gentle chill breeze",
        audio_ambience="Distant raven caws and rustling autumn leaves",
    )

    # 5. Staged Beat
    beat = StagedBeat(
        beat_id=uuid.uuid4(),
        scene_id=scene_id,
        passage_order=1,
        narrative_tick=1000,
        raw_text="The cold mist clung to Arthur's tunic as he knelt.",
        word_count=10,
        kinetic_intensity=0.2,
        dialogue_density=0.0,
        is_flashback=False,
        time_of_day_hint="Dawn",
    )

    # 6. Assemble Full Staged Scene
    scene = StagedScene(
        scene_id=scene_id,
        workspace_id=ws_id,
        chapter_number=1,
        scene_order_in_chapter=1,
        temporal_tick_start=1000,
        temporal_tick_end=1500,
        time_of_day="Dawn",
        scene_type="ACTION",
        scene_heading="SCENE 1: THE CRUMBLING SHRINE",
        raw_text_chunk="The cold mist clung to Arthur's tunic as he knelt...",
        word_count=150,
        processing_status=StagingProcessingStatus.EXTRACTED,
        beats=[beat],
        characters=[char],
        locations=[loc],
        environment=env,
    )

    # Assertions
    assert scene.scene_heading == "SCENE 1: THE CRUMBLING SHRINE"
    assert len(scene.characters) == 1
    assert scene.characters[0].raw_name == "Arthur the Wanderer"
    assert len(scene.characters[0].costumes) == 1
    assert scene.characters[0].costumes[0].equipped_weapon == "Broadsword"
    assert len(scene.locations) == 1
    assert scene.locations[0].location_name == "Ruins of Avalon Shrine"
    assert scene.environment.weather == "Dense cold mist"
    assert len(scene.beats) == 1
    assert scene.beats[0].kinetic_intensity == 0.2
