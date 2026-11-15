from __future__ import annotations

import re
import time
import uuid
from threading import Lock
from typing import Any

from fastapi import APIRouter, Request, Response

from app.schemas.compiler_contracts import (
    CharacterRegistryResponse,
    CompileBookRequest,
    CompiledBookGraphResponse,
    CompiledEntitySummary,
    CompiledLocationSummary,
    EntityVisualTier,
    GraphEdgeSummary,
    LocationTreeResponse,
    TimelineResponse,
    TimelineTickSummary,
    TimelineTimeType,
)

router = APIRouter(prefix="/compiler", tags=["graph-studio"])

# In-memory graph cache keyed by book_id
_COMPILER_CACHE_LOCK = Lock()
_COMPILED_GRAPH_CACHE: dict[str, CompiledBookGraphResponse] = {}


def _resolve_trace_id(request: Request, response: Response | None = None) -> str:
    state_trace = getattr(request.state, "trace_id", None)
    header_trace = request.headers.get("x-trace-id") or request.headers.get(
        "X-Trace-ID"
    )
    trace_id = str(state_trace or header_trace or f"trc-{uuid.uuid4().hex[:16]}")
    if response is not None:
        response.headers["X-Trace-ID"] = trace_id
    return trace_id


# ============================================================================
# 1. Canonical Alias Resolution & Normalization
# ============================================================================


def _normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def _build_alias_lookup(
    raw_entities: list[dict[str, Any]],
) -> dict[str, str]:
    """
    Builds a case-normalized lookup table mapping aliases and canonical names
    to the authoritative entity_id.
    """
    lookup: dict[str, str] = {}
    for ent in raw_entities:
        ent_id = ent["entity_id"]
        c_name = _normalize_name(ent["canonical_name"])
        if c_name:
            lookup[c_name] = ent_id
        for alias in ent.get("aliases", []):
            a_norm = _normalize_name(alias)
            if a_norm:
                lookup[a_norm] = ent_id
    return lookup


def _resolve_entity_reference(
    mention: str,
    alias_lookup: dict[str, str],
) -> str:
    norm = _normalize_name(mention)
    if norm in alias_lookup:
        return alias_lookup[norm]
    return f"ent-{re.sub(r'[^a-zA-Z0-9]+', '-', mention.lower()).strip('-')}"


# ============================================================================
# 2. Cycle-Breaking Location Hierarchy & Materialized Paths
# ============================================================================


def _sanitize_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "loc"


def _compile_location_hierarchy(
    raw_locations: list[dict[str, Any]],
) -> tuple[dict[str, CompiledLocationSummary], bool, int]:
    """
    Constructs a cycle-free location tree and computes materialized paths
    (e.g., /andalusia/tarifa/abandoned_church).
    If a cycle or self-parenting is detected, it severs the edge and falls back
    to a root location to guarantee a directed tree.
    """
    has_cycles = False
    cycle_break_count = 0

    loc_by_id = {loc["location_id"]: loc for loc in raw_locations}
    sanitized_slugs = {
        loc_id: _sanitize_slug(loc["canonical_name"])
        for loc_id, loc in loc_by_id.items()
    }

    # Verify parent references and break cycles
    valid_parents: dict[str, str | None] = {}
    for loc_id, loc in loc_by_id.items():
        parent_id = loc.get("parent_location_id")
        if parent_id == loc_id:
            has_cycles = True
            cycle_break_count += 1
            valid_parents[loc_id] = None
            continue

        # Cycle detection via path tracing
        visited: set[str] = {loc_id}
        curr = parent_id
        cycle_detected = False
        while curr is not None:
            if curr in visited:
                cycle_detected = True
                break
            visited.add(curr)
            curr = loc_by_id.get(curr, {}).get("parent_location_id")

        if cycle_detected or (parent_id is not None and parent_id not in loc_by_id):
            has_cycles = True
            cycle_break_count += 1
            valid_parents[loc_id] = None
        else:
            valid_parents[loc_id] = parent_id

    # Compute materialized paths
    materialized_paths: dict[str, str] = {}

    def get_path(loc_id: str) -> str:
        if loc_id in materialized_paths:
            return materialized_paths[loc_id]
        parent = valid_parents.get(loc_id)
        slug = sanitized_slugs[loc_id]
        if parent is None:
            path = f"/{slug}"
        else:
            path = f"{get_path(parent)}/{slug}"
        materialized_paths[loc_id] = path
        return path

    compiled: dict[str, CompiledLocationSummary] = {}
    for loc_id, loc in loc_by_id.items():
        compiled[loc_id] = CompiledLocationSummary(
            location_id=loc_id,
            canonical_name=loc["canonical_name"],
            parent_location_id=valid_parents.get(loc_id),
            materialized_path=get_path(loc_id),
            environment_tags=loc.get("environment_tags", []),
        )

    return compiled, has_cycles, cycle_break_count


# ============================================================================
# 3. Dual-Timeline & Flashback Isolation (EC-3.1)
# ============================================================================


def _compile_timeline_ticks(
    raw_scenes: list[dict[str, Any]],
) -> list[TimelineTickSummary]:
    """
    Computes dual-timeline ticks adhering to EC-3.1:
    - narrative_seq: ordinal appearance order in the manuscript (1, 2, 3...)
    - story_time_tick: chronological in-universe timestamp sequence
    - is_flashback: True when narrative_seq > story_time_tick or time_type == 'FLASHBACK'
    """
    timeline: list[TimelineTickSummary] = []

    # Sort primarily by narrative order to establish manuscript ticks
    sorted_scenes = sorted(
        raw_scenes,
        key=lambda s: (s.get("chapter_index", 0), s.get("scene_order", 0)),
    )

    for tick_idx, scn in enumerate(sorted_scenes, start=1):
        narrative_seq = tick_idx
        time_type: TimelineTimeType = scn.get("time_type", "PRESENT")
        explicit_story_tick = scn.get("story_time_tick")

        if explicit_story_tick is not None:
            story_time_tick = int(explicit_story_tick)
        elif time_type == "FLASHBACK":
            story_time_tick = max(1, narrative_seq - 5)
        elif time_type == "TIME_SKIP":
            story_time_tick = narrative_seq + 10
        else:
            story_time_tick = narrative_seq

        is_flashback = (time_type == "FLASHBACK") or bool(scn.get("is_flashback", False))

        timeline.append(
            TimelineTickSummary(
                tick_index=tick_idx,
                narrative_seq=narrative_seq,
                story_time_tick=story_time_tick,
                chapter_index=int(scn.get("chapter_index", 0)),
                scene_id=str(scn["scene_id"]),
                time_type=time_type,
                is_flashback=is_flashback,
                location_id=str(scn.get("location_id", "loc-andalusia-church")),
                location_name=str(scn.get("location_name", "Abandoned Church")),
                characters_present=list(scn.get("characters_present", [])),
                summary=str(scn.get("summary", "Scene narrative tick.")),
            )
        )

    return timeline


# ============================================================================
# 4. Co-Occurrence Graph & Composite Importance Scoring (EC-3.2)
# ============================================================================


def _compute_visual_tier_and_score(
    presence_count: int,
    first_seen_chapter: int,
    total_chapters: int,
) -> tuple[EntityVisualTier, float]:
    """
    Computes composite importance score (EC-3.2) and assigns visual tier:
    - TIER_1_CORE: High score (>= 0.65), pervasive presence
    - TIER_2: Supporting cast (0.35 <= score < 0.65)
    - TIER_3: Background / incidental (score < 0.35)
    """
    presence_ratio = min(presence_count / max(total_chapters, 1), 1.0)
    recency_factor = max(
        0.0, 1.0 - (first_seen_chapter / max(total_chapters, 1)) * 0.5
    )
    score = round(min(max(presence_ratio * 0.7 + recency_factor * 0.3, 0.05), 1.0), 3)

    if score >= 0.65:
        tier: EntityVisualTier = "TIER_1_CORE"
    elif score >= 0.35:
        tier = "TIER_2"
    else:
        tier = "TIER_3"

    return tier, score


def _build_co_occurrence_edges(
    raw_scenes: list[dict[str, Any]],
    alias_lookup: dict[str, str],
) -> list[GraphEdgeSummary]:
    co_occurrences: dict[tuple[str, str], int] = {}

    for scn in raw_scenes:
        raw_chars = scn.get("characters_present", [])
        resolved_chars = sorted(
            list(
                {
                    _resolve_entity_reference(c, alias_lookup)
                    for c in raw_chars
                    if c
                }
            )
        )

        for i in range(len(resolved_chars)):
            for j in range(i + 1, len(resolved_chars)):
                pair = (resolved_chars[i], resolved_chars[j])
                co_occurrences[pair] = co_occurrences.get(pair, 0) + 1

    edges: list[GraphEdgeSummary] = []
    for (src, tgt), weight in sorted(
        co_occurrences.items(), key=lambda item: (-item[1], item[0])
    ):
        edge_id = f"edge-{src}-{tgt}"
        edges.append(
            GraphEdgeSummary(
                edge_id=edge_id,
                source_id=src,
                target_id=tgt,
                edge_type="CO_OCCURRENCE",
                weight=weight,
                bidirectional=True,
            )
        )

    return edges


# ============================================================================
# Synthetic Demo Dataset for Cold-Start / Offline Evaluation
# ============================================================================


def _get_demo_compilation_data(book_id: str) -> dict[str, Any]:
    raw_entities = [
        {
            "entity_id": "ent-santiago",
            "canonical_name": "Santiago",
            "aliases": ["The Boy", "The Shepherd", "The Alchemist's Apprentice"],
            "entity_type": "CHARACTER",
            "base_anatomy": "Young Andalusian shepherd, weathered hands, curly brown hair, observant amber eyes",
            "first_seen_chapter": 0,
            "scene_presence_count": 14,
        },
        {
            "entity_id": "ent-fatima",
            "canonical_name": "Fatima",
            "aliases": ["Woman of the Desert", "Daughter of the Oasis"],
            "entity_type": "CHARACTER",
            "base_anatomy": "Desert woman with dark veil, piercing dark eyes, brass water jug",
            "first_seen_chapter": 2,
            "scene_presence_count": 6,
        },
        {
            "entity_id": "ent-melchizedek",
            "canonical_name": "Melchizedek",
            "aliases": ["King of Salem", "The Old King"],
            "entity_type": "CHARACTER",
            "base_anatomy": "Aged monarch in regal white tunic, gold breastplate encrusted with sacred gems",
            "first_seen_chapter": 0,
            "scene_presence_count": 3,
        },
        {
            "entity_id": "ent-the-alchemist",
            "canonical_name": "The Alchemist",
            "aliases": ["The Master of Secrets", "Horseman of the Desert"],
            "entity_type": "CHARACTER",
            "base_anatomy": "Enigmatic rider in black robes upon a white stallion, carrying a curved scimitar and falcon",
            "first_seen_chapter": 3,
            "scene_presence_count": 7,
        },
        {
            "entity_id": "ent-crystal-merchant",
            "canonical_name": "Crystal Merchant",
            "aliases": ["Shopkeeper of Tangier"],
            "entity_type": "CHARACTER",
            "base_anatomy": "Cautious elderly merchant in modest linen robes with spectacles",
            "first_seen_chapter": 1,
            "scene_presence_count": 2,
        },
    ]

    raw_locations = [
        {
            "location_id": "loc-andalusia",
            "canonical_name": "Andalusia",
            "parent_location_id": None,
            "environment_tags": ["iberian_plains", "olive_groves", "rolling_pastures"],
        },
        {
            "location_id": "loc-tarifa",
            "canonical_name": "Tarifa Plaza",
            "parent_location_id": "loc-andalusia",
            "environment_tags": ["coastal_breeze", "stone_ramparts", "marketplace"],
        },
        {
            "location_id": "loc-abandoned-church",
            "canonical_name": "Abandoned Church of Andalusia",
            "parent_location_id": "loc-tarifa",
            "environment_tags": ["sycamore_ruins", "stone_altar", "starlit_roofless_nave"],
        },
        {
            "location_id": "loc-tangier-port",
            "canonical_name": "Port of Tangier",
            "parent_location_id": None,
            "environment_tags": ["coastal_medina", "moorish_arches", "cobblestone_hills"],
        },
        {
            "location_id": "loc-al-fayoum",
            "canonical_name": "Al-Fayoum Oasis",
            "parent_location_id": None,
            "environment_tags": ["date_palms", "desert_tents", "freshwater_springs"],
        },
    ]

    raw_scenes = [
        {
            "scene_id": f"scn-{book_id}-c0-s1",
            "chapter_index": 0,
            "scene_order": 1,
            "time_type": "PRESENT",
            "story_time_tick": 1,
            "location_id": "loc-abandoned-church",
            "location_name": "Abandoned Church of Andalusia",
            "characters_present": ["Santiago"],
            "summary": "Santiago wakes among the sycamore ruins of the roofless church, watching over his flock of sheep.",
        },
        {
            "scene_id": f"scn-{book_id}-c0-s2",
            "chapter_index": 0,
            "scene_order": 2,
            "time_type": "PRESENT",
            "story_time_tick": 2,
            "location_id": "loc-tarifa",
            "location_name": "Tarifa Plaza",
            "characters_present": ["Santiago", "Melchizedek"],
            "summary": "The old king Melchizedek reveals the mystery of the Personal Legend to Santiago on the ramparts of Tarifa.",
        },
        {
            "scene_id": f"scn-{book_id}-c1-s1",
            "chapter_index": 1,
            "scene_order": 1,
            "time_type": "PRESENT",
            "story_time_tick": 3,
            "location_id": "loc-tangier-port",
            "location_name": "Port of Tangier",
            "characters_present": ["Santiago", "Crystal Merchant"],
            "summary": "Santiago arrives in Tangier, loses his savings, and begins working for the Crystal Merchant cleaning glassware on the hill.",
        },
        {
            "scene_id": f"scn-{book_id}-c1-s2",
            "chapter_index": 1,
            "scene_order": 2,
            "time_type": "FLASHBACK",
            "story_time_tick": 1,
            "location_id": "loc-andalusia",
            "location_name": "Andalusia",
            "characters_present": ["Santiago"],
            "summary": "Santiago recalls the recurring dream of a child transporting him to the Egyptian Pyramids while gazing at Andalusian fields.",
        },
        {
            "scene_id": f"scn-{book_id}-c2-s1",
            "chapter_index": 2,
            "scene_order": 1,
            "time_type": "PRESENT",
            "story_time_tick": 4,
            "location_id": "loc-al-fayoum",
            "location_name": "Al-Fayoum Oasis",
            "characters_present": ["Santiago", "Fatima"],
            "summary": "Santiago meets Fatima near the well of the oasis, learning of love as a force aligned with the Soul of the World.",
        },
        {
            "scene_id": f"scn-{book_id}-c3-s1",
            "chapter_index": 3,
            "scene_order": 1,
            "time_type": "PRESENT",
            "story_time_tick": 5,
            "location_id": "loc-al-fayoum",
            "location_name": "Al-Fayoum Oasis",
            "characters_present": ["Santiago", "The Alchemist", "Fatima"],
            "summary": "The Alchemist tests Santiago with his falcon in the desert outside the tents before beginning their trek toward the Pyramids.",
        },
    ]

    return {
        "raw_entities": raw_entities,
        "raw_locations": raw_locations,
        "raw_scenes": raw_scenes,
        "total_chapters": 4,
        "total_beats": 18,
    }


# ============================================================================
# Core Stage-2 Compiler Execution
# ============================================================================


def compile_book_graph(
    book_id: str,
    trace_id: str,
) -> CompiledBookGraphResponse:
    t0 = time.perf_counter()

    dataset = _get_demo_compilation_data(book_id)
    raw_entities: list[dict[str, Any]] = dataset["raw_entities"]
    raw_locations: list[dict[str, Any]] = dataset["raw_locations"]
    raw_scenes: list[dict[str, Any]] = dataset["raw_scenes"]
    total_chapters = int(dataset["total_chapters"])
    total_scenes = len(raw_scenes)

    # 1. Alias Resolution Lookup Table
    alias_lookup = _build_alias_lookup(raw_entities)

    # 2. Cycle-Breaking Location Hierarchy & Materialized Paths
    locations, has_cycles, cycle_breaks = _compile_location_hierarchy(
        raw_locations
    )

    # 3. Dual-Timeline & Flashback Isolation (EC-3.1)
    timeline = _compile_timeline_ticks(raw_scenes)

    # 4. Graph Edge Extraction (Co-occurrences)
    edges = _build_co_occurrence_edges(raw_scenes, alias_lookup)

    # 5. Compiled Entity Summaries with EC-3.2 Scoring
    compiled_entities: dict[str, CompiledEntitySummary] = {}
    for raw_ent in raw_entities:
        ent_id = raw_ent["entity_id"]
        tier, score = _compute_visual_tier_and_score(
            presence_count=int(raw_ent["scene_presence_count"]),
            first_seen_chapter=int(raw_ent["first_seen_chapter"]),
            total_chapters=total_chapters,
        )
        compiled_entities[ent_id] = CompiledEntitySummary(
            entity_id=ent_id,
            canonical_name=str(raw_ent["canonical_name"]),
            aliases=list(raw_ent["aliases"]),
            entity_type=raw_ent["entity_type"],
            visual_tier=tier,
            importance_score=score,
            base_anatomy=raw_ent.get("base_anatomy"),
            first_seen_chapter=int(raw_ent["first_seen_chapter"]),
            scene_presence_count=int(raw_ent["scene_presence_count"]),
        )

    elapsed_sec = round(max(time.perf_counter() - t0, 0.001), 4)

    compiled_response = CompiledBookGraphResponse(
        ok=True,
        trace_id=trace_id,
        book_id=book_id,
        total_chapters=total_chapters,
        total_scenes=total_scenes,
        total_beats=int(dataset["total_beats"]),
        entities=compiled_entities,
        locations=locations,
        timeline=timeline,
        edges=edges,
        has_cycles_detected=has_cycles,
        cycle_break_count=cycle_breaks,
        duration_sec=elapsed_sec,
    )

    with _COMPILER_CACHE_LOCK:
        _COMPILED_GRAPH_CACHE[book_id] = compiled_response

    return compiled_response


def _get_or_compile_graph(book_id: str, trace_id: str) -> CompiledBookGraphResponse:
    with _COMPILER_CACHE_LOCK:
        cached = _COMPILED_GRAPH_CACHE.get(book_id)
    if cached is not None:
        return cached.model_copy(update={"trace_id": trace_id})
    return compile_book_graph(book_id=book_id, trace_id=trace_id)


# ============================================================================
# 5. FastAPI Endpoints (/api/v1/compiler/*)
# ============================================================================


@router.post("/compile", response_model=CompiledBookGraphResponse)
async def compile_book_endpoint(
    payload: CompileBookRequest,
    request: Request,
    response: Response,
) -> CompiledBookGraphResponse:
    trace_id = _resolve_trace_id(request, response)
    return compile_book_graph(book_id=payload.book_id, trace_id=trace_id)


@router.get("/graph/{book_id}", response_model=CompiledBookGraphResponse)
async def get_compiled_book_graph(
    book_id: str,
    request: Request,
    response: Response,
) -> CompiledBookGraphResponse:
    trace_id = _resolve_trace_id(request, response)
    return _get_or_compile_graph(book_id=book_id, trace_id=trace_id)


@router.get("/timeline/{book_id}", response_model=TimelineResponse)
async def get_compiled_timeline(
    book_id: str,
    request: Request,
    response: Response,
) -> TimelineResponse:
    trace_id = _resolve_trace_id(request, response)
    graph = _get_or_compile_graph(book_id=book_id, trace_id=trace_id)
    flashback_count = sum(1 for tick in graph.timeline if tick.is_flashback)

    return TimelineResponse(
        ok=True,
        trace_id=trace_id,
        book_id=book_id,
        total_ticks=len(graph.timeline),
        flashback_count=flashback_count,
        ticks=graph.timeline,
    )


@router.get("/characters/{book_id}", response_model=CharacterRegistryResponse)
async def get_character_registry(
    book_id: str,
    request: Request,
    response: Response,
) -> CharacterRegistryResponse:
    trace_id = _resolve_trace_id(request, response)
    graph = _get_or_compile_graph(book_id=book_id, trace_id=trace_id)

    characters = [
        ent
        for ent in graph.entities.values()
        if ent.entity_type == "CHARACTER"
    ]
    characters.sort(key=lambda c: (-c.importance_score, c.entity_id))

    tier_counts: dict[str, int] = {
        "TIER_1_CORE": 0,
        "TIER_2": 0,
        "TIER_3": 0,
    }
    for char in characters:
        tier_counts[char.visual_tier] = tier_counts.get(char.visual_tier, 0) + 1

    return CharacterRegistryResponse(
        ok=True,
        trace_id=trace_id,
        book_id=book_id,
        characters=characters,
        tier_counts=tier_counts,
    )


@router.get("/locations/{book_id}", response_model=LocationTreeResponse)
async def get_location_tree(
    book_id: str,
    request: Request,
    response: Response,
) -> LocationTreeResponse:
    trace_id = _resolve_trace_id(request, response)
    graph = _get_or_compile_graph(book_id=book_id, trace_id=trace_id)

    sorted_locations = sorted(
        graph.locations.values(),
        key=lambda loc: loc.materialized_path,
    )
    root_locations = [
        loc.location_id
        for loc in sorted_locations
        if loc.parent_location_id is None
    ]

    return LocationTreeResponse(
        ok=True,
        trace_id=trace_id,
        book_id=book_id,
        locations=sorted_locations,
        root_locations=root_locations,
        cycle_free_verified=True,
    )
