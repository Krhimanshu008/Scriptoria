from __future__ import annotations

from typing import Any, Literal
from pydantic import Field

from app.schemas.testbench_contracts import StrictModel

# ============================================================================
# Sprint 4: Hybrid RAG, Graph RAG & Turso SQL Contracts
# ============================================================================

class RagHybridSearchRequest(StrictModel):
    book_id: str = Field(default="book-demo", min_length=1)
    query: str = Field(..., min_length=1)
    max_narrative_seq: int = Field(default=9999, ge=0)
    top_k: int = Field(default=5, ge=1, le=50)


class HybridSearchResultItem(StrictModel):
    chunk_id: str
    narrative_seq: int
    story_time_tick: int
    quote_anchor: str
    shot_suggestion: str
    focal_elements: list[str] = Field(default_factory=list)
    bm25_rank: int | None = None
    vector_rank: int | None = None
    rrf_score: float
    is_future_spoiler: bool = False


class RagHybridSearchResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    query: str
    max_narrative_seq: int
    total_hits: int
    future_blocked_chunks: int
    results: list[HybridSearchResultItem]


class TimelineStateQueryRequest(StrictModel):
    book_id: str = Field(default="book-demo", min_length=1)
    character_ids: list[str] = Field(..., min_length=1)
    tick: int = Field(default=1, ge=0)


class TimelineEntityStateItem(StrictModel):
    character_id: str
    name: str
    tick: int
    outfit: str
    injuries: list[str] = Field(default_factory=list)
    location_id: str
    items_held: list[str] = Field(default_factory=list)


class TimelineStateQueryResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    tick: int
    states: list[TimelineEntityStateItem]


class GraphTraversalRequest(StrictModel):
    book_id: str = Field(default="book-demo", min_length=1)
    seed_entity: str = Field(..., min_length=1)
    max_hops: int = Field(default=2, ge=1, le=5)
    tick: int = Field(default=1, ge=0)
    max_narrative_seq: int = Field(default=9999, ge=0)


class GraphTraversalNode(StrictModel):
    entity_id: str
    canonical_name: str
    entity_type: str
    distance_hops: int


class GraphTraversalEdge(StrictModel):
    source_id: str
    target_id: str
    edge_type: str
    weight: float


class GraphTraversalResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    seed_entity: str
    max_hops: int
    nodes: list[GraphTraversalNode]
    edges: list[GraphTraversalEdge]


class SqlConsoleRequest(StrictModel):
    book_id: str = Field(default="book-demo", min_length=1)
    sql: str = Field(..., min_length=1)


class SqlConsoleResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    columns: list[str]
    rows: list[list[Any]]
    row_count: int
    execution_time_ms: float
    read_only_enforced: Literal[True] = True
    error: str | None = None


class DatabaseFootprintResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    book_id: str
    db_size_kb: float
    budget_kb: float = 8192.0
    percent_used: float
    total_chunks: int
    within_budget: bool


class TursoSyncRequest(StrictModel):
    book_id: str = Field(default="book-demo", min_length=1)
    target_url: str | None = None


class TursoSyncResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    book_id: str
    synced: bool
    cloud_url: str
    sync_latency_ms: float


class PackageRAGRequest(StrictModel):
    book_id: str = Field(default="book-demo", min_length=1)
    force_rebuild: bool = True


class PackageRAGResponse(StrictModel):
    ok: Literal[True] = True
    trace_id: str
    book_id: str
    db_size_kb: float
    budget_kb: float = 8192.0
    percent_used: float
    total_chunks: int
    within_budget: bool = True
    r2_key: str
    duration_sec: float
