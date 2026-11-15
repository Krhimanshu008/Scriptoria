# SPRINT 3 CONTEXT SLICE: TAB 3 (GRAPH & TIMELINE STUDIO)
## Target: Chief AI Architect (Gemini 4 Hydrogen / Argon) via Google AI Studio

### Project Context:
- Public Repository: https://github.com/Krhimanshu008/Scriptoria.git
- Active Contract Hash: `08e0a0b8a38adab857ec8d2c933dfd88fbbed1e0036ff675f0a18b165f036292`
- Sprints 1 & 2 100% verified (17/17 pytest passing, zero contract drift, tsc clean).

### SPRINT 3 OBJECTIVES:
1. **Workstream 3A: Stage-2 Compiler Contracts (`backend/app/schemas/compiler_contracts.py`)**
   - `StrictModel` (`ConfigDict(extra='forbid', frozen=True)`).
   - `CompiledEntitySummary`: entity_id, canonical_name, aliases, entity_type, visual_tier ('TIER_1_CORE', 'TIER_2', 'TIER_3'), importance_score, base_anatomy, first_seen_chapter.
   - `CompiledLocationSummary`: location_id, canonical_name, parent_location_id, materialized_path, environment_tags.
   - `TimelineTickSummary`: tick_index, narrative_seq, story_time_tick, chapter_index, scene_id, time_type, is_flashback (EC-3.1), location_id, characters_present, summary.
   - `GraphEdgeSummary`: source_id, target_id, edge_type, weight, bidirectional.
   - `CompiledBookGraphResponse`: ok, trace_id, book_id, total_chapters, total_scenes, total_beats, entities dict, locations dict, timeline list, edges list, has_cycles_detected, cycle_break_count.
   - `CompileBookRequest`: book_id, observations list or None (for dry-run demo compile).

2. **Workstream 3B: FastAPI Compiler Router (`backend/app/routers/graph_studio.py`)**
   - Prefix: `/compiler`
   - `POST /api/v1/compiler/compile`: Deterministic Stage-2 compiler execution with alias resolution, cycle-free location hierarchy, dual-timeline with flashback isolation, and importance scoring.
   - `GET /api/v1/compiler/graph/{book_id}`: Returns complete compiled graph.
   - `GET /api/v1/compiler/timeline/{book_id}`: Returns timeline events.
   - `GET /api/v1/compiler/characters/{book_id}`: Returns character tier matrix.
   - `GET /api/v1/compiler/locations/{book_id}`: Returns location tree.

### EXISTING CODE REFERENCES:
#### `backend/app/services/phase3_compiler/book_compiler.py` (Excerpts)
```python
"""
Stage-2 Book Compiler Engine (v1.0.0) for Scriptoria.
Compiles raw ChapterObservations into a unified, queryable temporal knowledge graph:
1. Alias & Entity Resolution (fuzzy & canonical alias index)
2. Dual Timeline Builder (narrative_seq vs story_time_tick)
3. Hierarchical Location Tree (parent links, materialized paths, cycle detection)
4. Carry-Forward State Machine (chronological propagation, flashback isolation, time-skip staleness)
5. Composite Importance Scorer (Presence, Agency, Centrality, DetailDensity) & Visual Tiering
"""

from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional, Set, Tuple, Any

from backend.app.models.canonical_protocol import (
    ChapterObservation,
    SceneObservation,
    EntityObservation,
    EntityType,
    EntityVisualTier,
    EntityStateSnapshot,
    CompiledEntity,
    CompiledLocation,
    CompiledTimelineTick,
    CompiledGraphEdge,
    CompiledBookGraph,
    TimeClueType,
)
from backend.app.services.phase1_core.tick_calculator import BiTemporalTickCalculator

logger = logging.getLogger("Scriptoria.BookCompiler")


class Stage2BookCompiler:
    """
    CPU-based deterministic compiler that transforms extracted chapter observations
    into a queryable, temporally accurate CompiledBookGraph.
    """

    def __init__(self, book_id: str):
        self.book_id = book_id
        self.alias_map: Dict[str, str] = {}  # alias/name (lowercase) -> canonical entity_id
        self.entities: Dict[str, CompiledEntity] = {}
        self.locations: Dict[str, CompiledLocation] = {}
        self.timeline: List[CompiledTimelineTick] = []
        self.edges: List[CompiledGraphEdge] = []

    def compile(self, observations: List[ChapterObservation]) -> CompiledBookGraph:
        """Runs full compilation pipeline across all chapter observations."""
        sorted_obs = sorted(observations, key=lambda o: o.chapter_index)

        # 1. First Pass: Resolve entities & build canonical alias index (Subtask 3.1)
        self._resolve_entities(sorted_obs)

        # 2. Build Hierarchical Location Tree with Cycle Detection (Subtask 3.3)
        self._build_location_tree(sorted_obs)

        # 3. Build Dual Timelines & Carry-Forward State Machine (Subtask 3.2 & 3.4)
        total_beats = self._build_timelines_and_states(sorted_obs)

        # 4. Compute Graph Edges & Co-occurrences
        self._build_graph_edges(sorted_obs)

        # 5. Calculate Composite Importance Scores & Assign Visual Tiers (Subtask 3.5)
        total_scenes = len(self.timeline)
        self._score_entities(total_scenes)

        total_chapters = len(sorted_obs)
        return CompiledBookGraph(
            schema_version="1.0.0",
            book_id=self.book_id,
            total_chapters=total_chapters,
            total_scenes=total_scenes,
            total_beats=total_beats,
            timeline=self.timeline,
            entities=self.entities,
            locations=self.locations,
            edges=self.edges,
        )

    # -----------------------------------------------------------------------
    # Subtask 3.1: Alias & Entity Resolution Engine
    # -----------------------------------------------------------------------
    def _resolve_entities(self, observations: List[ChapterObservation]) -> None:
        """
        Builds the canonical entity registry and maps all aliases (including late reveals)
        to unified canonical entity IDs (EC-3.2).
        """
        for obs in observations:
            for ent in obs.discovered_entities:
                canonical_id = ent.entity_id

                if canonical_id not in self.entities:
                    self.entities[canonical_id] = CompiledEntity(
                        entity_id=canonical_id,
                        canonical_name=ent.canonical_name,
                        aliases=list(ent.aliases),
                        entity_type=ent.entity_type,
                        static_traits=ent.static_traits,
                        visual_tier=EntityVisualTier.TIER_3_EXTRAS,
                        importance_score=0.0,
                    )
                else:
                    # Merge new aliases cleanly
                    existing = self.entities[canonical_id]
                    all_aliases = list(dict.fromkeys(existing.aliases + ent.aliases))
                    existing.aliases = all_aliases
                    if len(ent.static_traits) > len(existing.static_traits):
                        existing.static_traits = ent.static_traits

                # Register all names and aliases in the lookup map
                self.alias_map[ent.canonical_name.lower().strip()] = canonical_id
                self.alias_map[canonical_id.lower().strip()] = canonical_id
                for alias in ent.aliases:
                    self.alias_map[alias.lower().strip()] = canonical_id

    def resolve_entity_id(self, entity_id: Optional[str] = None, name_in_scene: Optional[str] = None) -> str:
        """Resolves an entity_id or raw name in scene to its canonical entity_id."""
```
