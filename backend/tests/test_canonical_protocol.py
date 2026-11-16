import pytest
from pydantic import ValidationError
from app.models.canonical_protocol import (
    ChapterObservation,
    SceneObservation,
    SettingObservation,
    CharacterMention,
    ItemMention,
    VisualBeat,
    TimeClue,
    TimeClueType,
    EntityObservation,
    EntityType,
    RollingEntityGlossary,
    RollingEntityGlossaryItem,
)


def test_valid_canonical_protocol():
    """Verify standard valid ChapterObservation passes validation."""
    obs = ChapterObservation(
        schema_version="1.0.0",
        book_id="book-alchemist-001",
        chapter_index=1,
        chapter_title="Part One - Santiago and the Sheep",
        raw_text_r2_key="parsed/book-alchemist-001/ch_001.md",
        scenes=[
            SceneObservation(
                scene_id="ch001_sc01",
                scene_order_in_chapter=1,
                start_char_offset=0,
                end_char_offset=1240,
                verbatim_excerpt_summary="Santiago arrives at the abandoned church with his flock at dusk.",
                setting=SettingObservation(
                    location_id="loc_abandoned_church",
                    location_name="Abandoned Church with Sycamore Tree",
                    time_of_day="dusk",
                    weather_atmosphere="chilly dusk breeze, quiet pasture",
                    lighting="fading twilight casting long shadows against ruined stone walls",
                    color_palette=["#1F2937", "#92400E", "#D97706"]
                ),
                characters_present=[
                    CharacterMention(
                        entity_id="char_santiago",
                        name_in_scene="the boy",
                        action="sweeping church floor with jacket, laying down with sheep",
                        emotional_state="contemplative, weary",
                        visual_changes=None,
                        clothing_mention="heavy shepherd jacket, worn wool blanket"
                    )
                ],
                items_interacted=[
                    ItemMention(
                        item_id="item_shepherds_crook",
                        item_name="Crook",
                        held_by_entity_id="char_santiago",
                        condition="weathered"
                    )
                ],
                key_visual_beats=[
                    VisualBeat(
                        beat_order=1,
                        shot_suggestion="Wide cinematic shot of ruined Andalusian church with sycamore growing through roof against purple dusk sky",
                        focal_elements=["sycamore tree in nave", "crumbling stone walls", "scattered flock of sheep"],
                        quote_anchor="The roof had fallen in long ago, and an enormous sycamore had grown on the spot..."
                    )
                ],
                time_clue=TimeClue(
                    raw_text="The boy arrived at the church when dusk was falling.",
                    time_type=TimeClueType.PRESENT,
                    delta_hint=None
                )
            )
        ],
        discovered_entities=[
            EntityObservation(
                entity_id="char_santiago",
                canonical_name="Santiago",
                aliases=["the boy", "the shepherd"],
                entity_type=EntityType.CHARACTER,
                static_traits="young Andalusian shepherd, dark curly hair, sunburned skin",
                chapter_state_delta={
                    "clothing": "thick wool shepherd jacket",
                    "items": ["shepherd crook", "book used as pillow"]
                }
            )
        ],
        time_clues=[],
        location_clues=[]
    )
    json_str = obs.model_dump_json()
    assert "ch001_sc01" in json_str
    assert obs.scenes[0].characters_present[0].entity_id == "char_santiago"


def test_rejection_extra_field():
    """EC-0.1: Forbid extra hallucinated fields from LLM."""
    with pytest.raises(ValidationError) as exc:
        ChapterObservation(
            schema_version="1.0.0",
            book_id="test",
            chapter_index=1,
            chapter_title="Test",
            raw_text_r2_key="parsed/test/ch_001.md",
            scenes=[],
            discovered_entities=[],
            time_clues=[],
            location_clues=[],
            hallucinated_ai_note="This should fail"  # Forbidden!
        )
    assert "Extra inputs are not permitted" in str(exc.value)


def test_rejection_inverted_offsets():
    """EC-0.1: Validate start_char_offset cannot exceed end_char_offset."""
    with pytest.raises(ValidationError) as exc:
        SceneObservation(
            scene_id="ch001_sc01",
            scene_order_in_chapter=1,
            start_char_offset=5000,
            end_char_offset=200,  # Invalid!
            verbatim_excerpt_summary="Invalid test",
            setting=SettingObservation(
                location_id="loc_test",
                location_name="Test Loc"
            ),
            characters_present=[],
            items_interacted=[],
            key_visual_beats=[
                VisualBeat(
                    beat_order=1,
                    shot_suggestion="Test",
                    focal_elements=["element"],
                    quote_anchor="Quote"
                )
            ]
        )
    assert "end_char_offset (200) cannot be less than start_char_offset (5000)" in str(exc.value)


def test_rejection_empty_visual_beats():
    """EC-0.1: Visual beat requires at least 1 beat."""
    with pytest.raises(ValidationError) as exc:
        SceneObservation(
            scene_id="ch001_sc01",
            scene_order_in_chapter=1,
            start_char_offset=0,
            end_char_offset=100,
            verbatim_excerpt_summary="Test",
            setting=SettingObservation(location_id="loc_test", location_name="Test Loc"),
            characters_present=[],
            items_interacted=[],
            key_visual_beats=[]  # Empty!
        )
    assert "List should have at least 1 item" in str(exc.value)


def test_high_density_storyboard_protocol():
    """Verify HighDensityChapterStoryboard Layer E contract validation."""
    from app.models.canonical_protocol import (
        HighDensityChapterStoryboard,
        MacroScene,
        SubSceneFrame,
        ShotType,
        CameraLens,
        CharacterFrameState,
    )

    storyboard = HighDensityChapterStoryboard(
        schema_version="2.0.0",
        book_id="book-moby-dick",
        chapter_index=36,
        chapter_title="The Quarter-Deck",
        total_words=2140,
        total_frames=92,
        scenes=[
            MacroScene(
                scene_id="sc01",
                scene_order=1,
                scene_heading="Ahab Paces the Deck",
                location_handle="@PequodQuarterDeck",
                time_of_day="late stormy afternoon",
                summary="Ahab emerges onto the quarter-deck and commands the crew to assemble.",
                sub_scenes=[
                    SubSceneFrame(
                        frame_index=1,
                        scene_id="sc01",
                        sentence_span="Captain Ahab stood upon his quarter-deck, his ivory leg firmly anchored in the deck auger hole.",
                        char_start=0,
                        char_end=96,
                        shot_type=ShotType.LOW_ANGLE_HEROIC,
                        lens=CameraLens.MM_28,
                        lighting_and_atmosphere="bruised indigo storm sky with cold slate-blue ocean spray",
                        active_characters=[
                            CharacterFrameState(
                                handle="@CaptainAhab",
                                pose_and_blocking="standing rigidly with left ivory whalebone leg in auger hole",
                                facial_expression="livid grim fury, piercing stare toward horizon",
                                gaze_direction="horizon line",
                                wardrobe_state="heavy black woolen sea-coat whipping in gale",
                                held_props=[]
                            )
                        ],
                        spatial_environment_focus="weather-beaten timber deck by the mainmast",
                        compiled_image_prompt="Low angle wide shot of @CaptainAhab on @PequodQuarterDeck..."
                    )
                ]
            )
        ]
    )

    dumped = storyboard.model_dump_json()
    assert "The Quarter-Deck" in dumped
    assert storyboard.total_frames == 92
    assert storyboard.scenes[0].sub_scenes[0].shot_type == ShotType.LOW_ANGLE_HEROIC

