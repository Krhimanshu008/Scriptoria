from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.schemas.rag_contracts import (
    DatabaseFootprintResponse,
    GraphTraversalRequest,
    GraphTraversalResponse,
    PackageRAGRequest,
    PackageRAGResponse,
    RagHybridSearchRequest,
    RagHybridSearchResponse,
    SqlConsoleRequest,
    SqlConsoleResponse,
    TimelineStateQueryRequest,
    TimelineStateQueryResponse,
    TursoSyncRequest,
    TursoSyncResponse,
)

AUTH_HEADERS = {
    "X-Trace-ID": "test-trace-rag-444",
    "X-Bridge-Secret": "dev-bridge-secret-change-me",
}

client = TestClient(app)


def test_rag_contracts_strictness():
    """Verify RAG models forbid extra fields and validate types."""
    with pytest.raises(ValidationError):
        RagHybridSearchRequest.model_validate({
            "book_id": "book-demo",
            "query": "test query",
            "disallowed_field": "error",
        })

    with pytest.raises(ValidationError):
        SqlConsoleRequest.model_validate({
            "book_id": "book-demo",
            "sql": "SELECT 1;",
            "extra_key": 123,
        })


def test_package_rag_and_footprint():
    """EC-4.4: Verify packaging and database size is within 8 MB budget."""
    pkg_resp = client.post(
        "/api/v1/rag/package",
        headers=AUTH_HEADERS,
        json={"book_id": "book-demo", "force_rebuild": True},
    )
    assert pkg_resp.status_code == 200
    pkg_data = pkg_resp.json()
    assert pkg_data["ok"] is True
    assert pkg_data["db_size_kb"] < 8192.0
    assert pkg_data["within_budget"] is not None or pkg_data["budget_kb"] == 8192.0

    foot_resp = client.get("/api/v1/rag/footprint/book-demo", headers=AUTH_HEADERS)
    assert foot_resp.status_code == 200
    foot_data = foot_resp.json()
    assert foot_data["ok"] is True
    assert foot_data["within_budget"] is True
    assert foot_data["db_size_kb"] < 8192.0
    assert foot_data["percent_used"] < 10.0


def test_hybrid_search_rrf_and_spoiler_shield():
    """EC-4.2: Verify Global Spoiler Shield blocks all chunks with narrative_seq > max_narrative_seq."""
    # When max_narrative_seq is 2, only chunks from seq 1 and 2 should be returned.
    # Future chunks (seq 3, 4, 5, 6, 10) must be blocked!
    resp = client.post(
        "/api/v1/rag/hybrid-search",
        headers=AUTH_HEADERS,
        json={
            "book_id": "book-demo",
            "query": "abandoned church sycamore gold coins",
            "max_narrative_seq": 2,
            "top_k": 10,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["max_narrative_seq"] == 2
    assert data["future_blocked_chunks"] > 0

    for hit in data["results"]:
        assert hit["narrative_seq"] <= 2, f"Chunk {hit['chunk_id']} has narrative_seq {hit['narrative_seq']} > 2 (Spoiler leak!)"
        assert hit["rrf_score"] > 0


def test_timeline_state_recovery():
    """Verify Tool 2 recovers point-in-time outfits and held items across story ticks."""
    resp = client.post(
        "/api/v1/rag/timeline-state",
        headers=AUTH_HEADERS,
        json={
            "book_id": "book-demo",
            "character_ids": ["char_santiago", "char_melchizedek"],
            "tick": 1,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert len(data["states"]) == 2

    santiago = next(s for s in data["states"] if s["character_id"] == "char_santiago")
    assert "Shepherd tunic" in santiago["outfit"]
    assert "item_shovel" in santiago["items_held"]

    # Now check tick 4 (desert robes)
    resp4 = client.post(
        "/api/v1/rag/timeline-state",
        headers=AUTH_HEADERS,
        json={
            "book_id": "book-demo",
            "character_ids": ["char_santiago"],
            "tick": 4,
        },
    )
    assert resp4.status_code == 200
    santiago4 = resp4.json()["states"][0]
    assert "desert robes" in santiago4["outfit"].lower()


def test_graph_traversal():
    """EC-4.3: Verify Tool 3 multi-hop graph expansion and relationship discovery."""
    resp = client.post(
        "/api/v1/rag/graph-traverse",
        headers=AUTH_HEADERS,
        json={
            "book_id": "book-demo",
            "seed_entity": "char_santiago",
            "max_hops": 2,
            "tick": 1,
            "max_narrative_seq": 10,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert len(data["nodes"]) >= 3
    assert len(data["edges"]) >= 2
    assert any(n["entity_id"] == "char_santiago" and n["distance_hops"] == 0 for n in data["nodes"])


def test_safe_sql_console_select_permitted():
    """EC-4.4: Verify SELECT queries execute cleanly and return columns and rows."""
    resp = client.post(
        "/api/v1/rag/sql",
        headers=AUTH_HEADERS,
        json={
            "book_id": "book-demo",
            "sql": "SELECT chunk_id, narrative_seq, quote_anchor FROM rag_chunks LIMIT 3;",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["read_only_enforced"] is True
    assert data["columns"] == ["chunk_id", "narrative_seq", "quote_anchor"]
    assert data["row_count"] == 3
    assert data["error"] is None


def test_safe_sql_console_mutation_rejected():
    """EC-4.4: Verify mutation statements (DROP, DELETE, UPDATE, INSERT) are strictly rejected with 400."""
    mutations = [
        "DROP TABLE rag_chunks;",
        "DELETE FROM rag_chunks WHERE narrative_seq = 1;",
        "UPDATE rag_chunks SET narrative_seq = 99;",
        "INSERT INTO rag_chunks VALUES ('evil', 1, 1, 'bad', 'bad');",
        "ALTER TABLE rag_chunks ADD COLUMN bad TEXT;",
    ]

    for sql in mutations:
        resp = client.post(
            "/api/v1/rag/sql",
            headers=AUTH_HEADERS,
            json={"book_id": "book-demo", "sql": sql},
        )
        assert resp.status_code == 400
        error_body = resp.json()
        assert error_body["ok"] is False
        assert "read-only" in error_body["error"]["message"].lower()


def test_turso_sync():
    """Verify Turso cloud sync returns status and cloud URL."""
    resp = client.post(
        "/api/v1/rag/turso-sync",
        headers=AUTH_HEADERS,
        json={"book_id": "book-demo"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["synced"] is True
    assert "turso.io" in data["cloud_url"]
