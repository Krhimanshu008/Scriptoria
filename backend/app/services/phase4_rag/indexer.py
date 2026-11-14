"""
SQLite & Turso Hybrid RAG Indexer (v1.0.0) for Scriptoria.
Packages compiled book knowledge graph, visual beats, FTS5 BM25 search indices,
and 768-dim vector embeddings into a standalone SQLite/Turso database.
"""

from __future__ import annotations

import os
import json
import sqlite3
import logging
from pathlib import Path
from typing import List, Optional, Dict, Any

from backend.app.models.canonical_protocol import (
    ChapterObservation,
    CompiledBookGraph,
    CompiledEntity,
)
from backend.app.services.phase4_rag.embeddings import SemanticEmbeddingService
from backend.app.services.r2_storage import R2StorageService

logger = logging.getLogger("Scriptoria.RAGIndexer")


SQL_SCHEMA = """
-- 1. Chunked Visual Beats & Prose Context
CREATE TABLE IF NOT EXISTS rag_chunks (
    chunk_id TEXT PRIMARY KEY,
    narrative_seq INTEGER NOT NULL,
    story_time_tick INTEGER NOT NULL,
    chapter_index INTEGER NOT NULL,
    scene_id TEXT NOT NULL,
    beat_order INTEGER NOT NULL,
    content TEXT NOT NULL,
    quote_anchor TEXT NOT NULL,
    shot_suggestion TEXT NOT NULL,
    embedding_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_narrative ON rag_chunks(narrative_seq);
CREATE INDEX IF NOT EXISTS idx_chunks_story_tick ON rag_chunks(story_time_tick);

-- 2. Full-Text Search BM25 Virtual Table (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
    chunk_id UNINDEXED,
    content,
    quote_anchor,
    shot_suggestion,
    tokenize = 'porter unicode61'
);

-- 3. Knowledge Graph Entity Nodes
CREATE TABLE IF NOT EXISTS kg_nodes (
    node_id TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    aliases_json TEXT NOT NULL,
    category TEXT NOT NULL,
    static_traits TEXT NOT NULL,
    visual_tier TEXT NOT NULL,
    importance_score REAL NOT NULL,
    presence_score REAL NOT NULL,
    agency_score REAL NOT NULL,
    centrality_score REAL NOT NULL,
    detail_density REAL NOT NULL
);

-- 4. Temporal State History
CREATE TABLE IF NOT EXISTS kg_states (
    state_id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    narrative_seq INTEGER NOT NULL,
    story_time_tick INTEGER NOT NULL,
    scene_id TEXT NOT NULL,
    outfit TEXT,
    physical_condition TEXT,
    injuries_json TEXT,
    items_held_json TEXT,
    is_stale INTEGER DEFAULT 0,
    FOREIGN KEY(node_id) REFERENCES kg_nodes(node_id)
);

CREATE INDEX IF NOT EXISTS idx_states_node_narrative ON kg_states(node_id, narrative_seq);
CREATE INDEX IF NOT EXISTS idx_states_node_story ON kg_states(node_id, story_time_tick);

-- 5. Knowledge Graph Edges
CREATE TABLE IF NOT EXISTS kg_edges (
    edge_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    narrative_seq INTEGER,
    story_time_tick INTEGER
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON kg_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON kg_edges(target_id);

-- 6. Hierarchical Locations
CREATE TABLE IF NOT EXISTS kg_locations (
    location_id TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    parent_location_id TEXT,
    materialized_path TEXT NOT NULL,
    environment_tags_json TEXT
);
"""


class HybridRAGIndexer:
    """
    Compiles, populates, and packages a high-performance SQLite database
    supporting Hybrid Vector + BM25 FTS5 retrieval, spoiler barriers, and temporal graph queries.
    """

    def __init__(
        self,
        embedder: Optional[SemanticEmbeddingService] = None,
        r2: Optional[R2StorageService] = None,
    ):
        self.embedder = embedder or SemanticEmbeddingService()
        self.r2 = r2 or R2StorageService()

    def build_database(
        self,
        graph: CompiledBookGraph,
        observations: List[ChapterObservation],
        db_path: str,
    ) -> str:
        """
        Creates SQLite database at db_path and populates chunks, FTS5 index,
        nodes, states, locations, and edges.
        """
        p = Path(db_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        if p.exists():
            p.unlink()

        conn = sqlite3.connect(str(p))
        cur = conn.cursor()

        # Initialize schema
        cur.executescript(SQL_SCHEMA)

        # Build fast lookup for timeline ticks by (chapter_index, scene_id)
        tick_map = {
            (t.chapter_index, t.scene_id): t for t in graph.timeline
        }

        # 1. Populate rag_chunks and rag_chunks_fts (Subtask 4.1)
        logger.info("Indexing visual beats and prose context into rag_chunks & FTS5...")
        for obs in observations:
            for sc in obs.scenes:
                tick_info = tick_map.get((obs.chapter_index, sc.scene_id))
                narrative_seq = tick_info.narrative_seq if tick_info else 1
                story_tick = tick_info.story_time_tick if tick_info else 1000

                loc_name = sc.setting.location_name
                time_of_day = sc.setting.time_of_day

                for beat in sc.key_visual_beats:
                    chunk_id = f"chunk_{sc.scene_id}_b{beat.beat_order:02d}"

                    # Context-enriched chunk text
                    focal_str = ", ".join(beat.focal_elements)
                    content = (
                        f"[{obs.chapter_title}] [Scene {sc.scene_id} at {loc_name} ({time_of_day})]\n"
                        f"Prose: \"{beat.quote_anchor}\"\n"
                        f"Shot: {beat.shot_suggestion}\n"
                        f"Focal Elements: {focal_str}\n"
                        f"Summary: {sc.verbatim_excerpt_summary}"
                    )

                    # Compute 768-dim embedding
                    embedding_vec = self.embedder.embed_text(content)
                    embedding_json = json.dumps(embedding_vec)

                    cur.execute(
                        """
                        INSERT INTO rag_chunks (
                            chunk_id, narrative_seq, story_time_tick, chapter_index,
                            scene_id, beat_order, content, quote_anchor, shot_suggestion, embedding_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            chunk_id,
                            narrative_seq,
                            story_tick,
                            obs.chapter_index,
                            sc.scene_id,
                            beat.beat_order,
                            content,
                            beat.quote_anchor,
                            beat.shot_suggestion,
                            embedding_json,
                        ),
                    )

                    cur.execute(
                        """
                        INSERT INTO rag_chunks_fts (chunk_id, content, quote_anchor, shot_suggestion)
                        VALUES (?, ?, ?, ?)
                        """,
                        (
                            chunk_id,
                            content,
                            beat.quote_anchor,
                            beat.shot_suggestion,
                        ),
                    )

        # 2. Populate kg_nodes and kg_states (Subtask 4.2)
        logger.info(f"Indexing {len(graph.entities)} entity nodes and temporal states...")
        for ent_id, ent in graph.entities.items():
            cur.execute(
                """
                INSERT INTO kg_nodes (
                    node_id, canonical_name, aliases_json, category, static_traits,
                    visual_tier, importance_score, presence_score, agency_score,
                    centrality_score, detail_density
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ent.entity_id,
                    ent.canonical_name,
                    json.dumps(ent.aliases),
                    ent.entity_type.value,
                    ent.static_traits,
                    ent.visual_tier.value,
                    ent.importance_score,
                    ent.presence_score,
                    ent.agency_score,
                    ent.centrality_score,
                    ent.detail_density,
                ),
            )

            for state in ent.state_history:
                cur.execute(
                    """
                    INSERT INTO kg_states (
                        node_id, narrative_seq, story_time_tick, scene_id,
                        outfit, physical_condition, injuries_json, items_held_json, is_stale
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        ent.entity_id,
                        state.narrative_seq,
                        state.story_tick,
                        state.scene_id,
                        state.outfit,
                        state.physical_condition,
                        json.dumps(state.injuries),
                        json.dumps(state.items_held),
                        1 if state.is_stale else 0,
                    ),
                )

        # 3. Populate kg_locations
        logger.info(f"Indexing {len(graph.locations)} locations...")
        for loc_id, loc in graph.locations.items():
            cur.execute(
                """
                INSERT INTO kg_locations (
                    location_id, canonical_name, parent_location_id, materialized_path, environment_tags_json
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    loc.location_id,
                    loc.canonical_name,
                    loc.parent_location_id,
                    loc.materialized_path,
                    json.dumps(loc.environment_tags),
                ),
            )

        # 4. Populate kg_edges
        logger.info(f"Indexing {len(graph.edges)} graph edges...")
        for edge in graph.edges:
            cur.execute(
                """
                INSERT INTO kg_edges (source_id, target_id, relationship_type, weight, narrative_seq)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    edge.source_id,
                    edge.target_id,
                    edge.relationship_type,
                    edge.weight,
                    edge.narrative_seq,
                ),
            )

        conn.commit()
        conn.close()

        size_kb = round(os.path.getsize(str(p)) / 1024, 2)
        logger.info(f"✅ Successfully compiled database: {p} ({size_kb} KB)")
        return str(p)

    def upload_to_r2(self, local_db_path: str, book_id: str) -> str:
        """Uploads the compiled SQLite database snapshot to Cloudflare R2 lake."""
        out_key = f"compiled/{book_id}/book.db"
        logger.info(f"Uploading SQLite snapshot to R2: {out_key}...")
        self.r2.upload_file(local_db_path, out_key, content_type="application/vnd.sqlite3")
        logger.info(f"✅ Snapshot stored in R2: {out_key}")
        return out_key
