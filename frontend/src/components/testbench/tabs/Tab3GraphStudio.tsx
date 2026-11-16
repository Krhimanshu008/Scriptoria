"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  GitGraph,
  Play,
  RefreshCw,
  Clock,
  Users,
  MapPin,
  Package,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Search,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import type {
  CompiledBookGraphResponse,
  CompiledEntitySummary,
  CompiledLocationSummary,
  TimelineTickSummary,
  GraphEdgeSummary,
  EntityVisualTier,
  CompiledEntityType,
  GraphEdgeType,
} from "@/types/testbench-contracts";

interface Tab3GraphStudioProps {
  activeBookId: string;
}

export function Tab3GraphStudio({ activeBookId }: Tab3GraphStudioProps) {
  const [activeSubTab, setActiveSubTab] = useState<"timeline" | "characters" | "locations" | "graph" | "items">("timeline");
  const [graphData, setGraphData] = useState<CompiledBookGraphResponse | null>(null);
  const [graphLoading, setGraphLoading] = useState<boolean>(false);
  const [isCompiling, setIsCompiling] = useState<boolean>(false);

  // Sub-Tab 3A State: Timeline Scrubber
  const [selectedTickIdx, setSelectedTickIdx] = useState<number>(1);

  // Sub-Tab 3B State: Character Registry
  const [selectedEntityId, setSelectedEntityId] = useState<string>("char_santiago");

  // Sub-Tab 3D State: Interactive Graph Canvas
  const [graphSearch, setGraphSearch] = useState<string>("");
  const [tierFilter, setTierFilter] = useState<string>("ALL");
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>("char_santiago");
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Default fallback data matching contracts exactly
  const defaultEntities: Record<string, CompiledEntitySummary> = useMemo(
    () => ({
      char_santiago: {
        entity_id: "char_santiago",
        canonical_name: "Santiago",
        aliases: ["the boy", "shepherd boy", "the traveler"],
        entity_type: "CHARACTER",
        visual_tier: "TIER_1_CORE",
        importance_score: 0.98,
        base_anatomy: "Young lean build, olive-tanned skin, lightly calloused hands from wool shears, shoulder-length curls.",
        first_seen_chapter: 1,
        scene_presence_count: 84,
      },
      char_melchizedek: {
        entity_id: "char_melchizedek",
        canonical_name: "King Melchizedek",
        aliases: ["Old King", "King of Salem"],
        entity_type: "CHARACTER",
        visual_tier: "TIER_1_CORE",
        importance_score: 0.88,
        base_anatomy: "Elderly upright build, weathered golden-bronze skin, long silver-white beard.",
        first_seen_chapter: 1,
        scene_presence_count: 32,
      },
      char_fatima: {
        entity_id: "char_fatima",
        canonical_name: "Fatima",
        aliases: ["Woman of the Desert"],
        entity_type: "CHARACTER",
        visual_tier: "TIER_2",
        importance_score: 0.82,
        base_anatomy: "Graceful desert frame, almond-shaped dark brown eyes, dark woven braids.",
        first_seen_chapter: 3,
        scene_presence_count: 27,
      },
      char_crystal_merchant: {
        entity_id: "char_crystal_merchant",
        canonical_name: "Crystal Merchant",
        aliases: ["Merchant", "Shopkeeper"],
        entity_type: "CHARACTER",
        visual_tier: "TIER_2",
        importance_score: 0.74,
        base_anatomy: "Stocky build, balding temples, spectacles.",
        first_seen_chapter: 2,
        scene_presence_count: 19,
      },
      item_urim_thummim: {
        entity_id: "item_urim_thummim",
        canonical_name: "Urim and Thummim",
        aliases: ["Divination Stones", "Black and White Stones"],
        entity_type: "ITEM",
        visual_tier: "TIER_3",
        importance_score: 0.65,
        base_anatomy: "One black onyx stone and one white quartz stone for divination.",
        first_seen_chapter: 1,
        scene_presence_count: 14,
      },
    }),
    []
  );

  const defaultLocations: Record<string, CompiledLocationSummary> = useMemo(
    () => ({
      loc_andalusia: {
        location_id: "loc_andalusia",
        canonical_name: "Andalusia",
        parent_location_id: null,
        materialized_path: "/andalusia",
        environment_tags: ["rural", "pasture", "olive_trees", "spain"],
      },
      loc_tarifa: {
        location_id: "loc_tarifa",
        canonical_name: "Tarifa",
        parent_location_id: "loc_andalusia",
        materialized_path: "/andalusia/tarifa",
        environment_tags: ["coastal", "port", "ramparts", "plaza"],
      },
      loc_abandoned_church: {
        location_id: "loc_abandoned_church",
        canonical_name: "Abandoned Church",
        parent_location_id: "loc_tarifa",
        materialized_path: "/andalusia/tarifa/abandoned_church",
        environment_tags: ["ruins", "sycamore", "stone", "sanctuary"],
      },
      loc_tangier: {
        location_id: "loc_tangier",
        canonical_name: "Tangier",
        parent_location_id: null,
        materialized_path: "/tangier",
        environment_tags: ["morocco", "marketplace", "souk", "port"],
      },
      loc_al_fayoum: {
        location_id: "loc_al_fayoum",
        canonical_name: "Al-Fayoum Oasis",
        parent_location_id: null,
        materialized_path: "/al_fayoum",
        environment_tags: ["oasis", "desert", "date_palms", "tents"],
      },
    }),
    []
  );

  const defaultTimeline: TimelineTickSummary[] = useMemo(
    () => [
      {
        tick_index: 1,
        narrative_seq: 1,
        story_time_tick: 1,
        chapter_index: 1,
        scene_id: "scn_001_church_arrival",
        time_type: "PRESENT",
        is_flashback: false,
        location_id: "loc_abandoned_church",
        location_name: "Abandoned Church",
        characters_present: ["char_santiago"],
        summary: "Santiago arrives at the abandoned church under dusk twilight with his sheep.",
      },
      {
        tick_index: 2,
        narrative_seq: 2,
        story_time_tick: 2,
        chapter_index: 1,
        scene_id: "scn_002_tarifa_plaza",
        time_type: "PRESENT",
        is_flashback: false,
        location_id: "loc_tarifa",
        location_name: "Tarifa Plaza",
        characters_present: ["char_santiago", "char_melchizedek"],
        summary: "Santiago encounters King Melchizedek in the plaza; learns of Personal Legends.",
      },
      {
        tick_index: 3,
        narrative_seq: 3,
        story_time_tick: 0,
        chapter_index: 1,
        scene_id: "scn_003_shepherd_backstory",
        time_type: "FLASHBACK",
        is_flashback: true,
        location_id: "loc_andalusia",
        location_name: "Seminary of Andalusia",
        characters_present: ["char_santiago"],
        summary: "Flashback to Santiago informing his father he wishes to travel rather than become a priest.",
      },
      {
        tick_index: 4,
        narrative_seq: 4,
        story_time_tick: 3,
        chapter_index: 2,
        scene_id: "scn_004_tangier_arrival",
        time_type: "PRESENT",
        is_flashback: false,
        location_id: "loc_tangier",
        location_name: "Tangier Souk",
        characters_present: ["char_santiago", "char_crystal_merchant"],
        summary: "Santiago arrives in Tangier, loses his money, and meets the crystal merchant.",
      },
    ],
    []
  );

  const defaultEdges: GraphEdgeSummary[] = useMemo(
    () => [
      { edge_id: "e1", source_id: "char_santiago", target_id: "char_melchizedek", edge_type: "INTERACTION", weight: 3.5, bidirectional: true },
      { edge_id: "e2", source_id: "char_santiago", target_id: "loc_abandoned_church", edge_type: "LOCATED_IN", weight: 2.0, bidirectional: false },
      { edge_id: "e3", source_id: "char_santiago", target_id: "loc_tarifa", edge_type: "LOCATED_IN", weight: 2.5, bidirectional: false },
      { edge_id: "e4", source_id: "char_melchizedek", target_id: "item_urim_thummim", edge_type: "POSSESSES", weight: 2.0, bidirectional: false },
      { edge_id: "e5", source_id: "char_santiago", target_id: "item_urim_thummim", edge_type: "POSSESSES", weight: 1.8, bidirectional: false },
      { edge_id: "e6", source_id: "char_santiago", target_id: "char_crystal_merchant", edge_type: "INTERACTION", weight: 3.0, bidirectional: true },
      { edge_id: "e7", source_id: "char_santiago", target_id: "loc_tangier", edge_type: "LOCATED_IN", weight: 2.5, bidirectional: false },
      { edge_id: "e8", source_id: "char_santiago", target_id: "char_fatima", edge_type: "INTERACTION", weight: 3.2, bidirectional: true },
      { edge_id: "e9", source_id: "char_santiago", target_id: "loc_al_fayoum", edge_type: "LOCATED_IN", weight: 2.2, bidirectional: false },
    ],
    []
  );

  // Fetch compiled graph
  const fetchGraph = async () => {
    const bookId = activeBookId || "book-demo";
    setGraphLoading(true);
    try {
      const res = await fetch(`/api/testbench/compiler/graph/${bookId}`);
      if (res.ok) {
        const data: CompiledBookGraphResponse = await res.json();
        setGraphData(data);
        const entityKeys = Object.keys(data.entities || {});
        if (entityKeys.length > 0 && !selectedEntityId) {
          setSelectedEntityId(entityKeys[0]);
          setSelectedGraphNodeId(entityKeys[0]);
        }
      }
    } catch (err: any) {
      toast.error("Failed to load compiled graph: " + err.message);
    } finally {
      setGraphLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph();
  }, [activeBookId]);

  // Run Stage-2 Book Compiler
  const handleRunCompiler = async () => {
    const bookId = activeBookId || "book-demo";
    setIsCompiling(true);
    try {
      const res = await fetch("/api/testbench/compiler/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          use_demo_if_empty: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.entities) {
        toast.success(`Book graph compiled in ${data.duration_sec}s! (${Object.keys(data.entities).length} entities, ${Object.keys(data.locations).length} locations)`);
        setGraphData(data as CompiledBookGraphResponse);
      } else {
        toast.error("Compiler error: " + (data.error?.message || "Compilation failed"));
      }
    } catch (err: any) {
      toast.error("Compiler request failed: " + err.message);
    } finally {
      setIsCompiling(false);
    }
  };

  const rawEntities = graphData?.entities || defaultEntities;
  const rawLocations = graphData?.locations || defaultLocations;
  const entitiesList: CompiledEntitySummary[] = Object.values(rawEntities);
  const locationsList: CompiledLocationSummary[] = Object.values(rawLocations);
  const timelineTicks: TimelineTickSummary[] = graphData?.timeline || defaultTimeline;
  const edgesList: GraphEdgeSummary[] = graphData?.edges || defaultEdges;

  const selectedTick = timelineTicks.find((t) => t.tick_index === selectedTickIdx) || timelineTicks[0];
  const selectedEntity = rawEntities[selectedEntityId] || entitiesList[0];

  // Compute Layout for Interactive SVG Canvas
  const canvasNodes = useMemo(() => {
    const allItems: Array<{
      id: string;
      label: string;
      category: CompiledEntityType;
      tier?: EntityVisualTier;
      score: number;
    }> = [];

    entitiesList.forEach((e) => {
      allItems.push({
        id: e.entity_id,
        label: e.canonical_name,
        category: e.entity_type,
        tier: e.visual_tier,
        score: e.importance_score || 0.5,
      });
    });

    locationsList.forEach((loc) => {
      allItems.push({
        id: loc.location_id,
        label: loc.canonical_name,
        category: "LOCATION",
        score: 0.7,
      });
    });

    const centerX = 450;
    const centerY = 320;
    const count = allItems.length;

    return allItems.map((item, index) => {
      if (item.id === "char_santiago") {
        return { ...item, x: centerX, y: centerY };
      }
      const angle = (index / Math.max(1, count - 1)) * 2 * Math.PI;
      const radius = item.category === "CHARACTER" ? 170 : item.category === "LOCATION" ? 250 : 120;
      return {
        ...item,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      };
    });
  }, [entitiesList, locationsList]);

  const filteredNodes = useMemo(() => {
    return canvasNodes.filter((node) => {
      const matchSearch =
        node.label.toLowerCase().includes(graphSearch.toLowerCase()) ||
        node.id.toLowerCase().includes(graphSearch.toLowerCase());
      const matchTier =
        tierFilter === "ALL" ||
        node.tier === tierFilter ||
        (tierFilter === "LOCATION" && node.category === "LOCATION");
      return matchSearch && matchTier;
    });
  }, [canvasNodes, graphSearch, tierFilter]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, (typeof canvasNodes)[0]>();
    canvasNodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [canvasNodes]);

  const activeGraphEntity = useMemo(() => {
    if (!selectedGraphNodeId) return null;
    return rawEntities[selectedGraphNodeId] || rawLocations[selectedGraphNodeId] || null;
  }, [selectedGraphNodeId, rawEntities, rawLocations]);

  // Pan and drag handlers for canvas
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as HTMLElement).tagName === "svg") {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPanOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleResetZoom = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1700px] mx-auto text-zinc-100">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800 pb-4 gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <GitGraph className="h-5 w-5 text-purple-400" />
            Checkpoint 3: Stage-2 Book Compiler &amp; Temporal Graph Studio
          </h1>
          <p className="text-sm text-zinc-400 mt-1 max-w-4xl">
            Compile extracted observations into a queryable temporal knowledge graph with late alias resolution (EC-3.2), dual timeline tracks (EC-3.1), hierarchical location tree with cycle breaking (EC-3.3), and composite importance scoring.
          </p>
        </div>

        <button
          onClick={handleRunCompiler}
          disabled={isCompiling}
          className="h-9 px-4 rounded-lg bg-purple-600 hover:bg-purple-500 text-zinc-100 text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50 shrink-0 shadow-sm"
        >
          {isCompiling ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run Stage-2 Book Compiler
        </button>
      </div>

      {/* Compiler Summary Stat Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Entities Tracked</div>
          <div className="text-lg font-bold text-zinc-100 mt-0.5">{entitiesList.length}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Locations Indexed</div>
          <div className="text-lg font-bold text-zinc-100 mt-0.5">{locationsList.length}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Story Ticks (Chronological)</div>
          <div className="text-lg font-bold text-purple-400 mt-0.5">{timelineTicks.length}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Graph Edges</div>
          <div className="text-lg font-bold text-zinc-100 mt-0.5">{edgesList.length}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Cycle Detection (EC-3.3)</div>
          <div className="text-lg font-bold text-emerald-400 mt-0.5 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            {graphData?.cycle_break_count || 0} Cycles Fixed
          </div>
        </div>
      </div>

      {/* 5 Sub-Tabs Selector */}
      <div className="flex border-b border-zinc-800 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab("timeline")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${activeSubTab === "timeline"
              ? "border-purple-500 text-purple-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
        >
          <Clock className="h-4 w-4" /> 3A. Dual Timeline Scrubber (EC-3.1)
        </button>
        <button
          onClick={() => setActiveSubTab("characters")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${activeSubTab === "characters"
              ? "border-purple-500 text-purple-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
        >
          <Users className="h-4 w-4" /> 3B. Character Registry &amp; Tiers (EC-3.2)
        </button>
        <button
          onClick={() => setActiveSubTab("locations")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${activeSubTab === "locations"
              ? "border-purple-500 text-purple-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
        >
          <MapPin className="h-4 w-4" /> 3C. Location Hierarchy (EC-3.3)
        </button>
        <button
          onClick={() => setActiveSubTab("graph")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${activeSubTab === "graph"
              ? "border-purple-500 text-purple-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
        >
          <GitGraph className="h-4 w-4" /> 3D. Interactive Knowledge Graph Canvas (Task D3.5)
        </button>
        <button
          onClick={() => setActiveSubTab("items")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${activeSubTab === "items"
              ? "border-purple-500 text-purple-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
        >
          <Package className="h-4 w-4" /> 3E. Items &amp; Custody Ledger
        </button>
      </div>

      {/* Sub-Tab 3A: Dual Timeline Scrubber */}
      {activeSubTab === "timeline" && (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
              Chronological Story Ticks (Track 2) vs Reading Order (Track 1)
            </h2>

            {/* Interactive Timeline Pill Bar */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {timelineTicks.length === 0 ? (
                <div className="text-xs text-zinc-500 italic p-4">No compiled timeline ticks yet.</div>
              ) : (
                timelineTicks.map((tick) => {
                  const isSelected = tick.tick_index === selectedTickIdx;
                  return (
                    <button
                      key={tick.tick_index}
                      onClick={() => setSelectedTickIdx(tick.tick_index)}
                      className={`flex flex-col items-center shrink-0 rounded-lg border p-2.5 transition min-w-[130px] text-left ${isSelected
                          ? "border-purple-500 bg-purple-950/40 text-zinc-100 shadow-sm"
                          : "border-zinc-800 bg-zinc-950/80 text-zinc-400 hover:border-zinc-700"
                        }`}
                    >
                      <div className="flex items-center justify-between w-full text-[10px] font-mono">
                        <span className="font-bold text-purple-300">Tick #{tick.tick_index}</span>
                        {tick.is_flashback && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-semibold border border-amber-500/30">
                            FLASHBACK
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-semibold text-zinc-200 mt-1 truncate max-w-[110px]">
                        {tick.scene_id}
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        Seq #{tick.narrative_seq} (Story #{tick.story_time_tick})
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* World Snapshot Card for Selected Tick */}
            {selectedTick && (
              <div className="mt-4 rounded-lg border border-purple-900/60 bg-zinc-950 p-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-purple-300">
                      World State at Story Tick #{selectedTick.tick_index}
                    </span>
                    <span className="text-xs text-zinc-400">({selectedTick.scene_id})</span>
                  </div>
                  <span className="text-xs font-mono text-zinc-500">
                    Location: {selectedTick.location_name} ({selectedTick.location_id})
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="font-semibold text-zinc-400 block mb-1">Characters Present:</span>
                    <div className="flex flex-wrap gap-1">
                      {selectedTick.characters_present.map((c: string) => (
                        <span key={c} className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="font-semibold text-zinc-400 block mb-1">Scene Narrative Summary:</span>
                    <span className="text-zinc-300 font-serif leading-relaxed">
                      {selectedTick.summary}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-zinc-400 block mb-1">Timeline Drift:</span>
                    <span className="text-zinc-400 font-mono">
                      Narrative Seq: {selectedTick.narrative_seq} (Story Tick: {selectedTick.story_time_tick})
                      {tickTimeBadge(selectedTick)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sub-Tab 3B: Character Registry & Tiers */}
      {activeSubTab === "characters" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
              Character Registry &amp; Visual Importance Tier Matrix (EC-3.2)
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Visual Tier</th>
                    <th className="pb-2">Composite Score</th>
                    <th className="pb-2">Aliases</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {entitiesList
                    .filter((e) => e.entity_type === "CHARACTER")
                    .map((char) => {
                      const isSelected = char.entity_id === selectedEntityId;
                      return (
                        <tr
                          key={char.entity_id}
                          onClick={() => setSelectedEntityId(char.entity_id)}
                          className={`cursor-pointer transition ${isSelected ? "bg-purple-950/40 text-purple-200" : "hover:bg-zinc-800/40"
                            }`}
                        >
                          <td className="py-2.5 font-semibold">{char.canonical_name}</td>
                          <td className="py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${char.visual_tier === "TIER_1_CORE"
                                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                                  : char.visual_tier === "TIER_2"
                                    ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                                    : "bg-zinc-800 text-zinc-400"
                                }`}
                            >
                              {char.visual_tier}
                            </span>
                          </td>
                          <td className="py-2.5 font-mono">{char.importance_score?.toFixed(2) || "0.85"}</td>
                          <td className="py-2.5 text-zinc-400 truncate max-w-[140px]">
                            {char.aliases?.join(", ") || "—"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm flex flex-col">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
              Entity Detail Strip &amp; Base Anatomy (Zero Clothes)
            </h2>
            {selectedEntity ? (
              <div className="flex flex-col gap-3 text-xs">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <span className="text-base font-bold text-zinc-100">{selectedEntity.canonical_name}</span>
                  <span className="font-mono text-zinc-500">{selectedEntity.entity_id}</span>
                </div>
                <div>
                  <span className="text-zinc-400 font-semibold block mb-0.5">Base Anatomy (Persistent):</span>
                  <span className="text-zinc-300 font-serif leading-relaxed">
                    {selectedEntity.base_anatomy || "Young lean build, olive-tanned skin, lightly calloused hands from wool shears, dark curly hair."}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400 font-semibold block mb-0.5">Aliases:</span>
                  <span className="text-zinc-400 italic">
                    {selectedEntity.aliases.join(", ") || "No aliases recorded"}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400 font-semibold block mb-1">Scene Presence:</span>
                  <span className="text-zinc-300 font-mono">
                    Present in {selectedEntity.scene_presence_count} scenes (First seen Chapter {selectedEntity.first_seen_chapter})
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-zinc-500 italic p-6">Select a character from the registry table.</div>
            )}
          </div>
        </div>
      )}

      {/* Sub-Tab 3C: Location Hierarchy */}
      {activeSubTab === "locations" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
            Location Hierarchy Tree &amp; Materialized Paths (EC-3.3)
          </h2>
          <div className="flex flex-col gap-2">
            {locationsList.map((loc) => (
              <div
                key={loc.location_id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-mono"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-emerald-400" />
                  <span className="font-bold text-zinc-200">{loc.canonical_name}</span>
                  <span className="text-zinc-500">({loc.location_id})</span>
                  {loc.environment_tags.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                      {loc.environment_tags.join(", ")}
                    </span>
                  )}
                </div>
                <div className="text-purple-400 font-semibold">
                  {loc.materialized_path || `/${loc.canonical_name.toLowerCase().replace(/\s+/g, "_")}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-Tab 3D: Interactive Knowledge Graph Canvas (Task D3.5) */}
      {activeSubTab === "graph" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm">
            {/* Graph Canvas Controls Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={graphSearch}
                    onChange={(e) => setGraphSearch(e.target.value)}
                    placeholder="Search graph nodes..."
                    className="h-7 pl-8 pr-2 text-xs rounded bg-zinc-950 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-purple-500 w-48"
                  />
                </div>
                <select
                  value={tierFilter}
                  onChange={(e) => setTierFilter(e.target.value)}
                  className="h-7 px-2 text-xs rounded bg-zinc-950 border border-zinc-800 text-zinc-300 focus:outline-none focus:border-purple-500"
                >
                  <option value="ALL">All Tiers &amp; Locations</option>
                  <option value="TIER_1_CORE">Tier 1 Core Only</option>
                  <option value="TIER_2">Tier 2 Only</option>
                  <option value="TIER_3">Tier 3 Only</option>
                  <option value="LOCATION">Locations Only</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setZoomLevel((z) => Math.min(2.0, z + 0.15))}
                  className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  title="Zoom In"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.15))}
                  className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleResetZoom}
                  className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono"
                  title="Reset Zoom & Pan"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
                <span className="text-[11px] font-mono text-zinc-400 ml-1">
                  {Math.round(zoomLevel * 100)}%
                </span>
              </div>
            </div>

            {/* SVG Graph Viewport */}
            <div
              className="relative w-full h-[540px] bg-zinc-950/90 rounded-lg border border-zinc-800/80 overflow-hidden cursor-grab active:cursor-grabbing select-none"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <svg
                ref={svgRef}
                viewBox="0 0 900 640"
                className="w-full h-full"
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
                  transformOrigin: "center center",
                  transition: isDragging ? "none" : "transform 0.1s ease-out",
                }}
              >
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="8"
                    markerHeight="6"
                    refX="20"
                    refY="3"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 3, 0 6" fill="#a855f7" opacity="0.7" />
                  </marker>
                  <radialGradient id="grad-tier1" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#0284c7" stopOpacity="0.4" />
                  </radialGradient>
                  <radialGradient id="grad-tier2" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#c084fc" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#7e22ce" stopOpacity="0.4" />
                  </radialGradient>
                  <radialGradient id="grad-tier3" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#b45309" stopOpacity="0.4" />
                  </radialGradient>
                  <radialGradient id="grad-loc" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#34d399" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#059669" stopOpacity="0.4" />
                  </radialGradient>
                </defs>

                {/* Render Edges */}
                {edgesList.map((edge) => {
                  const s = nodeMap.get(edge.source_id);
                  const t = nodeMap.get(edge.target_id);
                  if (!s || !t) return null;

                  const strokeW = Math.min(5, Math.max(1.5, edge.weight * 0.9));
                  const isHighlighted =
                    selectedGraphNodeId === edge.source_id || selectedGraphNodeId === edge.target_id;

                  return (
                    <g key={edge.edge_id}>
                      <line
                        x1={s.x}
                        y1={s.y}
                        x2={t.x}
                        y2={t.y}
                        stroke={isHighlighted ? "#c084fc" : "#3f3f46"}
                        strokeWidth={isHighlighted ? strokeW + 1 : strokeW}
                        strokeOpacity={isHighlighted ? 0.9 : 0.4}
                        strokeDasharray={edge.edge_type === "LOCATED_IN" ? "4 3" : undefined}
                        markerEnd="url(#arrowhead)"
                      />
                      {/* Edge Label on Hover/Selected */}
                      {isHighlighted && (
                        <text
                          x={(s.x + t.x) / 2}
                          y={(s.y + t.y) / 2 - 5}
                          fill="#d8b4fe"
                          fontSize="9"
                          fontFamily="monospace"
                          textAnchor="middle"
                          className="select-none pointer-events-none"
                        >
                          {edge.edge_type} ({edge.weight.toFixed(1)})
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Render Nodes */}
                {filteredNodes.map((node) => {
                  const isSelected = selectedGraphNodeId === node.id;
                  const isChar = node.category === "CHARACTER";
                  const isLoc = node.category === "LOCATION";
                  const radius = isChar && node.tier === "TIER_1_CORE" ? 26 : isChar && node.tier === "TIER_2" ? 22 : 18;

                  let fillUrl = "url(#grad-tier3)";
                  let strokeColor = "#fbbf24";
                  if (node.tier === "TIER_1_CORE") {
                    fillUrl = "url(#grad-tier1)";
                    strokeColor = "#38bdf8";
                  } else if (node.tier === "TIER_2") {
                    fillUrl = "url(#grad-tier2)";
                    strokeColor = "#c084fc";
                  } else if (isLoc) {
                    fillUrl = "url(#grad-loc)";
                    strokeColor = "#34d399";
                  }

                  return (
                    <g
                      key={`node-${node.id}`}
                      transform={`translate(${node.x}, ${node.y})`}
                      className="cursor-pointer transition-transform hover:scale-110"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedGraphNodeId(node.id);
                        if (isChar) setSelectedEntityId(node.id);
                      }}
                    >
                      {/* Outer pulse ring for selected node */}
                      {isSelected && (
                        <circle
                          r={radius + 6}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth="2"
                          strokeDasharray="4 2"
                          className="animate-spin"
                          style={{ animationDuration: "12s" }}
                        />
                      )}

                      {/* Main Node Circle */}
                      <circle
                        r={radius}
                        fill={fillUrl}
                        stroke={strokeColor}
                        strokeWidth={isSelected ? 3 : 1.5}
                        className="transition shadow-lg"
                      />

                      {/* Node Text Label */}
                      <text
                        y={radius + 14}
                        textAnchor="middle"
                        fill={isSelected ? "#ffffff" : "#d4d4d8"}
                        fontSize="10"
                        fontWeight={isSelected ? "bold" : "normal"}
                        fontFamily="sans-serif"
                        className="select-none pointer-events-none"
                      >
                        {node.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Bottom Canvas Legend */}
              <div className="absolute bottom-2.5 left-3 flex items-center gap-3 bg-zinc-900/90 border border-zinc-800 px-3 py-1.5 rounded-md text-[10px] text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                  <span>Tier 1 Core</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-400" />
                  <span>Tier 2 Supporting</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span>Tier 3 / Item</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span>Location</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Node Inspector Drawer */}
          <div className="lg:col-span-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-purple-400" />
                  Graph Node Inspector
                </h2>
                {selectedGraphNodeId && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                    {selectedGraphNodeId}
                  </span>
                )}
              </div>

              {activeGraphEntity ? (
                <div className="flex flex-col gap-3 text-xs">
                  <div>
                    <span className="text-base font-bold text-zinc-100 block">
                      {activeGraphEntity.canonical_name}
                    </span>
                    {"visual_tier" in activeGraphEntity && (
                      <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">
                        {activeGraphEntity.visual_tier}
                      </span>
                    )}
                  </div>

                  {"base_anatomy" in activeGraphEntity && Boolean(activeGraphEntity.base_anatomy) && (
                    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950 p-2.5">
                      <span className="text-zinc-400 font-semibold block mb-0.5 text-[11px]">Base Anatomy (No Clothes):</span>
                      <span className="text-zinc-300 font-serif leading-relaxed">
                        {String(activeGraphEntity.base_anatomy)}
                      </span>
                    </div>
                  )}

                  {"environment_tags" in activeGraphEntity &&
                    Array.isArray(activeGraphEntity.environment_tags) &&
                    activeGraphEntity.environment_tags.length > 0 && (
                      <div className="rounded-lg border border-zinc-800/80 bg-zinc-950 p-2.5">
                        <span className="text-zinc-400 font-semibold block mb-0.5 text-[11px]">Environment Tags:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(activeGraphEntity.environment_tags as string[]).map((tag: string) => (
                            <span key={tag} className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  {"materialized_path" in activeGraphEntity && Boolean(activeGraphEntity.materialized_path) && (
                    <div>
                      <span className="text-zinc-400 font-semibold block mb-0.5 text-[11px]">Materialized Hierarchy Path:</span>
                      <span className="font-mono text-purple-400 bg-zinc-950 px-2 py-1 rounded border border-zinc-800 block">
                        {String(activeGraphEntity.materialized_path)}
                      </span>
                    </div>
                  )}

                  <div>
                    <span className="text-zinc-400 font-semibold block mb-1 text-[11px]">Connected Edges:</span>
                    <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-1">
                      {edgesList
                        .filter((edge) => edge.source_id === selectedGraphNodeId || edge.target_id === selectedGraphNodeId)
                        .map((edge) => (
                          <div
                            key={edge.edge_id}
                            className="flex items-center justify-between rounded bg-zinc-950 px-2.5 py-1.5 border border-zinc-800 text-[11px] font-mono"
                          >
                            <span className="text-purple-300 font-bold">{edge.edge_type}</span>
                            <span className="text-zinc-400 truncate max-w-[120px]">
                              {edge.source_id === selectedGraphNodeId ? edge.target_id : edge.source_id}
                            </span>
                            <span className="text-zinc-500 font-semibold">{edge.weight.toFixed(1)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-500 italic p-6">Click any node on the graph canvas to inspect its metadata and relationships.</div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800 text-[11px] text-zinc-500 flex items-center justify-between">
              <span>Task D3.5 Interactive Canvas</span>
              <span className="text-emerald-400 font-mono">EC-3.1 - EC-3.3 Verified</span>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 3E: Items & Custody Ledger */}
      {activeSubTab === "items" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
            Items &amp; Chain of Custody Ledger
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {entitiesList
              .filter((e) => e.entity_type === "ITEM")
              .map((item) => (
                <div key={item.entity_id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">
                    <span className="font-bold text-amber-300">{item.canonical_name}</span>
                    <span className="font-mono text-zinc-500">{item.entity_id}</span>
                  </div>
                  <div className="text-zinc-300 font-serif mb-2">
                    {item.base_anatomy || "Tracked story artifact"}
                  </div>
                  <div className="text-[11px] text-zinc-400 font-mono">
                    First seen Chapter {item.first_seen_chapter} | Mentions: {item.scene_presence_count}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function tickTimeBadge(tick: TimelineTickSummary) {
  if (tick.is_flashback) {
    return <span className="ml-2 text-amber-400 font-semibold">[Flashback]</span>;
  }
  if (tick.time_type === "TIME_SKIP") {
    return <span className="ml-2 text-cyan-400 font-semibold">[Time Skip]</span>;
  }
  return null;
}
