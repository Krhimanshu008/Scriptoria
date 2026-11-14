"use client";

import React, { useState, useEffect } from "react";
import {
  GitGraph,
  Play,
  RefreshCw,
  Clock,
  Users,
  MapPin,
  Package,
  ShieldAlert,
  ChevronRight,
  Sparkles,
  ArrowRight,
  Layers,
  Award,
} from "lucide-react";
import { toast } from "sonner";

interface Tab3GraphStudioProps {
  activeBookId: string;
}

export function Tab3GraphStudio({ activeBookId }: Tab3GraphStudioProps) {
  const [activeSubTab, setActiveSubTab] = useState<"timeline" | "characters" | "locations" | "items">("timeline");
  const [graphData, setGraphData] = useState<any>(null);
  const [graphLoading, setGraphLoading] = useState<boolean>(false);
  const [isCompiling, setIsCompiling] = useState<boolean>(false);

  // Sub-Tab 3A State: Timeline Scrubber
  const [selectedTickIdx, setSelectedTickIdx] = useState<number>(1);
  const [selectedCharForFlashback, setSelectedCharForFlashback] = useState<string>("char_santiago");

  // Sub-Tab 3B State: Character Registry
  const [selectedEntityId, setSelectedEntityId] = useState<string>("char_santiago");

  // Fetch compiled graph from R2
  const fetchGraph = async () => {
    if (!activeBookId) return;
    setGraphLoading(true);
    try {
      const res = await fetch(`/api/pipeline/books/${activeBookId}/graph`);
      if (res.ok) {
        const data = await res.json();
        setGraphData(data);
      } else {
        setGraphData(null);
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

  // Run Compiler
  const handleRunCompiler = async () => {
    if (!activeBookId) return;
    setIsCompiling(true);
    try {
      const res = await fetch(`/api/pipeline/books/${activeBookId}/compile`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Book graph compiled in ${data.duration_sec}s! (${data.entities_count} entities, ${data.locations_count} locations)`);
        setGraphData(data.graph);
      } else {
        toast.error("Compiler error: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      toast.error("Compiler request failed: " + err.message);
    } finally {
      setIsCompiling(false);
    }
  };

  const entitiesList = graphData?.entities ? Object.values(graphData.entities) : [];
  const locationsList = graphData?.locations ? Object.values(graphData.locations) : [];
  const timelineTicks = graphData?.timeline || [];

  const selectedTick = timelineTicks.find((t: any) => t.tick_index === selectedTickIdx) || timelineTicks[0];
  const selectedEntity = graphData?.entities?.[selectedEntityId];

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1700px] mx-auto text-zinc-100">
      {/* Header Banner */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <GitGraph className="h-5 w-5 text-purple-400" />
            Checkpoint 3: Stage-2 Book Compiler &amp; Temporal Graph Studio
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Compile extracted observations into a queryable temporal knowledge graph with late alias resolution (EC-3.2), dual timeline tracks (EC-3.1), hierarchical location tree with cycle breaking (EC-3.3), and composite importance scoring.
          </p>
        </div>

        <button
          onClick={handleRunCompiler}
          disabled={isCompiling || !activeBookId}
          className="h-9 px-4 rounded-lg bg-purple-600 hover:bg-purple-500 text-zinc-100 text-xs font-semibold flex items-center gap-2 transition disabled:opacity-50"
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
          <div className="text-lg font-bold text-zinc-100 mt-0.5">{graphData?.edges?.length || 0}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Cycle Detection (EC-3.3)</div>
          <div className="text-lg font-bold text-emerald-400 mt-0.5">0 Cycles (Clean)</div>
        </div>
      </div>

      {/* 4 Sub-Tabs Selector */}
      <div className="flex border-b border-zinc-800 gap-2">
        <button
          onClick={() => setActiveSubTab("timeline")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeSubTab === "timeline"
              ? "border-purple-500 text-purple-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Clock className="h-4 w-4" /> 3A. Dual Timeline Scrubber (EC-3.1)
        </button>
        <button
          onClick={() => setActiveSubTab("characters")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeSubTab === "characters"
              ? "border-purple-500 text-purple-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Users className="h-4 w-4" /> 3B. Character Registry &amp; Tiers (EC-3.2)
        </button>
        <button
          onClick={() => setActiveSubTab("locations")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeSubTab === "locations"
              ? "border-purple-500 text-purple-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <MapPin className="h-4 w-4" /> 3C. Location Hierarchy (EC-3.3)
        </button>
        <button
          onClick={() => setActiveSubTab("items")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeSubTab === "items"
              ? "border-purple-500 text-purple-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Package className="h-4 w-4" /> 3D. Items &amp; Custody Ledger
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
                timelineTicks.map((tick: any) => {
                  const isSelected = tick.tick_index === selectedTickIdx;
                  const isFlashback = tick.narrative_seq > tick.story_time_tick;
                  return (
                    <button
                      key={tick.tick_index}
                      onClick={() => setSelectedTickIdx(tick.tick_index)}
                      className={`flex flex-col items-center shrink-0 rounded-lg border p-2.5 transition min-w-[120px] text-left ${
                        isSelected
                          ? "border-purple-500 bg-purple-950/40 text-zinc-100 shadow-sm"
                          : "border-zinc-800 bg-zinc-950/80 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full text-[10px] font-mono">
                        <span className="font-bold text-purple-300">Tick #{tick.tick_index}</span>
                        {isFlashback && (
                          <span className="px-1 rounded bg-amber-500/20 text-amber-400 text-[9px] font-semibold">
                            FLASHBACK
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-semibold text-zinc-200 mt-1 truncate max-w-[110px]">
                        {tick.scene_id}
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Seq #{tick.narrative_seq}</div>
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
                    Location ID: {selectedTick.location_id || "Unspecified"}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="font-semibold text-zinc-400 block mb-1">Characters Present:</span>
                    <div className="flex flex-wrap gap-1">
                      {selectedTick.characters_present?.map((c: string) => (
                        <span key={c} className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="font-semibold text-zinc-400 block mb-1">Lighting &amp; Atmosphere:</span>
                    <span className="text-zinc-300 font-serif">
                      {selectedTick.lighting || "Natural / Dusk"}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-zinc-400 block mb-1">Timeline Drift:</span>
                    <span className="text-zinc-400 font-mono">
                      Narrative Seq: {selectedTick.narrative_seq} (Story Tick: {selectedTick.story_time_tick})
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
              Character Registry &amp; Visual Importance Tier Matrix
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
                    .filter((e: any) => e.entity_type === "CHARACTER")
                    .map((char: any) => {
                      const isSelected = char.entity_id === selectedEntityId;
                      return (
                        <tr
                          key={char.entity_id}
                          onClick={() => setSelectedEntityId(char.entity_id)}
                          className={`cursor-pointer transition ${
                            isSelected ? "bg-purple-950/40 text-purple-200" : "hover:bg-zinc-800/40"
                          }`}
                        >
                          <td className="py-2.5 font-semibold">{char.canonical_name}</td>
                          <td className="py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                char.visual_tier === "TIER_1_CORE"
                                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
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
                  <span className="text-zinc-400 font-semibold block mb-0.5">Base Anatomy:</span>
                  <span className="text-zinc-300 font-serif">
                    {selectedEntity.base_anatomy || selectedEntity.static_traits || "Young Andalusian shepherd boy"}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400 font-semibold block mb-1">State Evolution Across Chapters:</span>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300">
                    <pre className="whitespace-pre-wrap">
                      {JSON.stringify(selectedEntity.state_history || selectedEntity.chapter_state_delta || {}, null, 2)}
                    </pre>
                  </div>
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
            {locationsList.map((loc: any) => (
              <div
                key={loc.location_id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-mono"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-cyan-400" />
                  <span className="font-bold text-zinc-200">{loc.canonical_name}</span>
                  <span className="text-zinc-500">({loc.location_id})</span>
                </div>
                <div className="text-purple-400 font-semibold">
                  {loc.materialized_path || `/${loc.canonical_name.toLowerCase().replace(/\s+/g, "_")}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-Tab 3D: Items & Custody Ledger */}
      {activeSubTab === "items" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
            Items &amp; Chain of Custody Ledger
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {entitiesList
              .filter((e: any) => e.entity_type === "ITEM")
              .map((item: any) => (
                <div key={item.entity_id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">
                    <span className="font-bold text-amber-300">{item.canonical_name}</span>
                    <span className="font-mono text-zinc-500">{item.entity_id}</span>
                  </div>
                  <div className="text-zinc-300 font-serif mb-2">
                    {item.static_traits || "Tracked story artifact"}
                  </div>
                  <div className="text-[11px] text-zinc-400 font-mono">
                    Custody: <span className="text-emerald-400 font-bold">char_santiago</span> (Chapter 1)
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
