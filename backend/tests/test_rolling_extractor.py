"""
Edge-Case Test Suite for Scriptoria Phase-2 Rolling Context Extractor.
Validates:
- EC-2.1: Schema Strictness & Self-Healing Retry
- EC-2.2: Quote Anchor Verbatim Fidelity (>=95% match rate)
- EC-2.3: Sudden-Death Resumption (Skip finished chapters, restore rolling glossary)
- EC-2.4: Glossary Bloat Prevention (Compact tags, alias capping, prompt size bounds)
"""

import json
import pytest
from unittest.mock import MagicMock, patch

from backend.app.models.canonical_protocol import (
    ChapterObservation,
    SceneObservation,
    SettingObservation,
    CharacterMention,
    ItemMention,
    VisualBeat,
    EntityObservation,
    EntityType,
    RollingEntityGlossary,
    RollingEntityGlossaryItem,
    TimeClue,
    TimeClueType,
)
from backend.app.services.phase2_ingestion.rolling_extractor import RollingContextExtractor


def make_valid_chapter_observation_dict(chapter_index: int = 1) -> dict:
    return {
        "schema_version": "1.0.0",
        "book_id": "test_book_123",
        "chapter_index": chapter_index,
        "chapter_title": f"Chapter {chapter_index}",
        "raw_text_r2_key": f"parsed/test_book_123/ch_{chapter_index:03d}.md",
        "scenes": [
            {
                "scene_id": f"ch{chapter_index:03d}_sc01",
                "scene_order_in_chapter": 1,
                "start_char_offset": 0,
                "end_char_offset": 150,
                "verbatim_excerpt_summary": "Santiago arrives at the abandoned church as dusk falls over Andalusia.",
                "setting": {
                    "location_id": "loc_church",
                    "location_name": "Abandoned Church Sacristy",
                    "time_of_day": "dusk",
                    "weather_atmosphere": "quiet starry sky",
                    "lighting": "dim starlight",
                    "color_palette": ["#1A1A2E", "#E2B714"],
                },
                "characters_present": [
                    {
                        "entity_id": "char_santiago",
                        "name_in_scene": "The boy",
                        "action": "resting under the sycamore tree",
                        "emotional_state": "peaceful",
                        "visual_changes": None,
                        "clothing_mention": "worn shepherd cloak",
                    }
                ],
                "items_interacted": [
                    {
                        "item_id": "item_crook",
                        "item_name": "shepherd's crook",
                        "held_by_entity_id": "char_santiago",
                        "condition": "intact",
                    }
                ],
                "key_visual_beats": [
                    {
                        "beat_order": 1,
                        "shot_suggestion": "Wide shot of solitary shepherd boy entering ruined church sacristy.",
                        "focal_elements": ["ruined church", "sycamore tree", "shepherd"],
                        "quote_anchor": "The boy reached the small, abandoned church just as night was falling.",
                    }
                ],
                "time_clue": {
                    "raw_text": "just as night was falling",
                    "time_type": "PRESENT",
                    "delta_hint": "dusk",
                },
            }
        ],
        "discovered_entities": [
            {
                "entity_id": "char_santiago",
                "canonical_name": "Santiago",
                "aliases": ["The boy", "The shepherd"],
                "entity_type": "CHARACTER",
                "static_traits": "Young Andalusian shepherd with keen dark eyes",
                "chapter_state_delta": {"outfit": "worn shepherd cloak"},
            }
        ],
        "time_clues": [],
        "location_clues": [],
    }


# ===========================================================================
# EC-2.1: Schema Strictness & Self-Healing Retry
# ===========================================================================

def test_ec21_schema_strictness_and_self_healing_retry():
    """
    EC-2.1: Test that extractor detects malformed JSON / schema violations,
    retries, and successfully recovers when valid JSON is returned on retry.
    """
    mock_r2 = MagicMock()
    mock_r2.get_text.return_value = (
        "The boy reached the small, abandoned church just as night was falling. "
        "A sycamore grew in the sacristy."
    )

    valid_dict = make_valid_chapter_observation_dict(1)
    # Attempt 1: Broken JSON syntax + missing quote anchor
    broken_output = "{ schema_version: 1.0.0, scenes: [ INVALID SYNTAX"
    # Attempt 2: Fully valid JSON
    valid_output = json.dumps(valid_dict)

    call_count = 0

    def mock_llm_caller(prompt: str, max_tokens: int) -> str:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return broken_output
        return valid_output

    extractor = RollingContextExtractor(r2=mock_r2, llm_caller=mock_llm_caller)
    glossary = RollingEntityGlossary(book_id="test_book_123")
    meta = {
        "chapter_index": 1,
        "title": "Chapter 1",
        "r2_key": "parsed/test_book_123/ch_001.md",
    }

    obs = extractor.extract_single_chapter("test_book_123", meta, glossary, max_retries=3)

    assert obs.chapter_index == 1
    assert obs.book_id == "test_book_123"
    assert len(obs.scenes) == 1
    assert call_count == 2, "Expected self-healing retry on attempt 2"
    mock_r2.put_json.assert_called_once()


def test_ec21_schema_rejection_on_unrecoverable_error():
    """EC-2.1: Test that extractor raises RuntimeError if max_retries are exceeded."""
    mock_r2 = MagicMock()
    mock_r2.get_text.return_value = "Chapter text here."

    def mock_broken_llm(prompt: str, max_tokens: int) -> str:
        return "Not even JSON"

    extractor = RollingContextExtractor(r2=mock_r2, llm_caller=mock_broken_llm)
    glossary = RollingEntityGlossary(book_id="test_book_123")
    meta = {"chapter_index": 1, "title": "Chapter 1", "r2_key": "dummy"}

    with pytest.raises(RuntimeError) as exc_info:
        extractor.extract_single_chapter("test_book_123", meta, glossary, max_retries=2)
    assert "Failed to extract Chapter 1 after 2 attempts" in str(exc_info.value)


# ===========================================================================
# EC-2.2: Quote Anchor Match (>=95% exact substring match)
# ===========================================================================

def test_ec22_quote_anchor_fidelity_matching():
    """
    EC-2.2: Test that verify_quote_anchors correctly verifies verbatim
    substring matches against chapter text and flags unmatched quotes.
    """
    chapter_text = (
        "The boy reached the small, abandoned church just as night was falling. "
        "The roof had fallen in long ago, and an enormous sycamore had grown on the spot "
        "where the sacristy had once stood. He decided to spend the night there."
    )

    extractor = RollingContextExtractor(r2=MagicMock())

    # Build observation with 2 matching quotes and 0 unmatched
    obs_dict = make_valid_chapter_observation_dict(1)
    obs_dict["scenes"][0]["key_visual_beats"] = [
        {
            "beat_order": 1,
            "shot_suggestion": "Wide shot of boy arriving at ruined church.",
            "focal_elements": ["church", "boy"],
            "quote_anchor": "The boy reached the small, abandoned church just as night was falling.",
        },
        {
            "beat_order": 2,
            "shot_suggestion": "Medium shot of sycamore growing through ruined roof.",
            "focal_elements": ["sycamore", "sacristy"],
            "quote_anchor": "an enormous sycamore had grown on the spot where the sacristy had once stood",
        },
    ]

    obs = ChapterObservation.model_validate(obs_dict)
    stats = extractor.verify_quote_anchors(chapter_text, obs)

    assert stats["total_beats"] == 2
    assert stats["matched_beats"] == 2
    assert stats["match_rate"] == 100.0
    assert len(stats["unmatched_quotes"]) == 0

    # Inject 1 hallucinated quote that doesn't exist in text
    obs_dict["scenes"][0]["key_visual_beats"].append(
        {
            "beat_order": 3,
            "shot_suggestion": "Shot of laser spaceship",
            "focal_elements": ["spaceship"],
            "quote_anchor": "A futuristic laser spaceship landed in the church yard.",
        }
    )
    obs_with_hallucination = ChapterObservation.model_validate(obs_dict)
    stats_hallucination = extractor.verify_quote_anchors(chapter_text, obs_with_hallucination)

    assert stats_hallucination["total_beats"] == 3
    assert stats_hallucination["matched_beats"] == 2
    assert stats_hallucination["match_rate"] == 66.67
    assert "A futuristic laser spaceship landed in the church yard." in stats_hallucination["unmatched_quotes"]


# ===========================================================================
# EC-2.3: Sudden-Death Resume
# ===========================================================================

def test_ec23_sudden_death_resume():
    """
    EC-2.3: Simulate a crash mid-book where Chapter 1 is already in R2.
    Verify that resume_or_run_book skips Chapter 1, restores the RollingEntityGlossary,
    and only runs extraction on Chapter 2.
    """
    mock_r2 = MagicMock()
    book_id = "book_alchemist_resume"

    # Manifest contains 2 story chapters
    mock_r2.get_json.side_effect = lambda key: {
        f"parsed/{book_id}/manifest.json": {
            "book_id": book_id,
            "chapters": [
                {"chapter_index": 1, "title": "Part 1", "r2_key": f"parsed/{book_id}/ch_001.md", "is_frontmatter": False},
                {"chapter_index": 2, "title": "Part 2", "r2_key": f"parsed/{book_id}/ch_002.md", "is_frontmatter": False},
            ],
        },
        f"extracted/{book_id}/ch_001_obs.json": make_valid_chapter_observation_dict(1),
    }.get(key)

    # R2 file_exists returns True for Chapter 1, False for Chapter 2
    mock_r2.file_exists.side_effect = lambda key: key == f"extracted/{book_id}/ch_001_obs.json"
    mock_r2.get_text.side_effect = lambda key: f"Text content for {key}"

    # LLM caller should only be invoked for Chapter 2
    extracted_chapters = []

    def mock_llm(prompt: str, max_tokens: int) -> str:
        # Determine chapter from prompt
        if "Chapter Index: 2" in prompt:
            extracted_chapters.append(2)
            return json.dumps(make_valid_chapter_observation_dict(2))
        extracted_chapters.append(1)
        return json.dumps(make_valid_chapter_observation_dict(1))

    extractor = RollingContextExtractor(r2=mock_r2, llm_caller=mock_llm)

    glossary = extractor.resume_or_run_book(book_id=book_id)

    # Chapter 1 was already in R2, so LLM should ONLY have processed Chapter 2!
    assert extracted_chapters == [2], f"Expected only Chapter 2 to be extracted, got: {extracted_chapters}"
    assert glossary.last_completed_chapter == 2
    # Santiago should be in the restored glossary from Chapter 1 + Chapter 2
    entity_ids = [e.entity_id for e in glossary.entities]
    assert "char_santiago" in entity_ids


# ===========================================================================
# EC-2.4: Glossary Bloat Prevention
# ===========================================================================

def test_ec24_glossary_bloat_prevention():
    """
    EC-2.4: Ensure rolling prompt only carries concise short_visual_tag (<=120 chars)
    and caps aliases (<=5) to prevent context explosion on long novels.
    """
    extractor = RollingContextExtractor(r2=MagicMock())
    glossary = RollingEntityGlossary(book_id="test_bloat_book")

    # Construct an observation with an excessively verbose 600-character description and 12 aliases
    obs_dict = make_valid_chapter_observation_dict(1)
    huge_description = "A very long detailed paragraph about his ancestry, past lives, spiritual beliefs, facial wrinkles, clothing woven by hand by monks in distant mountains " * 4
    many_aliases = [f"Alias_{i}" for i in range(12)]

    obs_dict["discovered_entities"][0]["static_traits"] = huge_description
    obs_dict["discovered_entities"][0]["aliases"] = many_aliases

    obs = ChapterObservation.model_validate(obs_dict)
    extractor.update_glossary(glossary, obs)

    # Check that item in glossary was trimmed
    saved_entity = glossary.entities[0]
    assert len(saved_entity.short_visual_tag) <= 120, "Visual tag exceeded 120 chars!"
    assert len(saved_entity.aliases) <= 5, "Aliases were not capped at 5!"

    # Check assembled prompt contains the trimmed version, not the 600-char block
    prompt = extractor.build_rolling_prompt(
        book_id="test_bloat_book",
        chapter_index=2,
        chapter_title="Chapter 2",
        raw_text_r2_key="parsed/test_bloat_book/ch_002.md",
        chapter_text="Santiago walked on.",
        glossary=glossary,
        trailing_excerpt="Previous words.",
    )

    assert "CURRENT KNOWN ENTITY GLOSSARY" in prompt
    assert saved_entity.short_visual_tag in prompt
    # The unbounded huge description must not appear in full in the prompt
    assert huge_description not in prompt
    assert "Alias_11" not in prompt  # Capped at 5 aliases
