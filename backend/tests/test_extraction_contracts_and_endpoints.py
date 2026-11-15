from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers.extraction_lab import anchor_quote_in_text, _enforce_bloat_cap
from app.routers.vm_swarm_control import reset_vram_state_for_tests
from app.schemas.extraction_contracts import (
    ExtractedEntityItem,
    QuoteAnchorMatch,
    RollingGlossarySnapshot,
    VramLockRequest,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_vram_state():
    reset_vram_state_for_tests()
    yield
    reset_vram_state_for_tests()


def test_quote_anchor_matching_exact_and_fuzzy():
    text = (
        "The cold mountain wind howled through the narrow pass. "
        "A solitary lantern flickered in the dark. 🚀 Journey begins here."
    )

    # 1. Exact match
    exact_res = anchor_quote_in_text(text, "A solitary lantern flickered in the dark.")
    assert exact_res.match_quality == "EXACT"
    assert exact_res.similarity_score == 1.0
    assert exact_res.span is not None
    assert text[exact_res.span.codepoint_start : exact_res.span.codepoint_end] == exact_res.exact_quote

    # 2. Match with astral plane emoji (🚀)
    astral_quote = "Journey begins here."
    astral_res = anchor_quote_in_text(text, astral_quote)
    assert astral_res.match_quality == "EXACT"
    assert astral_res.span is not None
    assert astral_res.span.utf16_end - astral_res.span.utf16_start == len(astral_quote)

    # 3. Fuzzy match (case-insensitive)
    fuzzy_res = anchor_quote_in_text(text, "a solitary lantern flickered in the dark.")
    assert fuzzy_res.match_quality == "FUZZY"
    assert fuzzy_res.similarity_score >= 0.95
    assert fuzzy_res.span is not None


def test_bloat_cap_enforcement_ec_2_4():
    long_tag = "A" * 150
    capped = _enforce_bloat_cap(long_tag, max_chars=120)
    assert len(capped) <= 120
    assert capped.endswith("...")

    # Pydantic schema validation rejects tags > 120 chars directly
    with pytest.raises(Exception):
        ExtractedEntityItem(
            entity_id="char_1",
            canonical_name="Marcus",
            short_visual_tag="A" * 121,
            entity_type="CHARACTER",
        )


def test_vm_swarm_status_endpoint():
    res = client.get("/api/v1/vm/swarm/status")
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "targets" in data
    assert "gpu0" in data["targets"]
    assert "vram_state" in data
    assert data["vram_state"]["active_mode"] == "IDLE"


def test_vram_mutual_eviction_lock_state_machine():
    # 1. Acquire EXTRACTION_SWARM
    res1 = client.post(
        "/api/v1/vm/vram/lock",
        json={"requested_mode": "EXTRACTION_SWARM", "client_id": "testbench-worker-1", "force": False},
    )
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["active_mode"] == "EXTRACTION_SWARM"
    assert data1["lock_holder"] == "testbench-worker-1"

    # 2. Conflicting attempt: IMAGE_GEN_COMFYUI without force -> 409 Conflict
    res2 = client.post(
        "/api/v1/vm/vram/lock",
        json={"requested_mode": "IMAGE_GEN_COMFYUI", "client_id": "comfyui-client", "force": False},
    )
    assert res2.status_code == 409
    data2 = res2.json()
    assert data2["ok"] is False
    assert data2["error"]["code"] == "VRAM_BUSY"

    # 3. Force-evict: IMAGE_GEN_COMFYUI with force=True -> 200
    res3 = client.post(
        "/api/v1/vm/vram/lock",
        json={"requested_mode": "IMAGE_GEN_COMFYUI", "client_id": "comfyui-client", "force": True},
    )
    assert res3.status_code == 200
    data3 = res3.json()
    assert data3["active_mode"] == "IMAGE_GEN_COMFYUI"
    assert data3["lock_holder"] == "comfyui-client"

    # 4. Release to IDLE
    res4 = client.post(
        "/api/v1/vm/vram/lock",
        json={"requested_mode": "IDLE", "client_id": "comfyui-client", "force": False},
    )
    assert res4.status_code == 200
    data4 = res4.json()
    assert data4["active_mode"] == "IDLE"


def test_extraction_chapter_endpoint():
    raw_chapter = (
        "# Chapter 1: The Mountain Fortress\n\n"
        "Marcus stood at the gate watching the storm gather over the peaks.\n\n"
        "<SCENE_BREAK />\n\n"
        "Elena approached with the ancient parchment map.\n"
        "'The pass will be closed by morning,' Elena warned."
    )
    payload = {
        "book_id": "book-test-101",
        "chapter_index": 1,
        "chapter_title": "The Mountain Fortress",
        "raw_text": raw_chapter,
        "worker_target": "gpu0",
    }
    res = client.post("/api/v1/extraction/chapter", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["book_id"] == "book-test-101"
    assert data["chapter_index"] == 1
    assert len(data["scenes"]) >= 1
    assert data["quote_stats"]["total_beats"] > 0
    assert data["quote_stats"]["match_rate_percent"] > 0
    assert len(data["updated_glossary"]["entities"]) >= 1


def test_crash_simulation_and_checkpoints_ec_2_3():
    book_id = "book-crash-ec23"

    # 1. Simulate crash at chapter 3 of 5
    sim_res = client.post(
        "/api/v1/extraction/crash-simulate",
        json={"book_id": book_id, "fail_at_chapter": 3, "total_chapters": 5},
    )
    assert sim_res.status_code == 200
    sim_data = sim_res.json()
    assert sim_data["crashed_at_chapter"] == 3
    assert sim_data["completed_before_crash"] == [1, 2]
    assert sim_data["resumable_chapter"] == 3
    assert sim_data["idempotent_verified"] is True

    # 2. Query checkpoints
    cp_res = client.get(f"/api/v1/extraction/checkpoints/{book_id}")
    assert cp_res.status_code == 200
    cp_data = cp_res.json()
    assert cp_data["ok"] is True
    assert cp_data["can_resume_at_chapter"] == 3
    assert len(cp_data["checkpoints"]) == 2
    assert [c["chapter_index"] for c in cp_data["checkpoints"]] == [1, 2]
