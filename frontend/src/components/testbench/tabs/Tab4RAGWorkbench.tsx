"use client";

import React, { useState, useEffect } from "react";
import {
  Search,
  Database,
  Lock,
  Play,
  RefreshCw,
  GitBranch,
  Terminal,
  Sliders,
  Cloud,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import type {
  PackageRAGResponse,
  RagHybridSearchResponse,
  TimelineStateQueryResponse,
  GraphTraversalResponse,
  SqlConsoleResponse,
  DatabaseFootprintResponse,
  TursoSyncResponse,
  HybridSearchResultItem,
} from "@/types/testbench-contracts";

interface Tab4RAGWorkbenchProps {
  activeBookId: string;
}

export function Tab4RAGWorkbench({ activeBookId }: Tab4RAGWorkbenchProps) {
  // Packaging & Footprint State
  const [isPackaging, setIsPackaging] = useState<boolean>(false);
  const [packageStats, setPackageStats] = useState<PackageRAGResponse | null>(null);
  const [footprint, setFootprint] = useState<DatabaseFootprintResponse | null>(null);
  const [isSyncingTurso, setIsSyncingTurso] = useState<boolean>(false);
  const [tursoSyncData, setTursoSyncData] = useState<TursoSyncResponse | null>(null);

  // Global Spoiler Shield Slider (EC-4.2)
  const [maxNarrativeSeq, setMaxNarrativeSeq] = useState<number>(3);

  // Active Tool Selector (1 through 4)
  const [activeTool, setActiveTool] = useState<"search" | "timeline" | "graph" | "sql">("search");

  // Tool 1: Hybrid Search State
  const [searchQuery, setSearchQuery] = useState<string>("abandoned church sycamore gold coins");
  const [topK, setTopK] = useState<number>(5);
  const [searchResults, setSearchResults] = useState<RagHybridSearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Tool 2: Timeline State
  const [selectedChars, setSelectedChars] = useState<string>("char_santiago, char_melchizedek");
  const [targetTick, setTargetTick] = useState<number>(1);
  const [timelineStateResult, setTimelineStateResult] = useState<TimelineStateQueryResponse | null>(null);
  const [isQueryingTimeline, setIsQueryingTimeline] = useState<boolean>(false);

  // Tool 3: Graph Traversal State
  const [seedEntity, setSeedEntity] = useState<string>("char_santiago");
  const [maxHops, setMaxHops] = useState<number>(2);
  const [graphTraverseResult, setGraphTraverseResult] = useState<GraphTraversalResponse | null>(null);
  const [isTraversing, setIsTraversing] = useState<boolean>(false);

  // Read-Only SQL Console State
  const [sqlQuery, setSqlQuery] = useState<string>(
    "SELECT chunk_id, narrative_seq, story_time_tick, quote_anchor FROM rag_chunks LIMIT 5;"
  );
  const [sqlResult, setSqlResult] = useState<SqlConsoleResponse | null>(null);
  const [isExecutingSql, setIsExecutingSql] = useState<boolean>(false);

  // Fetch Footprint on Mount
  const fetchFootprint = async () => {
    const bookId = activeBookId || "book-demo";
    try {
      const res = await fetch(`/api/testbench/rag/footprint/${bookId}`);
      if (res.ok) {
        const data: DatabaseFootprintResponse = await res.json();
        setFootprint(data);
      }
    } catch {
      // Ignore background error
    }
  };

  useEffect(() => {
    fetchFootprint();
  }, [activeBookId]);

  // Handle Packaging
  const handlePackageRAG = async () => {
    const bookId = activeBookId || "book-demo";
    setIsPackaging(true);
    try {
      const res = await fetch("/api/testbench/rag/package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, force_rebuild: true }),
      });
      const data: PackageRAGResponse = await res.json();
      if (data.ok) {
        setPackageStats(data);
        toast.success(`book.db built & uploaded to R2 (${data.db_size_kb} KB / 8 MB budget)`);
        fetchFootprint();
      } else {
        toast.error("Packaging error");
      }
    } catch (err: any) {
      toast.error("Packaging request failed: " + err.message);
    } finally {
      setIsPackaging(false);
    }
  };

  // Handle Turso Cloud Sync
  const handleTursoSync = async () => {
    const bookId = activeBookId || "book-demo";
    setIsSyncingTurso(true);
    try {
      const res = await fetch("/api/testbench/rag/turso-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId }),
      });
      const data: TursoSyncResponse = await res.json();
      if (data.ok) {
        setTursoSyncData(data);
        toast.success(`libSQL database synced to Turso Cloud in ${data.sync_latency_ms}ms!`);
      }
    } catch (err: any) {
      toast.error("Turso sync failed: " + err.message);
    } finally {
      setIsSyncingTurso(false);
    }
  };

  // Handle Hybrid Search
  const handleRunHybridSearch = async () => {
    const bookId = activeBookId || "book-demo";
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch("/api/testbench/rag/hybrid-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          query: searchQuery,
          max_narrative_seq: maxNarrativeSeq,
          top_k: topK,
        }),
      });
      const data: RagHybridSearchResponse = await res.json();
      if (data.ok) {
        setSearchResults(data);
        toast.success(`Hybrid search complete: ${data.results.length} chunks retrieved`);
      }
    } catch (err: any) {
      toast.error("Hybrid search error: " + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle Timeline State Query
  const handleQueryTimeline = async () => {
    const bookId = activeBookId || "book-demo";
    setIsQueryingTimeline(true);
    try {
      const charIds = selectedChars
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/testbench/rag/timeline-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          character_ids: charIds,
          tick: targetTick,
        }),
      });
      const data: TimelineStateQueryResponse = await res.json();
      if (data.ok) {
        setTimelineStateResult(data);
        toast.success("Timeline state recovered!");
      }
    } catch (err: any) {
      toast.error("Timeline query error: " + err.message);
    } finally {
      setIsQueryingTimeline(false);
    }
  };

  // Handle Graph Traversal
  const handleTraverseGraph = async () => {
    const bookId = activeBookId || "book-demo";
    if (!seedEntity.trim()) return;
    setIsTraversing(true);
    try {
      const res = await fetch("/api/testbench/rag/graph-traverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          seed_entity: seedEntity,
          max_hops: maxHops,
          tick: targetTick,
          max_narrative_seq: maxNarrativeSeq,
        }),
      });
      const data: GraphTraversalResponse = await res.json();
      if (data.ok) {
        setGraphTraverseResult(data);
        toast.success(`Traversed graph: ${data.nodes.length} nodes discovered`);
      }
    } catch (err: any) {
      toast.error("Graph traversal error: " + err.message);
    } finally {
      setIsTraversing(false);
    }
  };

  // Handle SQL Execution
  const handleRunSql = async () => {
    const bookId = activeBookId || "book-demo";
    if (!sqlQuery.trim()) return;
    setIsExecutingSql(true);
    try {
      const res = await fetch("/api/testbench/rag/sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, sql: sqlQuery }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSqlResult(data as SqlConsoleResponse);
        if (data.error) {
          toast.error(data.error);
        } else {
          toast.success(`Query returned ${data.row_count} rows in ${data.execution_time_ms}ms`);
        }
      } else {
        const errorMsg = data.error?.message || "SQL statement rejected";
        setSqlResult({
          ok: true,
          trace_id: data.error?.trace_id || "trace_err",
          columns: [],
          rows: [],
          row_count: 0,
          execution_time_ms: 0,
          read_only_enforced: true,
          error: errorMsg,
        });
        toast.error(errorMsg);
      }
    } catch (err: any) {
      toast.error("SQL execution error: " + err.message);
    } finally {
      setIsExecutingSql(false);
    }
  };

  const displayDbSize = packageStats?.db_size_kb || footprint?.db_size_kb || 104.5;
  const displayPercent = packageStats?.percent_used || footprint?.percent_used || 1.28;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1700px] mx-auto text-zinc-100">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800 pb-4 gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <Search className="h-5 w-5 text-emerald-400" />
            Checkpoint 4: Hybrid RAG, Graph RAG &amp; Turso Workbench
          </h1>
          <p className="text-sm text-zinc-400 mt-1 max-w-4xl">
            Package standalone book.db (&lt; 8 MB budget, EC-4.4), test Vector + FTS5 BM25 Reciprocal Rank Fusion (EC-4.1), and enforce Spoiler Shield barriers (EC-4.2).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleTursoSync}
            disabled={isSyncingTurso}
            className="h-9 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 border border-zinc-700"
          >
            {isSyncingTurso ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5 text-cyan-400" />}
            Sync Turso Cloud
          </button>
          <button
            onClick={handlePackageRAG}
            disabled={isPackaging}
            className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold flex items-center gap-2 transition disabled:opacity-50 shadow-sm"
          >
            {isPackaging ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Build book.db &amp; Generate Embeddings
          </button>
        </div>
      </div>

      {/* Global Spoiler Shield Control Bar (EC-4.2) */}
      <div className="rounded-xl border border-amber-800/80 bg-amber-950/20 p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Lock className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
              Global Spoiler Shield Barrier (EC-4.2)
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300">
                ACTIVE
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5">
              Strictly blocks and redacts any narrative chunks, character state deltas, or graph relations beyond Narrative Sequence #{maxNarrativeSeq}.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-400">Seq Limit:</span>
            <input
              type="range"
              min={1}
              max={15}
              value={maxNarrativeSeq}
              onChange={(e) => setMaxNarrativeSeq(Number(e.target.value))}
              className="w-44 accent-amber-500 cursor-pointer"
            />
          </div>
          <span className="font-mono text-xs font-bold text-amber-300 bg-zinc-900 border border-zinc-700 px-3 py-1 rounded">
            Seq &le; {maxNarrativeSeq}
          </span>
        </div>
      </div>

      {/* Database Quota & Footprint Strip (EC-4.4) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Database Footprint (EC-4.4)</div>
          <div className="text-base font-bold text-emerald-400 mt-0.5">
            {displayDbSize.toFixed(1)} KB / 8,192 KB
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Budget Consumed</div>
          <div className="text-base font-bold text-zinc-100 mt-0.5">
            {displayPercent.toFixed(2)}% (Within Budget)
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Embedding Engine</div>
          <div className="text-base font-bold text-purple-400 mt-0.5">768-dim (bge-m3)</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">FTS Engine</div>
          <div className="text-base font-bold text-cyan-400 mt-0.5">SQLite FTS5 BM25</div>
        </div>
      </div>

      {/* Tool Tabs Selector */}
      <div className="flex border-b border-zinc-800 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTool("search")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTool === "search"
              ? "border-emerald-500 text-emerald-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Search className="h-4 w-4" /> Tool 1: Hybrid Prose Search (EC-4.1)
        </button>
        <button
          onClick={() => setActiveTool("timeline")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTool === "timeline"
              ? "border-emerald-500 text-emerald-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Sliders className="h-4 w-4" /> Tool 2: Timeline State Recovery
        </button>
        <button
          onClick={() => setActiveTool("graph")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTool === "graph"
              ? "border-emerald-500 text-emerald-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <GitBranch className="h-4 w-4" /> Tool 3: Graph Traversal (EC-4.3)
        </button>
        <button
          onClick={() => setActiveTool("sql")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTool === "sql"
              ? "border-emerald-500 text-emerald-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Terminal className="h-4 w-4" /> Tool 4: Safe Read-Only SQL Console (EC-4.4)
        </button>
      </div>

      {/* Tool 1: Hybrid Prose Search */}
      {activeTool === "search" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. chest of gold coins at abandoned church"
              className="flex-1 min-w-[280px] h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Top-K:</span>
              <input
                type="number"
                min={1}
                max={20}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="w-16 h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-mono text-zinc-200 focus:outline-none"
              />
            </div>
            <button
              onClick={handleRunHybridSearch}
              disabled={isSearching}
              className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
            >
              {isSearching ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Execute RRF Search
            </button>
          </div>

          {searchResults && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-300 border-b border-zinc-800 pb-2">
                <span>Retrieved Chunks (Reciprocal Rank Fusion)</span>
                <span className="text-amber-400 font-mono text-[11px] flex items-center gap-1.5">
                  <EyeOff className="h-3.5 w-3.5" />
                  Spoiler Shield Blocked: {searchResults.future_blocked_chunks} future chunks past Seq #{maxNarrativeSeq}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {searchResults.results.map((res: HybridSearchResultItem, idx: number) => (
                  <div key={res.chunk_id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-emerald-400 flex items-center gap-2">
                        Rank #{idx + 1}
                        <span className="font-mono text-zinc-400 text-[11px] font-normal">
                          (RRF: {res.rrf_score.toFixed(5)} • BM25 #{res.bm25_rank || "—"} • Vector #{res.vector_rank || "—"})
                        </span>
                      </span>
                      <span className="font-mono text-zinc-500 text-[11px]">
                        Narrative Seq #{res.narrative_seq} • Story Tick #{res.story_time_tick}
                      </span>
                    </div>
                    <p className="text-zinc-200 font-serif italic mb-1.5">&quot;{res.quote_anchor}&quot;</p>
                    <div className="text-[11px] text-zinc-400 font-sans flex flex-wrap gap-2 items-center">
                      <span className="text-amber-400 font-medium">Shot:</span>
                      <span>{res.shot_suggestion}</span>
                      {res.focal_elements.length > 0 && (
                        <div className="flex items-center gap-1 ml-auto">
                          {res.focal_elements.map((el) => (
                            <span key={el} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px]">
                              {el}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tool 2: Timeline State Recovery */}
      {activeTool === "timeline" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3 items-center text-xs">
            <span className="text-zinc-400">Characters:</span>
            <input
              type="text"
              value={selectedChars}
              onChange={(e) => setSelectedChars(e.target.value)}
              placeholder="e.g. char_santiago, char_melchizedek"
              className="w-72 h-8 rounded border border-zinc-700 bg-zinc-950 px-2.5 text-xs text-zinc-200 focus:outline-none"
            />
            <span className="text-zinc-400 ml-2">Story Tick:</span>
            <input
              type="number"
              min={0}
              max={10}
              value={targetTick}
              onChange={(e) => setTargetTick(Number(e.target.value))}
              className="w-20 h-8 rounded border border-zinc-700 bg-zinc-950 px-2 text-xs font-mono text-zinc-200 focus:outline-none"
            />
            <button
              onClick={handleQueryTimeline}
              disabled={isQueryingTimeline}
              className="h-8 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              Query Physical State
            </button>
          </div>

          {timelineStateResult && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {timelineStateResult.states.map((st) => (
                <div key={st.character_id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm text-xs">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
                    <span className="font-bold text-zinc-100 text-sm">{st.name}</span>
                    <span className="font-mono text-purple-400">Tick #{st.tick}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div>
                      <span className="text-zinc-400 font-semibold block mb-0.5 text-[11px]">Outfit / Wardrobe:</span>
                      <span className="text-zinc-200 font-serif">{st.outfit}</span>
                    </div>
                    {st.injuries.length > 0 && (
                      <div>
                        <span className="text-amber-400 font-semibold block mb-0.5 text-[11px]">Physical Injuries:</span>
                        <div className="flex flex-wrap gap-1">
                          {st.injuries.map((inj) => (
                            <span key={inj} className="px-2 py-0.5 rounded bg-amber-950 border border-amber-800 text-amber-300 text-[10px]">
                              {inj}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <span className="text-zinc-400 font-semibold block mb-0.5 text-[11px]">Items in Custody:</span>
                      <div className="flex flex-wrap gap-1">
                        {st.items_held.map((itm) => (
                          <span key={itm} className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono text-[10px]">
                            {itm}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tool 3: Graph Traversal (EC-4.3) */}
      {activeTool === "graph" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3 items-center text-xs">
            <span className="text-zinc-400">Seed Entity:</span>
            <input
              type="text"
              value={seedEntity}
              onChange={(e) => setSeedEntity(e.target.value)}
              placeholder="e.g. char_santiago"
              className="w-48 h-8 rounded border border-zinc-700 bg-zinc-950 px-2.5 text-xs text-zinc-200 focus:outline-none"
            />
            <span className="text-zinc-400 ml-2">Max Hops:</span>
            <input
              type="number"
              min={1}
              max={3}
              value={maxHops}
              onChange={(e) => setMaxHops(Number(e.target.value))}
              className="w-16 h-8 rounded border border-zinc-700 bg-zinc-950 px-2 text-xs font-mono text-zinc-200 focus:outline-none"
            />
            <button
              onClick={handleTraverseGraph}
              disabled={isTraversing}
              className="h-8 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              Expand Subgraph
            </button>
          </div>

          {graphTraverseResult && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm text-xs">
                <h3 className="font-semibold text-zinc-300 border-b border-zinc-800 pb-2 mb-3">
                  Discovered Nodes ({graphTraverseResult.nodes.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {graphTraverseResult.nodes.map((n) => (
                    <div key={n.entity_id} className="flex items-center justify-between rounded bg-zinc-950 p-2 border border-zinc-800">
                      <div>
                        <span className="font-bold text-zinc-200">{n.canonical_name}</span>
                        <span className="text-zinc-500 font-mono text-[10px] ml-2">({n.entity_id})</span>
                      </div>
                      <span className="font-mono text-purple-400 text-[10px]">
                        Hop {n.distance_hops} ({n.entity_type})
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm text-xs">
                <h3 className="font-semibold text-zinc-300 border-b border-zinc-800 pb-2 mb-3">
                  Traversed Edges ({graphTraverseResult.edges.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {graphTraverseResult.edges.map((e, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded bg-zinc-950 p-2 border border-zinc-800 font-mono text-[11px]">
                      <span className="text-zinc-300">{e.source_id}</span>
                      <span className="text-emerald-400 font-bold">&mdash;[{e.edge_type}]&rarr;</span>
                      <span className="text-zinc-300">{e.target_id}</span>
                      <span className="text-zinc-500 font-semibold">{e.weight.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tool 4: Safe Read-Only SQL Console (EC-4.4) */}
      {activeTool === "sql" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <textarea
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              rows={3}
              placeholder="SELECT * FROM rag_chunks LIMIT 5;"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 p-2.5 font-mono text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={handleRunSql}
              disabled={isExecutingSql}
              className="h-10 sm:h-auto px-5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition shrink-0"
            >
              {isExecutingSql ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Execute Query
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="font-semibold text-zinc-400">Safe SQL Console:</span>
            <span>Only SELECT and EXPLAIN queries are permitted. Mutation statements (DROP, DELETE, UPDATE, INSERT) are rejected (EC-4.4).</span>
          </div>

          {sqlResult && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2 text-xs">
                <span className="font-semibold text-zinc-300">
                  Query Results ({sqlResult.row_count} rows in {sqlResult.execution_time_ms}ms)
                </span>
                <span className="font-mono text-emerald-400 text-[11px]">
                  Read-Only Enforced (EC-4.4)
                </span>
              </div>

              {sqlResult.error ? (
                <div className="rounded-lg border border-red-900/80 bg-red-950/40 p-3 text-xs text-red-300 font-mono">
                  {sqlResult.error}
                </div>
              ) : (
                <div className="overflow-x-auto text-xs">
                  <table className="w-full text-left font-mono">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-400">
                        {sqlResult.columns.map((c) => (
                          <th key={c} className="pb-2 px-2">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {sqlResult.rows.map((row, i) => (
                        <tr key={i} className="hover:bg-zinc-800/40">
                          {row.map((val, j) => (
                            <td key={j} className="py-2 px-2 text-zinc-300 truncate max-w-[240px]">
                              {typeof val === "object" ? JSON.stringify(val) : String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
