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
