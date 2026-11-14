"""
Test Suite for Scriptoria Checkpoint 4: Hybrid RAG, Graph RAG Packaging & Retrieval.
Validates:
- Subtask 4.1 & 4.2: Beat Chunking, Embedding Generation, SQLite Packaging
- Subtask 4.4: 4 Typed Retrieval Tools (query_timeline_state, hybrid_search_prose, traverse_knowledge_graph, fetch_r2_verbatim)
- EC-4.1: Hybrid Precision (Proper nouns hit BM25 rank #1; mood/sensory queries hit Vector rank #1)
- EC-4.2: Spoiler Shield (Queries at narrative_seq <= N return ZERO future elements)
- EC-4.3: 2-Hop Temporal Traversal (Multi-hop graph expansion & item custody transitions)
- EC-4.4: Database Footprint (<8 MB per novel)
"""

import os
import json
import pytest
from pathlib import Path
from unittest.mock import MagicMock

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
    CompiledBookGraph,
    CompiledEntity,
    CompiledLocation,
    CompiledTimelineTick,
    CompiledGraphEdge,
    EntityStateSnapshot,
)
from backend.app.services.phase4_rag.embeddings import SemanticEmbeddingService
from backend.app.services.phase4_rag.indexer import HybridRAGIndexer
from backend.app.services.phase4_rag.retriever import ScriptoriaRAGRetriever


@pytest.fixture
def sample_test_db(tmp_path: Path):
    """Builds a temporary SQLite test database with 3 chapters across a timeline."""
    db_file = str(tmp_path / "test_book.db")

    # Construct observations for 3 scenes across 3 chapters
    obs1 = ChapterObservation(
        book_id="book_rag_test",
        chapter_index=1,
        chapter_title="Chapter 1: The Abandoned Church",
        raw_text_r2_key="parsed/ch_001.md",
        scenes=[
            SceneObservation(
                scene_id="ch001_sc01",
                scene_order_in_chapter=1,
                start_char_offset=0,
                end_char_offset=200,
                verbatim_excerpt_summary="Santiago rests in the abandoned church sacristy under the starry night.",
                setting=SettingObservation(
                    location_id="loc_church",
                    location_name="Abandoned Church Sacristy",
                    time_of_day="dusk",
                    weather_atmosphere="clear starry quiet night",
                    lighting="faint amber starlight",
                    color_palette=["#1A1A2E"],
                ),
                characters_present=[
                    CharacterMention(
                        entity_id="char_santiago",
                        name_in_scene="Santiago",
                        action="sleeping under sycamore",
                        emotional_state="peaceful",
                        clothing_mention="shepherd cloak",
                    )
                ],
                items_interacted=[
                    ItemMention(
                        item_id="item_shovel",
                        item_name="iron shovel",
                        held_by_entity_id="char_santiago",
                    )
                ],
                key_visual_beats=[
                    VisualBeat(
                        beat_order=1,
                        shot_suggestion="Wide cinematic shot of ruined church under cold starry sky",
                        focal_elements=["ruined church", "sycamore tree", "stars"],
                        quote_anchor="The boy reached the small, abandoned church just as night was falling.",
                    ),
                    VisualBeat(
                        beat_order=2,
                        shot_suggestion="Close up of Santiago holding his iron shovel",
                        focal_elements=["shovel", "hands"],
                        quote_anchor="He held his iron shovel tightly against the winter wind.",
                    ),
                ],
                time_clue=TimeClue(raw_text="at night", time_type=TimeClueType.PRESENT),
            )
        ],
        discovered_entities=[
            EntityObservation(
                entity_id="char_santiago",
                canonical_name="Santiago",
                aliases=["The Shepherd Boy"],
                entity_type=EntityType.CHARACTER,
                static_traits="Young Andalusian shepherd with keen dark eyes",
            )
        ],
    )

    obs2 = ChapterObservation(
        book_id="book_rag_test",
        chapter_index=2,
        chapter_title="Chapter 2: The Crystal Merchant",
        raw_text_r2_key="parsed/ch_002.md",
        scenes=[
            SceneObservation(
                scene_id="ch002_sc01",
                scene_order_in_chapter=1,
                start_char_offset=0,
                end_char_offset=200,
                verbatim_excerpt_summary="Santiago arrives in Tangier and meets the Merchant at the hilltop shop.",
                setting=SettingObservation(
                    location_id="loc_tangier",
                    location_name="Tangier Crystal Shop",
                    time_of_day="morning",
                    weather_atmosphere="sunny bustling Mediterranean breeze",
                    lighting="dazzling bright sunlight reflecting off glassware",
                    color_palette=["#E2B714"],
                ),
                characters_present=[
                    CharacterMention(
                        entity_id="char_santiago",
                        name_in_scene="Santiago",
                        action="polishing crystal glasses",
                        emotional_state="determined",
                        clothing_mention="Arab linen garments",
                    ),
                    CharacterMention(
                        entity_id="char_merchant",
                        name_in_scene="Crystal Merchant",
                        action="smoking hookah",
                        emotional_state="melancholy",
                        clothing_mention="embroidered silk robe",
                    ),
                ],
                items_interacted=[
                    ItemMention(
                        item_id="item_crystal_vase",
                        item_name="crystal vase",
                        held_by_entity_id="char_santiago",
                    )
                ],
                key_visual_beats=[
                    VisualBeat(
                        beat_order=1,
                        shot_suggestion="Sunlight refracting through hundreds of sparkling crystal goblets",
                        focal_elements=["crystal glasses", "sunlight", "dust motes"],
                        quote_anchor="The crystal shop stood at the top of a steep hill, glistening in the morning sun.",
                    )
                ],
                time_clue=TimeClue(raw_text="next morning", time_type=TimeClueType.PRESENT),
            )
        ],
        discovered_entities=[
            EntityObservation(
                entity_id="char_merchant",
                canonical_name="Crystal Merchant",
                aliases=["The Merchant"],
                entity_type=EntityType.CHARACTER,
                static_traits="Elderly merchant with weary eyes and graying beard",
            )
        ],
    )

    # Chapter 3 contains a FUTURE spoiler (Treasure at Pyramids)
    obs3 = ChapterObservation(
        book_id="book_rag_test",
        chapter_index=3,
        chapter_title="Chapter 3: The Pyramids of Egypt",
        raw_text_r2_key="parsed/ch_003.md",
        scenes=[
            SceneObservation(
                scene_id="ch003_sc01",
                scene_order_in_chapter=1,
                start_char_offset=0,
                end_char_offset=200,
                verbatim_excerpt_summary="Santiago reaches the Great Pyramids and weeps for joy.",
                setting=SettingObservation(
                    location_id="loc_pyramids",
                    location_name="Great Pyramids of Giza",
                    time_of_day="sunset",
                    weather_atmosphere="desert wind blowing golden sands",
                    lighting="crimson dusk glow",
                    color_palette=["#FF4500"],
                ),
                characters_present=[
                    CharacterMention(
                        entity_id="char_santiago",
                        name_in_scene="Santiago",
                        action="falling to knees in tears",
                        emotional_state="euphoric",
                        clothing_mention="tattered desert robes",
                    )
                ],
                items_interacted=[
                    ItemMention(
                        item_id="item_gold_chest",
                        item_name="golden chest of gems",
                        held_by_entity_id="char_santiago",
                    )
                ],
                key_visual_beats=[
                    VisualBeat(
                        beat_order=1,
                        shot_suggestion="Towering silhouette of the Great Pyramids against deep crimson sunset",
                        focal_elements=["pyramids", "crimson sky", "kneeling boy"],
                        quote_anchor="Before him stood the majesty of the Pyramids, bathed in the full moon and sunset glow.",
                    )
                ],
                time_clue=TimeClue(raw_text="months later", time_type=TimeClueType.PRESENT),
            )
        ],
        discovered_entities=[],
    )

    # Build compiled graph
    graph = CompiledBookGraph(
        schema_version="1.0.0",
        book_id="book_rag_test",
        total_chapters=3,
        total_scenes=3,
        total_beats=4,
        timeline=[
            CompiledTimelineTick(
                narrative_seq=1,
                story_time_tick=1000,
                chapter_index=1,
                scene_id="ch001_sc01",
                time_type=TimeClueType.PRESENT,
                location_id="loc_church",
                active_characters=["char_santiago"],
                active_items=["item_shovel"],
            ),
            CompiledTimelineTick(
                narrative_seq=2,
                story_time_tick=2000,
                chapter_index=2,
                scene_id="ch002_sc01",
                time_type=TimeClueType.PRESENT,
                location_id="loc_tangier",
                active_characters=["char_santiago", "char_merchant"],
                active_items=["item_crystal_vase"],
            ),
            CompiledTimelineTick(
                narrative_seq=3,
                story_time_tick=3000,
                chapter_index=3,
                scene_id="ch003_sc01",
                time_type=TimeClueType.PRESENT,
                location_id="loc_pyramids",
                active_characters=["char_santiago"],
                active_items=["item_gold_chest"],
            ),
        ],
        entities={
            "char_santiago": CompiledEntity(
                entity_id="char_santiago",
                canonical_name="Santiago",
                aliases=["The Shepherd Boy"],
                entity_type=EntityType.CHARACTER,
                static_traits="Young Andalusian shepherd with keen dark eyes",
                visual_tier=EntityVisualTier.TIER_1_CORE,
                importance_score=0.89,
                state_history=[
                    EntityStateSnapshot(
                        story_tick=1000,
                        narrative_seq=1,
                        scene_id="ch001_sc01",
                        outfit="shepherd cloak",
                        physical_condition="peaceful",
                        items_held=["item_shovel"],
                    ),
                    EntityStateSnapshot(
                        story_tick=2000,
                        narrative_seq=2,
                        scene_id="ch002_sc01",
                        outfit="Arab linen garments",
                        physical_condition="determined",
                        items_held=["item_crystal_vase"],
                    ),
                    EntityStateSnapshot(
                        story_tick=3000,
                        narrative_seq=3,
                        scene_id="ch003_sc01",
                        outfit="tattered desert robes",
                        physical_condition="euphoric",
                        items_held=["item_gold_chest"],
                    ),
                ],
            ),
            "char_merchant": CompiledEntity(
                entity_id="char_merchant",
                canonical_name="Crystal Merchant",
                aliases=["The Merchant"],
                entity_type=EntityType.CHARACTER,
                static_traits="Elderly merchant with graying beard",
                visual_tier=EntityVisualTier.TIER_2_SUPPORTING,
                importance_score=0.42,
                state_history=[
                    EntityStateSnapshot(
                        story_tick=2000,
                        narrative_seq=2,
                        scene_id="ch002_sc01",
                        outfit="embroidered silk robe",
                        physical_condition="melancholy",
                    )
                ],
            ),
        },
        locations={
            "loc_church": CompiledLocation(
                location_id="loc_church",
                canonical_name="Abandoned Church",
                materialized_path="/andalusia/church",
            ),
            "loc_tangier": CompiledLocation(
                location_id="loc_tangier",
                canonical_name="Tangier Crystal Shop",
                materialized_path="/morocco/tangier/shop",
            ),
            "loc_pyramids": CompiledLocation(
                location_id="loc_pyramids",
                canonical_name="Great Pyramids",
                materialized_path="/egypt/giza/pyramids",
            ),
        },
        edges=[
            CompiledGraphEdge(
                source_id="char_santiago",
                target_id="char_merchant",
                relationship_type="EMPLOYED_BY",
                narrative_seq=2,
            ),
            CompiledGraphEdge(
                source_id="char_santiago",
                target_id="loc_church",
                relationship_type="RESTED_AT",
                narrative_seq=1,
            ),
            CompiledGraphEdge(
                source_id="char_santiago",
                target_id="loc_pyramids",
                relationship_type="REACHED",
                narrative_seq=3,
            ),
        ],
    )

    indexer = HybridRAGIndexer()
    indexer.build_database(graph, [obs1, obs2, obs3], db_file)
    return db_file


# ===========================================================================
# EC-4.1: Hybrid Precision (Proper nouns hit BM25, sensory hits Vector)
# ===========================================================================

def test_ec41_hybrid_precision(sample_test_db: str):
    """
    EC-4.1: Tests that:
    1. Exact proper noun queries ('Crystal Merchant', 'shovel') score high on BM25 rank.
    2. Sensory/visual atmosphere queries ('glistening sunlight sparkling glassware') rank high in semantic vector.
    """
    retriever = ScriptoriaRAGRetriever(sample_test_db)

    # 1. Exact proper noun query
    results_proper = retriever.hybrid_search_prose(
        query="crystal shop hill glistening",
        max_narrative_seq=3,
        top_k=3,
    )
    assert len(results_proper) > 0
    top_hit = results_proper[0]
    assert "ch002_sc01" == top_hit["scene_id"]
    assert top_hit["bm25_rank"] is not None, "Expected BM25 to rank the exact match"

    # 2. Sensory/mood query
    results_mood = retriever.hybrid_search_prose(
        query="cold starry quiet night ruined church",
        max_narrative_seq=3,
        top_k=3,
    )
    assert len(results_mood) > 0
    assert "ch001_sc01" == results_mood[0]["scene_id"]


# ===========================================================================
# EC-4.2: Spoiler Shield (narrative_seq <= N barrier)
# ===========================================================================

def test_ec42_spoiler_shield_protection(sample_test_db: str):
    """
    EC-4.2: When reader is at Chapter 1 (narrative_seq=1):
    - query_timeline_state must NOT reveal Chapter 2 (Tangier) or Chapter 3 (Pyramids).
    - hybrid_search_prose with query 'Pyramids gold chest' must return ZERO future chunks.
    """
    retriever = ScriptoriaRAGRetriever(sample_test_db)

    # State query at Chapter 1
    state = retriever.query_timeline_state(
        character_ids=["char_santiago"],
        at_tick=1000,
        max_narrative_seq=1,  # SPOILER SHIELD ACTIVE AT CH 1
    )

    santiago_ch1 = state["char_santiago"]
    assert santiago_ch1 is not None
    assert santiago_ch1["outfit"] == "shepherd cloak"
    assert "item_shovel" in santiago_ch1["items_held"]
    # MUST NOT leak future outfit or gold chest from Chapter 2 or 3!
    assert santiago_ch1["outfit"] != "Arab linen garments"
    assert santiago_ch1["outfit"] != "tattered desert robes"
    assert "item_gold_chest" not in santiago_ch1["items_held"]

    # Hybrid search with query explicitly targeting future chapter
    spoiler_search = retriever.hybrid_search_prose(
        query="Pyramids sunset crimson golden chest",
        max_narrative_seq=1,  # BARRIER: Reader has only read Ch 1
        top_k=5,
    )

    # Every returned chunk MUST strictly satisfy narrative_seq <= 1!
    for hit in spoiler_search:
        assert hit["narrative_seq"] <= 1, f"SPOILER LEAKED! Got chunk with narrative_seq={hit['narrative_seq']}"
        assert "pyramids" not in hit["content"].lower()


# ===========================================================================
# EC-4.3: 2-Hop Temporal Traversal
# ===========================================================================

def test_ec43_2hop_temporal_traversal(sample_test_db: str):
    """
    EC-4.3: Tests multi-hop graph expansion from Santiago:
    - At narrative_seq=2, graph should connect Santiago -> Crystal Merchant and Church,
      but MUST NOT leak future connection to Pyramids (narrative_seq=3).
    """
    retriever = ScriptoriaRAGRetriever(sample_test_db)

    traversal = retriever.traverse_knowledge_graph(
        entity_id="char_santiago",
        max_hops=2,
        max_narrative_seq=2,  # Barrier before Pyramids
    )

    visited_ids = set(traversal["visited_entities"].keys())
    assert "char_santiago" in visited_ids
    assert "char_merchant" in visited_ids
    assert "loc_church" in visited_ids

    # Future entity in Chapter 3 must be shielded!
    assert "loc_pyramids" not in visited_ids, "Spoiler: Future location leaked in graph traversal!"


# ===========================================================================
# EC-4.4: Database Footprint (<8 MB per novel)
# ===========================================================================

def test_ec44_database_footprint(sample_test_db: str):
    """EC-4.4: Verifies compiled SQLite database stays compact (<8 MB per novel)."""
    file_size_bytes = os.path.getsize(sample_test_db)
    file_size_mb = file_size_bytes / (1024 * 1024)
    # The test database should be only a few dozen KB, well below 8 MB
    assert file_size_mb < 8.0, f"Database exceeded 8 MB footprint limit! Got {file_size_mb:.2f} MB"
    assert file_size_bytes > 0


# ===========================================================================
# Tool 4: fetch_r2_verbatim
# ===========================================================================

def test_fetch_r2_verbatim():
    """Verifies fetch_r2_verbatim retrieves ground-truth text with character slicing."""
    mock_r2 = MagicMock()
    mock_r2.get_text.return_value = "The boy reached the small, abandoned church just as night was falling."

    retriever = ScriptoriaRAGRetriever(db_path=":memory:", r2=mock_r2)

    # 1. Full text
    full = retriever.fetch_r2_verbatim("parsed/test/ch_001.md")
    assert full == "The boy reached the small, abandoned church just as night was falling."

    # 2. Sliced window
    slice_text = retriever.fetch_r2_verbatim("parsed/test/ch_001.md", start_char=0, end_char=15)
    assert slice_text == "The boy reached"
