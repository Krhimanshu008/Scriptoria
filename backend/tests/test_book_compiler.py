"""
Test Suite for Stage-2 Book Compiler Engine (Checkpoint 3).
Validates:
- Subtask 3.1: Alias & Entity Resolution (EC-3.2: Late Alias Remap)
- Subtask 3.2: Dual Timeline Builder (narrative_seq vs story_time_tick)
- Subtask 3.3: Hierarchical Location Tree (EC-3.3: Spatial Cycle Detection)
- Subtask 3.4: Carry-Forward State Machine (EC-3.1: Flashback Isolation, EC-3.4: Time-Skip Staleness)
- Subtask 3.5: Composite Importance Scorer & Visual Tiering (Tier 1 Core, Tier 2 Supporting, Tier 3 Extras)
"""

import pytest
from backend.app.models.canonical_protocol import (
    ChapterObservation,
    SceneObservation,
    SettingObservation,
    CharacterMention,
    ItemMention,
    VisualBeat,
    EntityObservation,
    EntityType,
    EntityVisualTier,
    TimeClue,
    TimeClueType,
    LocationClue,
)
from backend.app.services.phase3_compiler.book_compiler import Stage2BookCompiler


def make_scene(
    scene_id: str,
    location_id: str = "loc_church",
    location_name: str = "Abandoned Church",
    time_type: TimeClueType = TimeClueType.PRESENT,
    delta_hint: str = None,
    characters: list = None,
    items: list = None,
) -> SceneObservation:
    return SceneObservation(
        scene_id=scene_id,
        scene_order_in_chapter=1,
        start_char_offset=0,
        end_char_offset=100,
        verbatim_excerpt_summary="Test scene summary",
        setting=SettingObservation(
            location_id=location_id,
            location_name=location_name,
            time_of_day="dusk",
            weather_atmosphere="clear",
            lighting="starlight",
            color_palette=["#000000"],
        ),
        characters_present=characters or [],
        items_interacted=items or [],
        key_visual_beats=[
            VisualBeat(
                beat_order=1,
                shot_suggestion="Wide shot",
                focal_elements=["character"],
                quote_anchor="Test quote anchor",
            )
        ],
        time_clue=TimeClue(raw_text="Time text", time_type=time_type, delta_hint=delta_hint),
    )


# ===========================================================================
# EC-3.1: Flashback Isolation
# ===========================================================================

def test_ec31_flashback_isolation():
    """
    EC-3.1: A flashback chapter must not erase a character's current scar or outfit in present scenes.
    Scene 1 (Present): Santiago wears "golden armor" and has "scar over left eye".
    Scene 2 (Flashback): Santiago wears "simple linen tunic" and has no scar.
    Scene 3 (Present): Santiago should still have "golden armor" and "scar over left eye" in present continuity!
    """
    compiler = Stage2BookCompiler(book_id="book_flashback_test")

    # Chapter 1 (Present)
    ch1 = ChapterObservation(
        book_id="book_flashback_test",
        chapter_index=1,
        chapter_title="Present Scene",
        raw_text_r2_key="parsed/ch_001.md",
        scenes=[
            make_scene(
                scene_id="ch001_sc01",
                characters=[
                    CharacterMention(
                        entity_id="char_santiago",
                        name_in_scene="Santiago",
                        action="standing on rampart",
                        emotional_state="resolute",
                        visual_changes="scar over left eye",
                        clothing_mention="golden armor",
                    )
                ],
            )
        ],
        discovered_entities=[
            EntityObservation(
                entity_id="char_santiago",
                canonical_name="Santiago",
                aliases=["The Hero"],
                entity_type=EntityType.CHARACTER,
                static_traits="Veteran traveler",
            )
        ],
    )

    # Chapter 2 (Flashback)
    ch2 = ChapterObservation(
        book_id="book_flashback_test",
        chapter_index=2,
        chapter_title="Years Ago",
        raw_text_r2_key="parsed/ch_002.md",
        scenes=[
            make_scene(
                scene_id="ch002_sc01",
                time_type=TimeClueType.FLASHBACK,
                delta_hint="-10 years",
                characters=[
                    CharacterMention(
                        entity_id="char_santiago",
                        name_in_scene="Young Santiago",
                        action="playing in field",
                        emotional_state="carefree",
                        visual_changes=None,
                        clothing_mention="simple linen tunic",
                    )
                ],
            )
        ],
        discovered_entities=[],
    )

    # Chapter 3 (Present) - Clothing not explicitly mentioned, should carry forward from Ch 1, NOT Ch 2!
    ch3 = ChapterObservation(
        book_id="book_flashback_test",
        chapter_index=3,
        chapter_title="Back to Present",
        raw_text_r2_key="parsed/ch_003.md",
        scenes=[
            make_scene(
                scene_id="ch003_sc01",
                time_type=TimeClueType.PRESENT,
                characters=[
                    CharacterMention(
                        entity_id="char_santiago",
                        name_in_scene="Santiago",
                        action="marching forward",
                        emotional_state="focused",
                        visual_changes=None,
                        clothing_mention=None,  # Carry forward!
                    )
                ],
            )
        ],
        discovered_entities=[],
    )

    graph = compiler.compile([ch1, ch2, ch3])

    santiago = graph.entities["char_santiago"]
    assert len(santiago.state_history) == 3

    # State in Ch 1 (Present)
    assert santiago.state_history[0].outfit == "golden armor"
    assert "scar over left eye" in santiago.state_history[0].injuries

    # State in Ch 2 (Flashback)
    assert santiago.state_history[1].outfit == "simple linen tunic"
    assert len(santiago.state_history[1].injuries) == 0

    # State in Ch 3 (Present) - MUST isolate flashback!
    assert santiago.state_history[2].outfit == "golden armor", (
        f"Flashback corrupted present outfit! Got: {santiago.state_history[2].outfit}"
    )
    assert "scar over left eye" in santiago.state_history[2].injuries, (
        f"Flashback erased present scar! Got: {santiago.state_history[2].injuries}"
    )


# ===========================================================================
# EC-3.2: Late Alias Remap
# ===========================================================================

def test_ec32_late_alias_remap():
    """
    EC-3.2: In Chapter 1, character is introduced as "The Stranger".
    In Chapter 3, he is revealed to be "Lord Vance".
    Both references should resolve to canonical entity_id "char_lord_vance".
    """
    compiler = Stage2BookCompiler(book_id="book_alias_test")

    ch1 = ChapterObservation(
        book_id="book_alias_test",
        chapter_index=1,
        chapter_title="Arrival",
        raw_text_r2_key="parsed/ch_001.md",
        scenes=[
            make_scene(
                scene_id="ch001_sc01",
                characters=[
                    CharacterMention(
                        entity_id="char_stranger",
                        name_in_scene="The Stranger",
                        action="entering tavern",
                        emotional_state="mysterious",
                        clothing_mention="tattered dark cloak",
                    )
                ],
            )
        ],
        discovered_entities=[
            EntityObservation(
                entity_id="char_lord_vance",
                canonical_name="Lord Vance",
                aliases=["The Stranger", "Vance"],
                entity_type=EntityType.CHARACTER,
                static_traits="Tall man with silver hair and regal bearing",
            )
        ],
    )

    graph = compiler.compile([ch1])

    assert "char_lord_vance" in graph.entities
    vance = graph.entities["char_lord_vance"]
    assert "The Stranger" in vance.aliases
    # Check that "The Stranger" was resolved to Lord Vance in the timeline
    assert graph.timeline[0].active_characters == ["char_lord_vance"]


# ===========================================================================
# EC-3.3: Hierarchical Location Tree with Cycle Detection
# ===========================================================================

def test_ec33_cycle_detection():
    """
    EC-3.3: Spatial cycle (Sacristy -> Church -> Village -> Sacristy)
    must be cleanly detected and pruned without causing an infinite loop.
    """
    compiler = Stage2BookCompiler(book_id="book_cycle_test")

    # Manually configure a cyclic observation
    ch1 = ChapterObservation(
        book_id="book_cycle_test",
        chapter_index=1,
        chapter_title="Cycle Chapter",
        raw_text_r2_key="parsed/ch_001.md",
        scenes=[
            make_scene(scene_id="ch001_sc01", location_id="loc_sacristy", location_name="Sacristy"),
            make_scene(scene_id="ch001_sc02", location_id="loc_church", location_name="Church"),
            make_scene(scene_id="ch001_sc03", location_id="loc_village", location_name="Village"),
        ],
        location_clues=[
            LocationClue(raw_text="Sacristy in Church", parent_hint="Church"),
            LocationClue(raw_text="Church in Village", parent_hint="Village"),
            LocationClue(raw_text="Village in Sacristy (Cycle!)", parent_hint="Sacristy"),
        ],
    )

    # Must compile without infinite recursion or stack overflow
    graph = compiler.compile([ch1])

    assert "loc_sacristy" in graph.locations
    assert "loc_church" in graph.locations
    # Verify materialized paths were generated
    for loc in graph.locations.values():
        assert loc.materialized_path.startswith("/")
        assert len(loc.materialized_path) > 1


# ===========================================================================
# EC-3.4: Time-Skip Stale Outfits
# ===========================================================================

def test_ec34_time_skip_stale_outfits():
    """
    EC-3.4: A "six months later" time-skip scene must mark previous ephemeral
    outfits as stale rather than propagating them blindly.
    """
    compiler = Stage2BookCompiler(book_id="book_timeskip_test")

    ch1 = ChapterObservation(
        book_id="book_timeskip_test",
        chapter_index=1,
        chapter_title="Summer",
        raw_text_r2_key="parsed/ch_001.md",
        scenes=[
            make_scene(
                scene_id="ch001_sc01",
                time_type=TimeClueType.PRESENT,
                characters=[
                    CharacterMention(
                        entity_id="char_hero",
                        name_in_scene="Hero",
                        action="sweating in heat",
                        emotional_state="hot",
                        clothing_mention="light summer tunic",
                    )
                ],
            )
        ],
        discovered_entities=[
            EntityObservation(
                entity_id="char_hero",
                canonical_name="Hero",
                entity_type=EntityType.CHARACTER,
                static_traits="Brave warrior",
            )
        ],
    )

    ch2 = ChapterObservation(
        book_id="book_timeskip_test",
        chapter_index=2,
        chapter_title="Winter Months Later",
        raw_text_r2_key="parsed/ch_002.md",
        scenes=[
            make_scene(
                scene_id="ch002_sc01",
                time_type=TimeClueType.TIME_SKIP,
                delta_hint="+6 months later in winter blizzard",
                characters=[
                    CharacterMention(
                        entity_id="char_hero",
                        name_in_scene="Hero",
                        action="shivering in snow",
                        emotional_state="freezing",
                        clothing_mention=None,  # Not mentioned! Should NOT wear light summer tunic!
                    )
                ],
            )
        ],
        discovered_entities=[],
    )

    graph = compiler.compile([ch1, ch2])
    hero = graph.entities["char_hero"]

    # In Ch 1: outfit is summer tunic, not stale
    assert hero.state_history[0].outfit == "light summer tunic"
    assert hero.state_history[0].is_stale is False

    # In Ch 2 (after 6 months): outfit is marked stale!
    assert hero.state_history[1].is_stale is True
    assert hero.state_history[1].outfit is None


# ===========================================================================
# Subtask 3.5: Composite Importance Scoring & Visual Tiering
# ===========================================================================

def test_subtask_35_composite_importance_scoring():
    """
    Subtask 3.5: Verify composite importance scoring and visual tiering:
    - Main character (present in all scenes with actions and rich traits) -> Tier 1 Core
    - Minor extra (appears once with 1 word trait, passive) -> Tier 3 Extras
    """
    compiler = Stage2BookCompiler(book_id="book_scoring_test")

    ch1 = ChapterObservation(
        book_id="book_scoring_test",
        chapter_index=1,
        chapter_title="Tavern and Road",
        raw_text_r2_key="parsed/ch_001.md",
        scenes=[
            make_scene(
                scene_id="ch001_sc01",
                characters=[
                    CharacterMention(
                        entity_id="char_protagonist",
                        name_in_scene="Protagonist",
                        action="leading the charge",
                        emotional_state="confident",
                        clothing_mention="royal cape",
                    ),
                    CharacterMention(
                        entity_id="char_bystander",
                        name_in_scene="Bystander",
                        action="watching quietly from shadow",
                        emotional_state="passive",
                    ),
                ],
                items=[
                    ItemMention(
                        item_id="item_sword",
                        item_name="Magic Sword",
                        held_by_entity_id="char_protagonist",
                    )
                ],
            ),
            make_scene(
                scene_id="ch001_sc02",
                characters=[
                    CharacterMention(
                        entity_id="char_protagonist",
                        name_in_scene="Protagonist",
                        action="slaying dragon",
                        emotional_state="fierce",
                        clothing_mention="royal cape",
                    ),
                ],
                items=[
                    ItemMention(
                        item_id="item_sword",
                        item_name="Magic Sword",
                        held_by_entity_id="char_protagonist",
                    )
                ],
            ),
        ],
        discovered_entities=[
            EntityObservation(
                entity_id="char_protagonist",
                canonical_name="Protagonist",
                aliases=["The Chosen One", "Leader"],
                entity_type=EntityType.CHARACTER,
                static_traits="Tall warrior with glowing runes on armor, sapphire eyes, and a distinguished jawline",
            ),
            EntityObservation(
                entity_id="char_bystander",
                canonical_name="Bystander",
                aliases=[],
                entity_type=EntityType.CHARACTER,
                static_traits="Old man",
            ),
        ],
    )

    graph = compiler.compile([ch1])

    protag = graph.entities["char_protagonist"]
    bystander = graph.entities["char_bystander"]

    assert protag.importance_score > bystander.importance_score
    assert protag.visual_tier == EntityVisualTier.TIER_1_CORE
    assert bystander.visual_tier in (EntityVisualTier.TIER_2_SUPPORTING, EntityVisualTier.TIER_3_EXTRAS)
