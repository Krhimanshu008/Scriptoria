from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers.graph_studio import (
    _build_alias_lookup,
    _compile_location_hierarchy,
    _compile_timeline_ticks,
    _compute_visual_tier_and_score,
)
from app.schemas.compiler_contracts import (
    CompileBookRequest,
    CompiledBookGraphResponse,
    TimelineResponse,
    CharacterRegistryResponse,
    LocationTreeResponse,
)

client = TestClient(app)


def test_alias_resolution_logic():
    raw_entities = [
        {
            "entity_id": "ent-santiago",
            "canonical_name": "Santiago",
            "aliases": ["The Boy", "The Shepherd"],
        },
        {
            "entity_id": "ent-alchemist",
            "canonical_name": "The Alchemist",
            "aliases": ["Master of Secrets"],
        },
    ]
    lookup = _build_alias_lookup(raw_entities)
    assert lookup["santiago"] == "ent-santiago"
    assert lookup["the boy"] == "ent-santiago"
    assert lookup["the shepherd"] == "ent-santiago"
    assert lookup["the alchemist"] == "ent-alchemist"
    assert lookup["master of secrets"] == "ent-alchemist"


def test_location_cycle_detection_ec_3_3():
    # Construct cyclic dependency: A -> B -> C -> A
    cyclic_locations = [
        {
            "location_id": "loc-a",
            "canonical_name": "Location A",
            "parent_location_id": "loc-c",
        },
        {
            "location_id": "loc-b",
            "canonical_name": "Location B",
            "parent_location_id": "loc-a",
        },
        {
            "location_id": "loc-c",
            "canonical_name": "Location C",
            "parent_location_id": "loc-b",
        },
        {
            "location_id": "loc-self",
            "canonical_name": "Location Self",
            "parent_location_id": "loc-self",
        },
    ]
    compiled, has_cycles, breaks = _compile_location_hierarchy(cyclic_locations)
    assert has_cycles is True
    assert breaks >= 2
    # Verify every location has a valid root or tree path without infinite loop
    for loc_id, loc in compiled.items():
        assert loc.materialized_path.startswith("/")
        assert not loc.materialized_path.endswith("//")


def test_dual_timeline_and_flashback_isolation_ec_3_1():
    scenes = [
        {
            "scene_id": "scn-1",
            "chapter_index": 1,
            "scene_order": 1,
            "time_type": "PRESENT",
            "story_time_tick": 1,
        },
        {
            "scene_id": "scn-2",
            "chapter_index": 1,
            "scene_order": 2,
            "time_type": "FLASHBACK",
            "story_time_tick": 0,
        },
        {
            "scene_id": "scn-3",
            "chapter_index": 2,
            "scene_order": 1,
            "time_type": "PRESENT",
            "story_time_tick": 2,
        },
    ]
    timeline = _compile_timeline_ticks(scenes)
    assert len(timeline) == 3
    # Tick 1: PRESENT -> not flashback
    assert timeline[0].narrative_seq == 1
    assert timeline[0].is_flashback is False

    # Tick 2: FLASHBACK (narrative_seq=2 > story_time_tick=0) -> is_flashback True
    assert timeline[1].narrative_seq == 2
    assert timeline[1].is_flashback is True

    # Tick 3: PRESENT -> not flashback
    assert timeline[2].narrative_seq == 3
    assert timeline[2].is_flashback is False


def test_visual_tier_and_importance_scoring_ec_3_2():
    # Protagonist: present in all 5 chapters
    tier_core, score_core = _compute_visual_tier_and_score(
        presence_count=5, first_seen_chapter=0, total_chapters=5
    )
    assert tier_core == "TIER_1_CORE"
    assert score_core >= 0.65

    # Incidental character: present in 1 chapter late
    tier_incidental, score_incidental = _compute_visual_tier_and_score(
        presence_count=1, first_seen_chapter=4, total_chapters=5
    )
    assert tier_incidental == "TIER_3"
    assert score_incidental < 0.35


def test_compiler_endpoints_e2e():
    book_id = "test-compiler-book"

    # 1. POST /api/v1/compiler/compile
    res_compile = client.post("/api/v1/compiler/compile", json={"book_id": book_id})
    assert res_compile.status_code == 200
    graph = res_compile.json()
    assert graph["ok"] is True
    assert graph["book_id"] == book_id
    assert len(graph["entities"]) > 0
    assert len(graph["locations"]) > 0
    assert len(graph["timeline"]) > 0
    assert len(graph["edges"]) > 0

    # 2. GET /api/v1/compiler/graph/{book_id}
    res_graph = client.get(f"/api/v1/compiler/graph/{book_id}")
    assert res_graph.status_code == 200
    assert res_graph.json()["total_chapters"] == graph["total_chapters"]

    # 3. GET /api/v1/compiler/timeline/{book_id}
    res_timeline = client.get(f"/api/v1/compiler/timeline/{book_id}")
    assert res_timeline.status_code == 200
    tl = res_timeline.json()
    assert tl["ok"] is True
    assert tl["total_ticks"] == len(graph["timeline"])
    assert tl["flashback_count"] >= 1

    # 4. GET /api/v1/compiler/characters/{book_id}
    res_chars = client.get(f"/api/v1/compiler/characters/{book_id}")
    assert res_chars.status_code == 200
    chars = res_chars.json()
    assert chars["ok"] is True
    assert len(chars["characters"]) > 0
    assert "TIER_1_CORE" in chars["tier_counts"]

    # 5. GET /api/v1/compiler/locations/{book_id}
    res_locs = client.get(f"/api/v1/compiler/locations/{book_id}")
    assert res_locs.status_code == 200
    locs = res_locs.json()
    assert locs["ok"] is True
    assert locs["cycle_free_verified"] is True
    assert len(locs["root_locations"]) >= 1
