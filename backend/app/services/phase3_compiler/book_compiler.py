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
        # 1. Try name_in_scene against alias map
        if name_in_scene:
            k = name_in_scene.lower().strip()
            if k in self.alias_map:
                return self.alias_map[k]

        # 2. Try entity_id against alias map
        if entity_id:
            k = entity_id.lower().strip()
            if k in self.alias_map:
                return self.alias_map[k]
            # Strip char_ prefix and test
            if k.startswith("char_"):
                sub = k[5:]
                if sub in self.alias_map:
                    return self.alias_map[sub]
            return entity_id

        # 3. Fallback normalized from name
        if name_in_scene:
            norm = re.sub(r"[^a-z0-9_]+", "_", name_in_scene.lower().strip()).strip("_")
            return norm if norm.startswith("char_") else f"char_{norm}"

        return "char_unknown"

    # -----------------------------------------------------------------------
    # Subtask 3.3: Hierarchical Location Tree with Cycle Detection (EC-3.3)
    # -----------------------------------------------------------------------
    def _build_location_tree(self, observations: List[ChapterObservation]) -> None:
        """
        Constructs location hierarchy, detects cycles, and calculates materialized paths.
        """
        parent_map: Dict[str, Optional[str]] = {}
        names_map: Dict[str, str] = {}
        env_tags_map: Dict[str, Set[str]] = {}

        for obs in observations:
            # From scene settings
            for sc in obs.scenes:
                loc_id = sc.setting.location_id
                names_map[loc_id] = sc.setting.location_name
                env_tags_map.setdefault(loc_id, set())

            # From location clues
            for clue in obs.location_clues:
                if clue.parent_hint:
                    parent_norm = f"loc_{re.sub(r'[^a-z0-9_]+', '_', clue.parent_hint.lower()).strip('_')}"
                    names_map.setdefault(parent_norm, clue.parent_hint)
                    # Link to first scene location in chapter if available
                    if obs.scenes:
                        child_loc = obs.scenes[0].setting.location_id
                        if child_loc != parent_norm:
                            parent_map[child_loc] = parent_norm

                for tag in clue.environment_tags:
                    for sc in obs.scenes:
                        env_tags_map.setdefault(sc.setting.location_id, set()).add(tag)

        # Detect cycles and build materialized paths (EC-3.3)
        for loc_id, loc_name in names_map.items():
            path_segments = [loc_name]
            curr = loc_id
            visited = {curr}

            while curr in parent_map and parent_map[curr]:
                p = parent_map[curr]
                if p in visited:
                    # Spatial cycle detected! Break cycle cleanly
                    logger.warning(f"Cycle detected in location hierarchy at {p} -> {curr}. Pruning cycle.")
                    parent_map[curr] = None
                    break
                visited.add(p)
                p_name = names_map.get(p, p)
                path_segments.append(p_name)
                curr = p

            materialized_path = "/" + "/".join(
                re.sub(r"[^a-zA-Z0-9_-]+", "_", seg.lower()).strip("_") for seg in reversed(path_segments)
            )

            self.locations[loc_id] = CompiledLocation(
                location_id=loc_id,
                canonical_name=loc_name,
                parent_location_id=parent_map.get(loc_id),
                materialized_path=materialized_path,
                environment_tags=sorted(list(env_tags_map.get(loc_id, set()))),
            )

    # -----------------------------------------------------------------------
    # Subtask 3.2 & 3.4: Dual Timelines & Carry-Forward State Machine
    # -----------------------------------------------------------------------
    def _build_timelines_and_states(self, observations: List[ChapterObservation]) -> int:
        """
        Builds dual timelines (narrative_seq vs story_time_tick) and runs the carry-forward
        state machine with flashback isolation (EC-3.1) and time-skip staleness (EC-3.4).
        Returns total visual beats count.
        """
        narrative_seq = 1
        current_present_tick = 1000
        total_beats = 0

        # State storage: entity_id -> {story_tick: EntityStateSnapshot}
        # and latest present-day state: entity_id -> EntityStateSnapshot
        latest_present_state: Dict[str, EntityStateSnapshot] = {}

        for obs in observations:
            for sc in obs.scenes:
                time_type = sc.time_clue.time_type if sc.time_clue else TimeClueType.PRESENT
                delta_hint = sc.time_clue.delta_hint if sc.time_clue else None

                # Compute story_time_tick (Subtask 3.2)
                if time_type == TimeClueType.PRESENT:
                    story_tick = current_present_tick
                    current_present_tick += 1000
                elif time_type == TimeClueType.TIME_SKIP:
                    story_tick = current_present_tick + 5000
                    current_present_tick = story_tick + 1000
                elif time_type == TimeClueType.FLASHBACK:
                    # Flashback occurs in historical tick space (< current_present_tick)
                    story_tick = max(100, current_present_tick - 50000)
                else:  # DREAM or PARALLEL_POV
                    story_tick = current_present_tick
                    current_present_tick += 1000

                active_chars = []
                for ch in sc.characters_present:
                    c_id = self.resolve_entity_id(entity_id=ch.entity_id, name_in_scene=ch.name_in_scene)
                    active_chars.append(c_id)

                active_items = []
                for item in sc.items_interacted:
                    active_items.append(item.item_id)

                tick_entry = CompiledTimelineTick(
                    narrative_seq=narrative_seq,
                    story_time_tick=story_tick,
                    chapter_index=obs.chapter_index,
                    scene_id=sc.scene_id,
                    time_type=time_type,
                    time_delta_hint=delta_hint,
                    location_id=sc.setting.location_id,
                    active_characters=active_chars,
                    active_items=active_items,
                )
                self.timeline.append(tick_entry)
                total_beats += len(sc.key_visual_beats)

                # State Machine Propagation (Subtask 3.4)
                is_time_skip = time_type == TimeClueType.TIME_SKIP
                is_flashback = time_type == TimeClueType.FLASHBACK

                for ch in sc.characters_present:
                    c_id = self.resolve_entity_id(entity_id=ch.entity_id, name_in_scene=ch.name_in_scene)
                    prev_state = latest_present_state.get(c_id)

                    # Carry-Forward Logic:
                    outfit = ch.clothing_mention
                    injuries = [ch.visual_changes] if ch.visual_changes else []
                    items_held = [
                        it.item_id
                        for it in sc.items_interacted
                        if it.held_by_entity_id and self.resolve_entity_id(entity_id=it.held_by_entity_id) == c_id
                    ]

                    is_stale = False
                    if not outfit:
                        if prev_state and not is_time_skip and not is_flashback:
                            outfit = prev_state.outfit
                        elif is_time_skip:
                            # EC-3.4: Time-skip marks ephemeral outfits as stale
                            is_stale = True

                    if not injuries and prev_state and not is_flashback:
                        injuries = list(prev_state.injuries)

                    snapshot = EntityStateSnapshot(
                        story_tick=story_tick,
                        narrative_seq=narrative_seq,
                        scene_id=sc.scene_id,
                        outfit=outfit,
                        physical_condition=ch.emotional_state or ch.action,
                        injuries=injuries,
                        items_held=items_held,
                        is_stale=is_stale,
                    )

                    if c_id in self.entities:
                        self.entities[c_id].state_history.append(snapshot)

                    # EC-3.1: Flashbacks DO NOT overwrite the present-day state!
                    if not is_flashback:
                        latest_present_state[c_id] = snapshot

                narrative_seq += 1

        return total_beats

    # -----------------------------------------------------------------------
    # Subtask 3.5: Composite Importance Scorer & Visual Tiering
    # -----------------------------------------------------------------------
    def _build_graph_edges(self, observations: List[ChapterObservation]) -> None:
        """Compiles knowledge graph edges for co-occurrence and item possession."""
        co_occur: Dict[Tuple[str, str], int] = {}

        for sc in self.timeline:
            chars = sc.active_characters
            # Character co-occurrence edges
            for i in range(len(chars)):
                for j in range(i + 1, len(chars)):
                    pair = (min(chars[i], chars[j]), max(chars[i], chars[j]))
                    co_occur[pair] = co_occur.get(pair, 0) + 1

            # Character - Location edges
            for c in chars:
                pair = (c, sc.location_id)
                co_occur[pair] = co_occur.get(pair, 0) + 1

        for (src, tgt), count in co_occur.items():
            self.edges.append(
                CompiledGraphEdge(
                    source_id=src,
                    target_id=tgt,
                    relationship_type="CO_OCCURS_WITH",
                    weight=float(count),
                )
            )

    def _score_entities(self, total_scenes: int) -> None:
        """
        Applies composite importance scoring formula:
        Score = 0.35 * Presence + 0.25 * Agency + 0.25 * Centrality + 0.15 * DetailDensity
        Categorizes entities into Tier 1 (Core), Tier 2 (Supporting), and Tier 3 (Extras).
        """
        if total_scenes == 0:
            return

        # 1. Calculate degree centrality from graph edges
        degree_map: Dict[str, int] = {}
        for edge in self.edges:
            degree_map[edge.source_id] = degree_map.get(edge.source_id, 0) + 1
            degree_map[edge.target_id] = degree_map.get(edge.target_id, 0) + 1
        max_degree = max(degree_map.values()) if degree_map else 1

        PASSIVE_KEYWORDS = {"watching", "sleeping", "waiting", "standing quietly", "passive", "unconscious", "listening", "quietly"}

        # 2. Score each entity
        for ent_id, ent in self.entities.items():
            scenes_present = len(ent.state_history)
            presence = min(1.0, scenes_present / total_scenes)

            # Agency: scenes where active physical action or items held, not passive
            active_scenes = sum(
                1 for s in ent.state_history
                if s.items_held or (
                    s.physical_condition
                    and not any(pk in s.physical_condition.lower() for pk in PASSIVE_KEYWORDS)
                )
            )
            agency = (active_scenes / scenes_present) if scenes_present > 0 else 0.0

            # Centrality
            centrality = (degree_map.get(ent_id, 0) / max_degree) if max_degree > 0 else 0.0

            # DetailDensity: length of static traits + aliases richness
            trait_len = len(ent.static_traits) + sum(len(a) for a in ent.aliases)
            detail_density = min(1.0, trait_len / 200.0)

            composite = (0.35 * presence) + (0.25 * agency) + (0.25 * centrality) + (0.15 * detail_density)
            composite = round(min(1.0, max(0.0, composite)), 4)

            # Tiering:
            # Score >= 0.50 -> TIER_1_CORE
            # 0.25 <= Score < 0.50 -> TIER_2_SUPPORTING
            # Score < 0.25 -> TIER_3_EXTRAS
            if composite >= 0.50:
                tier = EntityVisualTier.TIER_1_CORE
            elif composite >= 0.25:
                tier = EntityVisualTier.TIER_2_SUPPORTING
            else:
                tier = EntityVisualTier.TIER_3_EXTRAS

            ent.importance_score = composite
            ent.presence_score = round(presence, 4)
            ent.agency_score = round(agency, 4)
            ent.centrality_score = round(centrality, 4)
            ent.detail_density = round(detail_density, 4)
            ent.visual_tier = tier
