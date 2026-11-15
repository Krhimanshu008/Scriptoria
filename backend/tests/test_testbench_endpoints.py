from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_testbench_health_endpoint():
    response = client.get("/api/v1/testbench/health")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["status"] in ("healthy", "degraded")
    assert "trace_id" in data
    assert "sqlite_fts" in data["dependencies"]
    assert "vram_coordinator" in data["dependencies"]
    assert "X-Trace-ID" in response.headers


def test_testbench_contracts_endpoint():
    response = client.get("/api/v1/testbench/contracts")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert len(data["contract_hash"]) == 64
    assert data["schema_version"] == "1.0.0"
    assert data["limits"]["max_payload_bytes"] > 0


def test_testbench_echo_validate_endpoint():
    text = "Testing Scriptoria 🚀 with dual-span parity"
    payload = {
        "text": text,
        "probe_cp_start": 8,
        "probe_cp_end": 18,
        "metadata": {"test_run": True},
    }
    response = client.post("/api/v1/testbench/echo-validate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["echoed_text"] == text
    assert data["codepoint_length"] == len(text)
    assert data["full_span"]["codepoint_start"] == 0
    assert data["full_span"]["codepoint_end"] == len(text)
    assert data["probe_span"] is not None


def test_parser_presets_endpoint():
    response = client.get("/api/v1/parser/presets")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["default_profile_id"] == "fiction_standard"
    assert ".epub" in data["supported_extensions"]
    assert len(data["profiles"]) >= 3


def test_parser_inspect_endpoint():
    sample_novel = (
        "# Chapter 1: The Beginning\n\n"
        "The night was dark and quiet.\n\n"
        "<SCENE_BREAK />\n\n"
        "A distant lantern flickered through the mist.\n\n"
        "## Chapter 2: The Departure\n\n"
        "They left before dawn."
    )
    payload = {
        "raw_text": sample_novel,
        "source_name": "test_book.md",
        "normalize_ligatures": True,
        "include_ast": True,
        "include_chunks": True,
    }
    response = client.post("/api/v1/parser/inspect", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["chapter_count"] == 2
    assert data["scene_count"] >= 2
    assert len(data["chunks"]) >= 2
    assert data["document_tree"] is not None
    assert data["document_tree"]["node_type"] == "document"
