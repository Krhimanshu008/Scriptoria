"use client";

import React, { useState } from "react";
import {
  Terminal,
  Zap,
  Layers,
  Database,
  ArrowRight,
  User,
  Shirt,
  MapPin,
  CloudSun,
  Activity,
  Play,
} from "lucide-react";
import { StagedScene } from "@/types/staging";

export interface ExtractionLogEntry {
  timestamp: string;
  type: "worker" | "chunker" | "prompt" | "token" | "schema" | "db" | "complete";
  text: string;
  speed?: number;
  data?: Record<string, unknown>;
}

export interface ExtractionSummaryPayload {
  persisted_nodes?: Array<{
    canonical_name: string;
    node_code: string;
    category: string;
  }>;
  node_states?: Array<{
    label: string;
    story_tick: number;
    state_code: string;
  }>;
  foundry_assets_registered?: Array<{
    asset_code: string;
    tier: string;
    template: string;
  }>;
}

interface Station2ExtractionProps {
  isExtracting: boolean;
  extractionSpeed: number;
  extractedTokensCount: number;
  extractionLogs: ExtractionLogEntry[];
  extractionSummary: ExtractionSummaryPayload | null;
  logFilter: "ALL" | "WORKER" | "PROMPTS" | "RAW_LLM" | "DB_COMMITS";
  setLogFilter: (filter: "ALL" | "WORKER" | "PROMPTS" | "RAW_LLM" | "DB_COMMITS") => void;
  autoScroll: boolean;
  setAutoScroll: (auto: boolean) => void;
  onStartExtraction: () => Promise<void>;
  terminalContainerRef: React.RefObject<HTMLDivElement | null>;
  stagedScene?: StagedScene | null;
  onProceedToFoundry?: () => void;
  onProceedToRAG?: () => void;
}

export function Station2Extraction({
  isExtracting,
  extractionSpeed,
  extractedTokensCount,
  extractionLogs,
  extractionSummary,
  logFilter,
  setLogFilter,
  autoScroll,
  setAutoScroll,
  onStartExtraction,
  terminalContainerRef,
  stagedScene,
  onProceedToFoundry,
  onProceedToRAG,
}: Station2ExtractionProps) {
  const [activeView, setActiveView] = useState<"terminal" | "staging_tables">("staging_tables");
  const [entityCategory, setEntityCategory] = useState<
    "all" | "characters" | "costumes" | "locations" | "environments" | "beats"
  >("all");

  const filteredLogs = extractionLogs.filter((log) => {
    if (logFilter === "ALL") return true;
    if (logFilter === "WORKER" && log.type === "worker") return true;
    if (logFilter === "PROMPTS" && log.type === "prompt") return true;
    if (logFilter === "RAW_LLM" && log.type === "token") return true;
    if (logFilter === "DB_COMMITS" && (log.type === "db" || log.type === "schema")) return true;
    return false;
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Top Controls & View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-800 pb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveView("staging_tables")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              activeView === "staging_tables"
                ? "bg-cyan-600 text-white font-semibold shadow-md"
                : "bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800"
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            Organized Staging Data (Canon Lake)
          </button>
          <button
            onClick={() => setActiveView("terminal")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              activeView === "terminal"
                ? "bg-cyan-600 text-white font-semibold shadow-md"
                : "bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Live Story Brain Streaming Terminal
          </button>
        </div>

        {/* Telemetry Metrics & Action Button */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-neutral-950 px-3 py-1.5 rounded-lg border border-neutral-800 text-[11px] font-mono">
            <span className="text-neutral-500">Speed:</span>
            <span className="text-cyan-400 font-bold">{extractionSpeed.toFixed(1)} tok/s</span>
            <span className="text-neutral-600">|</span>
            <span className="text-neutral-500">Tokens:</span>
            <span className="text-emerald-400 font-bold">{extractedTokensCount}</span>
          </div>

          <button
            onClick={onStartExtraction}
            disabled={isExtracting}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md transition-all disabled:opacity-50"
          >
            {isExtracting ? (
              <>
                <Zap className="w-3.5 h-3.5 animate-spin text-amber-300" />
                Extracting Chapter...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Trigger Story Brain Pass
              </>
            )}
          </button>
        </div>
      </div>

      {/* VIEW 1: ORGANIZED STAGING DATA TABLES */}
      {activeView === "staging_tables" && (
        <div className="flex flex-col gap-6">
          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-900/60 p-2.5 rounded-xl border border-neutral-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {([
                { id: "all", label: "All Entities", icon: Layers },
                { id: "characters", label: "Characters", icon: User },
                { id: "costumes", label: "Clothes & Armor", icon: Shirt },
                { id: "locations", label: "Locations", icon: MapPin },
                { id: "environments", label: "Atmosphere & Light", icon: CloudSun },
                { id: "beats", label: "Discourse Beats", icon: Activity },
              ] as const).map((cat) => {
                const Icon = cat.icon;
                const isSelected = entityCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setEntityCategory(cat.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-neutral-800 text-cyan-400 font-semibold border border-neutral-700 shadow-sm"
                        : "text-neutral-400 hover:text-white hover:bg-neutral-800/40"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {cat.label}
                  </button>
                );
              })}
            </div>

            {/* Quick Action Handlers to Downstream Agents */}
            <div className="flex items-center gap-2">
              {onProceedToRAG && (
                <button
                  onClick={onProceedToRAG}
                  className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-violet-300 text-xs font-medium flex items-center gap-1 border border-neutral-700 transition-all"
                >
                  Send to Lore RAG
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
              {onProceedToFoundry && (
                <button
                  onClick={onProceedToFoundry}
                  className="px-3 py-1.5 rounded-lg bg-amber-600/90 hover:bg-amber-500 text-white text-xs font-medium flex items-center gap-1 transition-all shadow-md"
                >
                  Send to Foundry Bible
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Staging Entity Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* 1. Characters Card */}
            {(entityCategory === "all" || entityCategory === "characters") && (
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                  <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                    <User className="w-4 h-4 text-cyan-400" />
                    Staged Characters
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold">
                    {stagedScene?.characters.length || 0} Found
                  </span>
                </div>

                <div className="flex flex-col gap-2 max-h-[350px] overflow-y-auto pr-1">
                  {stagedScene?.characters && stagedScene.characters.length > 0 ? (
                    stagedScene.characters.map((char) => (
                      <div
                        key={char.id}
                        className="p-3 rounded-lg bg-neutral-950 border border-neutral-800/80 flex flex-col gap-1 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-white">{char.rawName}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                            {char.tier}
                          </span>
                        </div>
                        {char.emotionalState && (
                          <div className="text-[11px] text-neutral-400">
                            <span className="text-neutral-500">Emotion:</span> {char.emotionalState}
                          </div>
                        )}
                        {char.physicalCondition && (
                          <div className="text-[11px] text-neutral-400">
                            <span className="text-neutral-500">Condition:</span> {char.physicalCondition}
                          </div>
                        )}
                        {char.activePosture && (
                          <div className="text-[11px] text-neutral-400">
                            <span className="text-neutral-500">Posture:</span> {char.activePosture}
                          </div>
                        )}
                      </div>
                    ))
                  ) : extractionSummary?.persisted_nodes ? (
                    extractionSummary.persisted_nodes.map((node, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-bold text-white flex items-center gap-1.5">
                            {node.canonical_name}
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                              {node.node_code}
                            </span>
                          </div>
                          <div className="text-[10px] text-neutral-400 font-mono">
                            Category: {node.category}
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono border border-emerald-500/30">
                          Active
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-xs text-neutral-500">
                      No characters staged yet. Run the extraction pass above.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 2. Costumes & Armor Card */}
            {(entityCategory === "all" || entityCategory === "costumes") && (
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                  <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                    <Shirt className="w-4 h-4 text-amber-400" />
                    Staged Clothes & Equipment
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold">
                    Costume Loadouts
                  </span>
                </div>

                <div className="flex flex-col gap-2 max-h-[350px] overflow-y-auto pr-1">
                  {stagedScene?.characters.some((c) => c.costumes.length > 0) ? (
                    stagedScene.characters.flatMap((c) =>
                      c.costumes.map((costume) => (
                        <div
                          key={costume.id}
                          className="p-3 rounded-lg bg-neutral-950 border border-neutral-800/80 flex flex-col gap-1.5 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-amber-300">{c.rawName} Loadout</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono">
                              {costume.wearTearLevel}
                            </span>
                          </div>
                          {costume.upperBody && (
                            <div className="text-[11px] text-neutral-300">
                              <span className="text-neutral-500">Upper:</span> {costume.upperBody}
                            </div>
                          )}
                          {costume.lowerBody && (
                            <div className="text-[11px] text-neutral-300">
                              <span className="text-neutral-500">Lower:</span> {costume.lowerBody}
                            </div>
                          )}
                          {costume.equippedWeapon && (
                            <div className="text-[11px] text-rose-300 font-mono">
                              <span className="text-neutral-500">Weapon:</span> {costume.equippedWeapon}
                            </div>
                          )}
                        </div>
                      ))
                    )
                  ) : (
                    <div className="p-4 text-center text-xs text-neutral-500">
                      No wardrobe/armor extracted yet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. Locations Card */}
            {(entityCategory === "all" || entityCategory === "locations") && (
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                  <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-emerald-400" />
                    Staged Locations
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                    {stagedScene?.locations.length || 0} Active
                  </span>
                </div>

                <div className="flex flex-col gap-2 max-h-[350px] overflow-y-auto pr-1">
                  {stagedScene?.locations && stagedScene.locations.length > 0 ? (
                    stagedScene.locations.map((loc) => (
                      <div
                        key={loc.id}
                        className="p-3 rounded-lg bg-neutral-950 border border-neutral-800/80 flex flex-col gap-1 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-white">{loc.locationName}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                            {loc.category}
                          </span>
                        </div>
                        {loc.architecturalStyle && (
                          <div className="text-[11px] text-neutral-400">
                            <span className="text-neutral-500">Style:</span> {loc.architecturalStyle}
                          </div>
                        )}
                        {loc.keyLandmarks && loc.keyLandmarks.length > 0 && (
                          <div className="text-[11px] text-neutral-400">
                            <span className="text-neutral-500">Landmarks:</span> {loc.keyLandmarks.join(", ")}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-xs text-neutral-500">
                      No location bounds staged yet.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: STREAMING TERMINAL */}
      {activeView === "terminal" && (
        <div className="flex flex-col gap-3 p-5 rounded-2xl bg-neutral-900/60 border border-neutral-800">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white">Streaming Logs</span>
              <div className="flex items-center gap-1">
                {(["ALL", "WORKER", "PROMPTS", "RAW_LLM", "DB_COMMITS"] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setLogFilter(filter)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all ${
                      logFilter === filter
                        ? "bg-neutral-800 text-cyan-400 font-bold border border-neutral-700"
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[10px] font-mono text-neutral-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded border-neutral-800 bg-neutral-950 text-cyan-500"
                />
                Auto-scroll
              </label>
            </div>
          </div>

          <div
            ref={terminalContainerRef}
            className="h-[450px] overflow-y-auto bg-neutral-950 p-4 rounded-xl border border-neutral-800 font-mono text-xs text-neutral-300 flex flex-col gap-1.5 select-text"
          >
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log, idx) => (
                <div key={idx} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-neutral-600 shrink-0 text-[10px]">{log.timestamp}</span>
                  <span
                    className={`shrink-0 text-[10px] px-1 rounded ${
                      log.type === "worker"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : log.type === "prompt"
                        ? "bg-indigo-500/20 text-indigo-400"
                        : log.type === "schema"
                        ? "bg-cyan-500/20 text-cyan-400"
                        : log.type === "db"
                        ? "bg-amber-500/20 text-amber-400"
                        : "text-neutral-300"
                    }`}
                  >
                    [{log.type.toUpperCase()}]
                  </span>
                  <span className="whitespace-pre-wrap">{log.text}</span>
                </div>
              ))
            ) : (
              <div className="text-neutral-600 italic">Terminal ready. Trigger extraction to monitor live tokens...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
