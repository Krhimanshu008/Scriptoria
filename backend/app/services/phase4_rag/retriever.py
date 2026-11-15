"""
Typed Agentic Retrieval Tools (v1.0.0) for Scriptoria Hybrid RAG.
Exposes the 4 core retrieval capabilities:
1. query_timeline_state(character_ids, tick, ...) -> Temporal state snapshots with Spoiler Shield
2. hybrid_search_prose(query, max_narrative_seq, ...) -> Vector + BM25 FTS5 Reciprocal Rank Fusion
3. traverse_knowledge_graph(entity_id, max_hops, ...) -> Multi-hop graph expansion & item custody
4. fetch_r2_verbatim(r2_key, ...) -> Zero-hallucination source text retrieval from R2
"""

from __future__ import annotations

import json
import sqlite3
import re
from typing import List, Dict, Any, Optional, Set

from backend.app.services.phase4_rag.embeddings import SemanticEmbeddingService
from backend.app.services.r2_storage import R2StorageService


class ScriptoriaRAGRetriever:
    """
    Executes high-precision hybrid semantic + BM25 keyword search,
    spoiler-shielded timeline queries, and multi-hop graph traversals.
    """

    def __init__(
        self,
        db_path: str,
        embedder: Optional[SemanticEmbeddingService] = None,
        r2: Optional[R2StorageService] = None,
    ):
        self.db_path = db_path
        self.embedder = embedder or SemanticEmbeddingService()
        self.r2 = r2 or R2StorageService()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    # -----------------------------------------------------------------------
    # Tool 1: query_timeline_state
    # -----------------------------------------------------------------------
    def query_timeline_state(
        self,
        character_ids: List[str],
        at_tick: int,
        by_story_time: bool = False,
        max_narrative_seq: Optional[int] = None,
    ) -> Dict[str, Optional[Dict[str, Any]]]:
        """
        Retrieves the exact physical and cosmetic state of characters at or before at_tick.
        Enforces EC-4.2 (Spoiler Shield): strictly ignores any records beyond max_narrative_seq.
        """
        conn = self._get_connection()
        cur = conn.cursor()

        results: Dict[str, Optional[Dict[str, Any]]] = {}
        tick_col = "story_time_tick" if by_story_time else "narrative_seq"

        for cid in character_ids:
            query = f"""
                SELECT state_id, node_id, narrative_seq, story_time_tick, scene_id,
                       outfit, physical_condition, injuries_json, items_held_json, is_stale
                FROM kg_states
                WHERE node_id = ? AND {tick_col} <= ?
            """
            params: List[Any] = [cid, at_tick]

            # Enforce spoiler shield (EC-4.2)
            if max_narrative_seq is not None:
                query += " AND narrative_seq <= ?"
                params.append(max_narrative_seq)

            query += f" ORDER BY {tick_col} DESC, narrative_seq DESC LIMIT 1"

            cur.execute(query, params)
            row = cur.fetchone()

            if row:
                results[cid] = {
                    "node_id": row["node_id"],
                    "narrative_seq": row["narrative_seq"],
                    "story_time_tick": row["story_time_tick"],
                    "scene_id": row["scene_id"],
                    "outfit": row["outfit"],
                    "physical_condition": row["physical_condition"],
                    "injuries": json.loads(row["injuries_json"]) if row["injuries_json"] else [],
                    "items_held": json.loads(row["items_held_json"]) if row["items_held_json"] else [],
                    "is_stale": bool(row["is_stale"]),
                }
            else:
                results[cid] = None

        conn.close()
        return results

    # -----------------------------------------------------------------------
    # Tool 2: hybrid_search_prose
    # -----------------------------------------------------------------------
    def hybrid_search_prose(
        self,
        query: str,
        max_narrative_seq: int,
        top_k: int = 5,
        vector_weight: float = 0.5,
    ) -> List[Dict[str, Any]]:
        """
        Combines BM25 FTS5 full-text keyword search with 768-dim vector cosine similarity
        via Reciprocal Rank Fusion (RRF).
        Strictly enforces the Spoiler Shield (EC-4.2) where narrative_seq <= max_narrative_seq.
        """
        conn = self._get_connection()
        cur = conn.cursor()

        # Step A: FTS5 BM25 Search
        # Robust sanitization for SQLite FTS5: strip punctuation and wrap each token in quotes
        raw_words = [re.sub(r"[^a-zA-Z0-9_\u0080-\uffff]", "", w) for w in query.split()]
        valid_words = [f'"{w}"' for w in raw_words if len(w) > 1]
        fts_term = " OR ".join(valid_words) if valid_words else ""

        bm25_ranks: Dict[str, int] = {}
        if fts_term:
            try:
                fts_sql = """
                    SELECT c.chunk_id, rank
                    FROM rag_chunks_fts f
                    JOIN rag_chunks c ON f.chunk_id = c.chunk_id
                    WHERE rag_chunks_fts MATCH ? AND c.narrative_seq <= ?
                    ORDER BY rank ASC
                    LIMIT 30
                """
                cur.execute(fts_sql, (fts_term, max_narrative_seq))
                for idx, row in enumerate(cur.fetchall()):
                    bm25_ranks[row["chunk_id"]] = idx + 1
            except sqlite3.OperationalError:
                # Fallback if query syntax error
                pass

        # Step B: Vector Semantic Search
        query_vec = self.embedder.embed_text(query)

        cur.execute(
            """
            SELECT chunk_id, narrative_seq, story_time_tick, chapter_index,
                   scene_id, beat_order, content, quote_anchor, shot_suggestion, embedding_json
            FROM rag_chunks
            WHERE narrative_seq <= ?
            """,
            (max_narrative_seq,),
        )
        candidate_rows = cur.fetchall()

        vector_scores = []
        for row in candidate_rows:
            chunk_vec = json.loads(row["embedding_json"])
            sim = self.embedder.cosine_similarity(query_vec, chunk_vec)
            vector_scores.append((row["chunk_id"], sim, row))

        # Sort vector candidates descending by similarity
        vector_scores.sort(key=lambda x: x[1], reverse=True)
        vector_ranks: Dict[str, int] = {
            item[0]: idx + 1 for idx, item in enumerate(vector_scores[:30])
        }

        # Step C: Reciprocal Rank Fusion (RRF)
        # RRF_Score = (1 - w) / (60 + rank_bm25) + w / (60 + rank_vec)
        all_candidate_ids = set(bm25_ranks.keys()) | set(vector_ranks.keys())
        rrf_scores: List[Tuple[str, float, Any]] = []

        row_map = {item[0]: item[2] for item in vector_scores}

        bm25_weight = 1.0 - vector_weight
        for cid in all_candidate_ids:
            score = 0.0
            if cid in bm25_ranks:
                score += bm25_weight / (60.0 + bm25_ranks[cid])
            if cid in vector_ranks:
                score += vector_weight / (60.0 + vector_ranks[cid])

            row_data = row_map.get(cid)
            if row_data:
                rrf_scores.append((cid, score, row_data))

        rrf_scores.sort(key=lambda x: x[1], reverse=True)

        final_results = []
        for cid, rrf_score, r in rrf_scores[:top_k]:
            final_results.append(
                {
                    "chunk_id": r["chunk_id"],
                    "narrative_seq": r["narrative_seq"],
                    "story_time_tick": r["story_time_tick"],
                    "chapter_index": r["chapter_index"],
                    "scene_id": r["scene_id"],
                    "beat_order": r["beat_order"],
                    "quote_anchor": r["quote_anchor"],
                    "shot_suggestion": r["shot_suggestion"],
                    "content": r["content"],
                    "rrf_score": round(rrf_score, 6),
                    "bm25_rank": bm25_ranks.get(cid),
                    "vector_rank": vector_ranks.get(cid),
                }
            )

        conn.close()
        return final_results

    # -----------------------------------------------------------------------
    # Tool 3: traverse_knowledge_graph
    # -----------------------------------------------------------------------
    def traverse_knowledge_graph(
        self,
        entity_id: str,
        max_hops: int = 2,
        max_narrative_seq: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Traverses relationships from entity_id up to max_hops with spoiler filtering (EC-4.3).
        Retrieves visited entities, edge relationships, and current states.
        """
        conn = self._get_connection()
        cur = conn.cursor()

        visited_nodes: Set[str] = {entity_id}
        frontier: Set[str] = {entity_id}
        edges_found: List[Dict[str, Any]] = []

        for _ in range(max_hops):
            if not frontier:
                break
            placeholders = ",".join("?" for _ in frontier)
            params: List[Any] = list(frontier) + list(frontier)

            sql = f"""
                SELECT edge_id, source_id, target_id, relationship_type, weight, narrative_seq
                FROM kg_edges
                WHERE (source_id IN ({placeholders}) OR target_id IN ({placeholders}))
            """
            if max_narrative_seq is not None:
                sql += " AND (narrative_seq IS NULL OR narrative_seq <= ?)"
                params.append(max_narrative_seq)

            cur.execute(sql, params)
            next_frontier: Set[str] = set()

            for r in cur.fetchall():
                src = r["source_id"]
                tgt = r["target_id"]
                edges_found.append(
                    {
                        "source_id": src,
                        "target_id": tgt,
                        "relationship_type": r["relationship_type"],
                        "weight": r["weight"],
                        "narrative_seq": r["narrative_seq"],
                    }
                )
                for neighbor in (src, tgt):
                    if neighbor not in visited_nodes:
                        visited_nodes.add(neighbor)
                        next_frontier.add(neighbor)

            frontier = next_frontier

        # Fetch node details for all visited nodes
        node_details: Dict[str, Any] = {}
        if visited_nodes:
            ph = ",".join("?" for _ in visited_nodes)
            cur.execute(
                f"""
                SELECT node_id, canonical_name, aliases_json, category, static_traits, visual_tier, importance_score
                FROM kg_nodes
                WHERE node_id IN ({ph})
                """,
                list(visited_nodes),
            )
            for r in cur.fetchall():
                node_details[r["node_id"]] = {
                    "node_id": r["node_id"],
                    "canonical_name": r["canonical_name"],
                    "aliases": json.loads(r["aliases_json"]),
                    "category": r["category"],
                    "static_traits": r["static_traits"],
                    "visual_tier": r["visual_tier"],
                    "importance_score": r["importance_score"],
                }

            # Also check kg_locations for any visited location nodes
            missing_ids = visited_nodes - set(node_details.keys())
            if missing_ids:
                ph_loc = ",".join("?" for _ in missing_ids)
                cur.execute(
                    f"""
                    SELECT location_id, canonical_name, materialized_path, environment_tags_json
                    FROM kg_locations
                    WHERE location_id IN ({ph_loc})
                    """,
                    list(missing_ids),
                )
                for r in cur.fetchall():
                    node_details[r["location_id"]] = {
                        "node_id": r["location_id"],
                        "canonical_name": r["canonical_name"],
                        "aliases": [],
                        "category": "LOCATION",
                        "static_traits": r["materialized_path"],
                        "visual_tier": "LOCATION",
                        "importance_score": 1.0,
                    }

        conn.close()
        return {
            "root_entity_id": entity_id,
            "visited_entities": node_details,
            "edges": edges_found,
            "total_hops_expanded": max_hops,
        }

    # -----------------------------------------------------------------------
    # Tool 4: fetch_r2_verbatim
    # -----------------------------------------------------------------------
    def fetch_r2_verbatim(
        self,
        r2_key: str,
        start_char: Optional[int] = None,
        end_char: Optional[int] = None,
    ) -> str:
        """
        Retrieves verbatim source prose directly from Cloudflare R2 lake.
        Guarantees zero-hallucination ground truth.
        """
        full_text = self.r2.get_text(r2_key)
        if start_char is not None and end_char is not None:
            return full_text[start_char:end_char]
        elif start_char is not None:
            return full_text[start_char:]
        elif end_char is not None:
            return full_text[:end_char]
        return full_text
