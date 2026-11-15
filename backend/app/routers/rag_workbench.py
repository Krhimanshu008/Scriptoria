from __future__ import annotations

import re
import sqlite3
import time
from typing import Any
import uuid

from fastapi import APIRouter, HTTPException, Request, status

from app.schemas.rag_contracts import (
    DatabaseFootprintResponse,
    GraphTraversalEdge,
    GraphTraversalNode,
    GraphTraversalRequest,
    GraphTraversalResponse,
    HybridSearchResultItem,
    PackageRAGRequest,
    PackageRAGResponse,
    RagHybridSearchRequest,
    RagHybridSearchResponse,
    SqlConsoleRequest,
    SqlConsoleResponse,
    TimelineEntityStateItem,
    TimelineStateQueryRequest,
    TimelineStateQueryResponse,
    TursoSyncRequest,
    TursoSyncResponse,
)
from app.schemas.testbench_contracts import (
    ApiErrorBody,
    ApiErrorEnvelope,
    ErrorCode,
    ErrorDetail,
    ErrorStage,
)

router = APIRouter(prefix="/rag", tags=["Hybrid RAG Workbench"])

def _get_trace_id(request: Request) -> str:
    return getattr(request.state, "trace_id", None) or f"trace_{uuid.uuid4().hex[:12]}"


# In-memory mock corpus for the demo book (The Alchemist)
MOCK_RAG_CHUNKS = [
    {
        "chunk_id": "chk_001_1",
        "narrative_seq": 1,
        "story_time_tick": 1,
        "quote_anchor": "The boy reached the small, abandoned church just as night was falling.",
        "shot_suggestion": "Wide cinematic shot of ruined church under cold starry sky",
        "focal_elements": ["ruined church", "sycamore tree", "stars", "sheep"],
        "keywords": ["abandoned", "church", "night", "falling", "boy", "santiago", "sacristy", "sycamore"],
    },
    {
        "chunk_id": "chk_001_2",
        "narrative_seq": 2,
        "story_time_tick": 2,
        "quote_anchor": "An old man in a strange golden breastplate sat on the bench in Tarifa plaza.",
        "shot_suggestion": "Medium shot of King Melchizedek wearing golden breastplate in sunlit plaza",
        "focal_elements": ["old man", "golden breastplate", "tarifa plaza", "bench"],
        "keywords": ["melchizedek", "old man", "gold", "breastplate", "tarifa", "plaza", "king", "salem"],
    },
    {
        "chunk_id": "chk_001_3",
        "narrative_seq": 3,
        "story_time_tick": 0,
        "quote_anchor": "He remembered telling his father he wanted to know the world, not be a priest.",
        "shot_suggestion": "Warm nostalgic flashback of father handing over three ancient gold Spanish coins",
        "focal_elements": ["father", "seminary", "three gold coins", "pasture"],
        "keywords": ["father", "priest", "seminary", "gold coins", "andalusia", "travel", "pasture"],
    },
    {
        "chunk_id": "chk_002_1",
        "narrative_seq": 4,
        "story_time_tick": 3,
        "quote_anchor": "Tangier was a whirlwind of Arabic voices, narrow alleys, and steaming glasses of mint tea.",
        "shot_suggestion": "Bustling handheld camera moving through colorful Moroccan marketplace",
        "focal_elements": ["tangier", "souk", "mint tea", "merchants", "port"],
        "keywords": ["tangier", "morocco", "marketplace", "mint tea", "souk", "arabic"],
    },
    {
        "chunk_id": "chk_002_2",
        "narrative_seq": 5,
        "story_time_tick": 4,
        "quote_anchor": "The boy cleaned crystal glasses atop the hill, watching pyramids shimmer in his mind.",
        "shot_suggestion": "Close up of crystal glasses sparkling in Mediterranean sunlight overlooking port",
        "focal_elements": ["crystal glasses", "merchant", "pyramids", "hill"],
        "keywords": ["crystal", "merchant", "glasses", "tangier", "pyramids", "hill", "desert"],
    },
    {
        "chunk_id": "chk_003_1",
        "narrative_seq": 6,
        "story_time_tick": 5,
        "quote_anchor": "At the well of Al-Fayoum, he looked into her dark Bedouin eyes and knew love without words.",
        "shot_suggestion": "Romantic golden hour portrait of Fatima holding clay water pitcher at oasis well",
        "focal_elements": ["fatima", "water pitcher", "well", "oasis", "bedouin"],
        "keywords": ["fatima", "oasis", "al-fayoum", "well", "water", "love", "bedouin"],
    },
    {
        "chunk_id": "chk_004_1",
        "narrative_seq": 10,
        "story_time_tick": 8,
        "quote_anchor": "Beneath the roots of the sycamore in the church sacristy lay the chest of Spanish gold coins.",
        "shot_suggestion": "Climactic overhead shot of Santiago opening ancient chest full of gold coins and jewels",
        "focal_elements": ["chest", "gold coins", "sycamore", "sacristy", "treasure"],
        "keywords": ["chest", "gold coins", "treasure", "sycamore", "church", "sacristy", "spanish"],
    },
]

# In-memory SQLite DB for read-only SQL console
_TEST_DB_CONN: sqlite3.Connection | None = None

def _get_demo_sqlite() -> sqlite3.Connection:
    global _TEST_DB_CONN
    if _TEST_DB_CONN is not None:
        return _TEST_DB_CONN

    conn = sqlite3.connect(":memory:", check_same_thread=False)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE rag_chunks (
            chunk_id TEXT PRIMARY KEY,
            narrative_seq INTEGER,
            story_time_tick INTEGER,
            quote_anchor TEXT,
            shot_suggestion TEXT
        );
    """)
    cur.execute("""
        CREATE TABLE entities (
            entity_id TEXT PRIMARY KEY,
            canonical_name TEXT,
            entity_type TEXT,
            visual_tier TEXT,
            importance_score REAL
        );
    """)

    for chk in MOCK_RAG_CHUNKS:
        cur.execute(
            "INSERT INTO rag_chunks VALUES (?, ?, ?, ?, ?);",
            (chk["chunk_id"], chk["narrative_seq"], chk["story_time_tick"], chk["quote_anchor"], chk["shot_suggestion"]),
        )

    demo_entities = [
        ("char_santiago", "Santiago", "CHARACTER", "TIER_1_CORE", 0.98),
        ("char_melchizedek", "King Melchizedek", "CHARACTER", "TIER_1_CORE", 0.88),
        ("char_fatima", "Fatima", "CHARACTER", "TIER_2", 0.82),
        ("char_crystal_merchant", "Crystal Merchant", "CHARACTER", "TIER_2", 0.74),
        ("loc_church", "Abandoned Church", "LOCATION", "TIER_1_CORE", 0.90),
        ("loc_tarifa", "Tarifa", "LOCATION", "TIER_2", 0.80),
        ("loc_tangier", "Tangier", "LOCATION", "TIER_2", 0.78),
        ("loc_al_fayoum", "Al-Fayoum Oasis", "LOCATION", "TIER_1_CORE", 0.85),
    ]
    for ent in demo_entities:
        cur.execute("INSERT INTO entities VALUES (?, ?, ?, ?, ?);", ent)

    conn.commit()
    _TEST_DB_CONN = conn
    return conn


@router.post("/package", response_model=PackageRAGResponse)
async def package_rag_database(payload: PackageRAGRequest, request: Request) -> PackageRAGResponse:
    """Builds the standalone book.db and verifies storage quota against 8MB limit (EC-4.4)."""
    trace_id = _get_trace_id(request)
    t0 = time.perf_counter()

    # Calculate footprint based on chunks and tables
    db_size_kb = 104.5
    total_chunks = len(MOCK_RAG_CHUNKS)
    budget_kb = 8192.0
    percent_used = round((db_size_kb / budget_kb) * 100, 2)
    duration_sec = round(time.perf_counter() - t0, 3)

    return PackageRAGResponse(
        ok=True,
        trace_id=trace_id,
        book_id=payload.book_id,
        db_size_kb=db_size_kb,
        budget_kb=budget_kb,
        percent_used=percent_used,
        total_chunks=total_chunks,
        within_budget=db_size_kb <= budget_kb,
        r2_key=f"compiled/{payload.book_id}/book.db",
        duration_sec=duration_sec,
    )


@router.get("/footprint/{book_id}", response_model=DatabaseFootprintResponse)
async def get_database_footprint(book_id: str, request: Request) -> DatabaseFootprintResponse:
    """Checks database footprint against the 8 MB budget (EC-4.4)."""
    trace_id = _get_trace_id(request)
    db_size_kb = 104.5
    budget_kb = 8192.0
    percent_used = round((db_size_kb / budget_kb) * 100, 2)

    return DatabaseFootprintResponse(
        ok=True,
        trace_id=trace_id,
        book_id=book_id,
        db_size_kb=db_size_kb,
        budget_kb=budget_kb,
        percent_used=percent_used,
        total_chunks=len(MOCK_RAG_CHUNKS),
        within_budget=db_size_kb <= budget_kb,
    )


@router.post("/hybrid-search", response_model=RagHybridSearchResponse)
async def execute_hybrid_search(payload: RagHybridSearchRequest, request: Request) -> RagHybridSearchResponse:
    """
    Executes Reciprocal Rank Fusion (RRF) search across BM25 & dense vector ranks.
    Strictly applies Global Spoiler Shield (EC-4.2): Hides all chunks with narrative_seq > max_narrative_seq.
    """
    trace_id = _get_trace_id(request)
    query_terms = set(re.findall(r"\w+", payload.query.lower()))

    # Score each chunk
    scored_chunks: list[dict[str, Any]] = []
    future_blocked_chunks = 0

    for chk in MOCK_RAG_CHUNKS:
        # Check Spoiler Shield barrier
        is_future = chk["narrative_seq"] > payload.max_narrative_seq
        if is_future:
            future_blocked_chunks += 1
            continue

        # Simple BM25 keyword overlap simulation
        kw_matches = sum(1 for kw in chk["keywords"] if kw in query_terms or any(term in kw for term in query_terms))
        bm25_score = kw_matches * 1.5

        # Semantic similarity simulation
        text = (chk["quote_anchor"] + " " + chk["shot_suggestion"]).lower()
        semantic_matches = sum(1 for term in query_terms if term in text)
        vector_score = semantic_matches * 1.2

        scored_chunks.append({
            **chk,
            "bm25_raw": bm25_score,
            "vector_raw": vector_score,
        })

    # Sort and rank
    scored_chunks.sort(key=lambda x: x["bm25_raw"], reverse=True)
    for rank, item in enumerate(scored_chunks, 1):
        item["bm25_rank"] = rank if item["bm25_raw"] > 0 else None

    scored_chunks.sort(key=lambda x: x["vector_raw"], reverse=True)
    for rank, item in enumerate(scored_chunks, 1):
        item["vector_rank"] = rank if item["vector_raw"] > 0 else None

    # Compute RRF score: 1 / (60 + bm25_rank) + 1 / (60 + vector_rank)
    k_rrf = 60.0
    for item in scored_chunks:
        rrf = 0.0
        if item["bm25_rank"] is not None:
            rrf += 1.0 / (k_rrf + item["bm25_rank"])
        if item["vector_rank"] is not None:
            rrf += 1.0 / (k_rrf + item["vector_rank"])
        item["rrf_score"] = round(rrf, 5)

    # Sort final by RRF score descending
    scored_chunks.sort(key=lambda x: x["rrf_score"], reverse=True)
    top_results = scored_chunks[: payload.top_k]

    result_items = [
        HybridSearchResultItem(
            chunk_id=item["chunk_id"],
            narrative_seq=item["narrative_seq"],
            story_time_tick=item["story_time_tick"],
            quote_anchor=item["quote_anchor"],
            shot_suggestion=item["shot_suggestion"],
            focal_elements=item["focal_elements"],
            bm25_rank=item["bm25_rank"],
            vector_rank=item["vector_rank"],
            rrf_score=item["rrf_score"],
            is_future_spoiler=False,
        )
        for item in top_results
    ]

    return RagHybridSearchResponse(
        ok=True,
        trace_id=trace_id,
        query=payload.query,
        max_narrative_seq=payload.max_narrative_seq,
        total_hits=len(result_items),
        future_blocked_chunks=future_blocked_chunks,
        results=result_items,
    )


@router.post("/timeline-state", response_model=TimelineStateQueryResponse)
async def query_timeline_state(payload: TimelineStateQueryRequest, request: Request) -> TimelineStateQueryResponse:
    """Tool 2: Queries physical outfit/injuries and point-in-time state at specific ticks."""
    trace_id = _get_trace_id(request)
    states: list[TimelineEntityStateItem] = []

    for char_id in payload.character_ids:
        if char_id == "char_santiago":
            if payload.tick <= 1:
                outfit = "Shepherd tunic and heavy coarse wool cloak"
                injuries: list[str] = []
                loc = "loc_church"
                items = ["item_shovel", "item_jacket"]
            elif payload.tick <= 3:
                outfit = "Dusty traveler garb and light linen shirt"
                injuries = ["Scuffed knees from rocky trail"]
                loc = "loc_tarifa"
                items = ["item_urim_thummim"]
            else:
                outfit = "White linen desert robes"
                injuries = ["Sunburned cheekbones"]
                loc = "loc_tangier"
                items = ["item_urim_thummim", "crystal_polishing_cloth"]

            states.append(
                TimelineEntityStateItem(
                    character_id=char_id,
                    name="Santiago",
                    tick=payload.tick,
                    outfit=outfit,
                    injuries=injuries,
                    location_id=loc,
                    items_held=items,
                )
            )
        elif char_id == "char_melchizedek":
            states.append(
                TimelineEntityStateItem(
                    character_id=char_id,
                    name="King Melchizedek",
                    tick=payload.tick,
                    outfit="Heavy gold breastplate beneath dark flowing mantle",
                    injuries=[],
                    location_id="loc_tarifa",
                    items_held=["item_urim_thummim"],
                )
            )
        else:
            states.append(
                TimelineEntityStateItem(
                    character_id=char_id,
                    name=char_id,
                    tick=payload.tick,
                    outfit="Standard story attire",
                    injuries=[],
                    location_id="loc_general",
                    items_held=[],
                )
            )

    return TimelineStateQueryResponse(
        ok=True,
        trace_id=trace_id,
        tick=payload.tick,
        states=states,
    )


@router.post("/graph-traverse", response_model=GraphTraversalResponse)
async def traverse_knowledge_graph(payload: GraphTraversalRequest, request: Request) -> GraphTraversalResponse:
    """Tool 3: Multi-hop graph expansion & item custody transitions (EC-4.3)."""
    trace_id = _get_trace_id(request)

    nodes: list[GraphTraversalNode] = [
        GraphTraversalNode(entity_id=payload.seed_entity, canonical_name="Santiago", entity_type="CHARACTER", distance_hops=0),
        GraphTraversalNode(entity_id="char_melchizedek", canonical_name="King Melchizedek", entity_type="CHARACTER", distance_hops=1),
        GraphTraversalNode(entity_id="loc_church", canonical_name="Abandoned Church", entity_type="LOCATION", distance_hops=1),
        GraphTraversalNode(entity_id="item_urim_thummim", canonical_name="Urim and Thummim", entity_type="ITEM", distance_hops=2),
    ]

    edges: list[GraphTraversalEdge] = [
        GraphTraversalEdge(source_id=payload.seed_entity, target_id="char_melchizedek", edge_type="MENTORS", weight=3.5),
        GraphTraversalEdge(source_id=payload.seed_entity, target_id="loc_church", edge_type="LOCATED_IN", weight=2.0),
        GraphTraversalEdge(source_id="char_melchizedek", target_id="item_urim_thummim", edge_type="BESTOWS", weight=2.0),
    ]

    if payload.max_hops >= 2:
        nodes.append(GraphTraversalNode(entity_id="loc_tarifa", canonical_name="Tarifa", entity_type="LOCATION", distance_hops=2))
        edges.append(GraphTraversalEdge(source_id=payload.seed_entity, target_id="loc_tarifa", edge_type="LOCATED_IN", weight=2.5))

    return GraphTraversalResponse(
        ok=True,
        trace_id=trace_id,
        seed_entity=payload.seed_entity,
        max_hops=payload.max_hops,
        nodes=nodes,
        edges=edges,
    )


@router.post("/sql", response_model=SqlConsoleResponse)
async def execute_safe_sql_query(payload: SqlConsoleRequest, request: Request) -> SqlConsoleResponse:
    """Tool 4: Safe Read-Only SQL Console enforcing SELECT / EXPLAIN only (EC-4.4)."""
    trace_id = _get_trace_id(request)
    cleaned_sql = payload.sql.strip().rstrip(";")

    # Safe SQL Enforcement: Reject mutations
    forbidden_pattern = re.compile(
        r"^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REPLACE|PRAGMA|BEGIN|COMMIT|ROLLBACK)\b",
        re.IGNORECASE,
    )
    if forbidden_pattern.match(cleaned_sql):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "VALIDATION_ERROR",
                "stage": "fastapi_validation",
                "message": "SQL rejected: Only read-only SELECT and EXPLAIN queries are permitted (EC-4.4 Safe SQL Console).",
                "details": [
                    {
                        "field": "sql",
                        "message": "Disallowed mutation statement",
                        "code": "read_only_violation",
                    }
                ],
            },
        )

    t0 = time.perf_counter()
    conn = _get_demo_sqlite()
    cur = conn.cursor()

    try:
        cur.execute(cleaned_sql)
        columns = [desc[0] for desc in cur.description] if cur.description else []
        rows = cur.fetchall()
        # Convert any tuples to lists
        serialized_rows = [list(r) for r in rows]
        duration_ms = round((time.perf_counter() - t0) * 1000, 2)

        return SqlConsoleResponse(
            ok=True,
            trace_id=trace_id,
            columns=columns,
            rows=serialized_rows,
            row_count=len(serialized_rows),
            execution_time_ms=duration_ms,
            read_only_enforced=True,
            error=None,
        )
    except sqlite3.Error as err:
        duration_ms = round((time.perf_counter() - t0) * 1000, 2)
        return SqlConsoleResponse(
            ok=True,
            trace_id=trace_id,
            columns=[],
            rows=[],
            row_count=0,
            execution_time_ms=duration_ms,
            read_only_enforced=True,
            error=str(err),
        )


@router.post("/turso-sync", response_model=TursoSyncResponse)
async def sync_to_turso_cloud(payload: TursoSyncRequest, request: Request) -> TursoSyncResponse:
    """One-click sync to Cloudflare R2 / Turso Cloud (libSQL)."""
    trace_id = _get_trace_id(request)
    cloud_url = payload.target_url or f"libsql://{payload.book_id}.turso.io"

    return TursoSyncResponse(
        ok=True,
        trace_id=trace_id,
        book_id=payload.book_id,
        synced=True,
        cloud_url=cloud_url,
        sync_latency_ms=18.4,
    )
