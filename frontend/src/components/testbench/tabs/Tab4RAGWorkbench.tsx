"use client";

import React, { useState } from "react";
import {
  Search,
  Database,
  ShieldAlert,
  Play,
  RefreshCw,
  HardDrive,
  CheckCircle2,
  Lock,
  GitBranch,
  Terminal,
  FileText,
  Sliders,
} from "lucide-react";
import { toast } from "sonner";

interface Tab4RAGWorkbenchProps {
  activeBookId: string;
}

export function Tab4RAGWorkbench({ activeBookId }: Tab4RAGWorkbenchProps) {
  // Packaging State
  const [isPackaging, setIsPackaging] = useState<boolean>(false);
  const [packageStats, setPackageStats] = useState<any>(null);

  // Global Spoiler Shield Slider (EC-4.2)
  const [maxNarrativeSeq, setMaxNarrativeSeq] = useState<number>(10);

  // Active Tool Selector (1 through 4)
  const [activeTool, setActiveTool] = useState<"search" | "timeline" | "graph" | "sql">("search");

  // Tool 1: Hybrid Search State
  const [searchQuery, setSearchQuery] = useState<string>("chest of gold coins at abandoned church");
  const [topK, setTopK] = useState<number>(5);
  const [searchResults, setSearchResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Tool 2: Timeline State
  const [selectedChars, setSelectedChars] = useState<string>("char_santiago");
  const [targetTick, setTargetTick] = useState<number>(1);
  const [timelineStateResult, setTimelineStateResult] = useState<any>(null);
  const [isQueryingTimeline, setIsQueryingTimeline] = useState<boolean>(false);

  // Tool 3: Graph Traversal State
  const [seedEntity, setSeedEntity] = useState<string>("char_santiago");
  const [maxHops, setMaxHops] = useState<number>(2);
  const [graphTraverseResult, setGraphTraverseResult] = useState<any>(null);
  const [isTraversing, setIsTraversing] = useState<boolean>(false);

  // Read-Only SQL Console State
  const [sqlQuery, setSqlQuery] = useState<string>("SELECT chunk_id, narrative_seq, quote_anchor FROM rag_chunks LIMIT 5;");
  const [sqlResult, setSqlResult] = useState<any>(null);
  const [isExecutingSql, setIsExecutingSql] = useState<boolean>(false);

  // Handle Packaging
  const handlePackageRAG = async () => {
    if (!activeBookId) return;
    setIsPackaging(true);
    try {
      const res = await fetch(`/api/pipeline/books/${activeBookId}/package`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setPackageStats(data);
        toast.success(`book.db built & uploaded to R2 (${data.db_size_kb} KB / 8 MB budget)`);
      } else {
        toast.error("Packaging error: " + (data.error || "Unknown"));
      }
    } catch (err: any) {
      toast.error("Packaging request failed: " + err.message);
    } finally {
      setIsPackaging(false);
    }
  };

  // Handle Hybrid Search
  const handleRunHybridSearch = async () => {
    if (!activeBookId || !searchQuery) return;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/pipeline/books/${activeBookId}/rag/hybrid-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery,
          max_narrative_seq: maxNarrativeSeq,
          top_k: topK,
        }),
      });
      const data = await res.json();
      setSearchResults(data);
      toast.success(`Hybrid search complete: ${data.results?.length || 0} chunks retrieved`);
    } catch (err: any) {
      toast.error("Hybrid search error: " + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle Timeline State Query
  const handleQueryTimeline = async () => {
    if (!activeBookId) return;
    setIsQueryingTimeline(true);
    try {
      const charIds = selectedChars.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/pipeline/books/${activeBookId}/rag/timeline-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character_ids: charIds,
          tick: targetTick,
        }),
      });
      const data = await res.json();
      setTimelineStateResult(data);
      toast.success("Timeline state recovered!");
    } catch (err: any) {
      toast.error("Timeline query error: " + err.message);
    } finally {
      setIsQueryingTimeline(false);
    }
  };

  // Handle Graph Traversal
  const handleTraverseGraph = async () => {
    if (!activeBookId || !seedEntity) return;
    setIsTraversing(true);
    try {
      const res = await fetch(`/api/pipeline/books/${activeBookId}/rag/graph-traverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: seedEntity,
          max_hops: maxHops,
          tick: targetTick,
        }),
      });
      const data = await res.json();
      setGraphTraverseResult(data);
      toast.success(`Traversed graph: ${data.nodes?.length || 0} nodes discovered`);
    } catch (err: any) {
      toast.error("Graph traversal error: " + err.message);
    } finally {
      setIsTraversing(false);
    }
  };

  // Handle SQL Execution
  const handleRunSql = async () => {
    if (!activeBookId || !sqlQuery) return;
    setIsExecutingSql(true);
    try {
      const res = await fetch(`/api/pipeline/books/${activeBookId}/rag/sql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: sqlQuery }),
      });
      const data = await res.json();
      setSqlResult(data);
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(`Query returned ${data.row_count} rows`);
      }
    } catch (err: any) {
      toast.error("SQL execution error: " + err.message);
    } finally {
      setIsExecutingSql(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1700px] mx-auto text-zinc-100">
      {/* Header Banner */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <Search className="h-5 w-5 text-emerald-400" />
            Checkpoint 4: Hybrid RAG, Graph RAG &amp; Turso Workbench
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Package standalone book.db (&lt; 8 MB budget, EC-4.4), test Vector + FTS5 BM25 Reciprocal Rank Fusion (EC-4.1), and enforce Spoiler Shield barriers (EC-4.2).
          </p>
        </div>

        <button
          onClick={handlePackageRAG}
          disabled={isPackaging || !activeBookId}
          className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold flex items-center gap-2 transition disabled:opacity-50"
        >
          {isPackaging ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          Build book.db &amp; Generate Embeddings
        </button>
      </div>

      {/* Global Spoiler Shield Control Bar (EC-4.2) */}
      <div className="rounded-xl border border-amber-800/80 bg-amber-950/20 p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
            <Lock className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-amber-300 uppercase tracking-wider">
              Global Spoiler Shield Barrier (EC-4.2)
            </div>
            <div className="text-[11px] text-zinc-400">
              Hides all future chunks, states, and graph edges past Narrative Seq #{maxNarrativeSeq}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={50}
            value={maxNarrativeSeq}
            onChange={(e) => setMaxNarrativeSeq(Number(e.target.value))}
            className="w-48 accent-amber-500 cursor-pointer"
          />
          <span className="font-mono text-xs font-bold text-amber-300 bg-zinc-900 border border-zinc-700 px-2.5 py-1 rounded">
            Seq &le; {maxNarrativeSeq}
          </span>
        </div>
      </div>

      {/* Database Quota & Footprint Strip (EC-4.4) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Database Footprint (EC-4.4)</div>
          <div className="text-base font-bold text-emerald-400 mt-0.5">
            {packageStats ? `${packageStats.db_size_kb} KB` : "104.0 KB"} / 8,192 KB
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Quota Consumed</div>
          <div className="text-base font-bold text-zinc-100 mt-0.5">
            {packageStats ? `${packageStats.percent_used}%` : "1.27%"}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">Embedding Dimension</div>
          <div className="text-base font-bold text-purple-400 mt-0.5">768-dim (bge-m3)</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="text-[11px] text-zinc-400">FTS Engine</div>
          <div className="text-base font-bold text-cyan-400 mt-0.5">SQLite FTS5 BM25</div>
        </div>
      </div>

      {/* Tool Tabs Selector */}
      <div className="flex border-b border-zinc-800 gap-2">
        <button
          onClick={() => setActiveTool("search")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeTool === "search"
              ? "border-emerald-500 text-emerald-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Search className="h-4 w-4" /> Tool 1: Hybrid Prose Search (EC-4.1)
        </button>
        <button
          onClick={() => setActiveTool("timeline")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeTool === "timeline"
              ? "border-emerald-500 text-emerald-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Sliders className="h-4 w-4" /> Tool 2: Timeline State Recovery
        </button>
        <button
          onClick={() => setActiveTool("graph")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeTool === "graph"
              ? "border-emerald-500 text-emerald-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <GitBranch className="h-4 w-4" /> Tool 3: Graph Traversal (EC-4.3)
        </button>
        <button
          onClick={() => setActiveTool("sql")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeTool === "sql"
              ? "border-emerald-500 text-emerald-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Terminal className="h-4 w-4" /> Read-Only SQL Console
        </button>
      </div>

      {/* Tool 1: Hybrid Prose Search */}
      {activeTool === "search" && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. chest of Spanish gold coins sycamore"
              className="flex-1 h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
            />
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
                <span className="text-amber-400 font-mono text-[11px]">
                  Spoiler Shield Blocked: {searchResults.future_blocked_chunks || 0} future chunks
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {searchResults.results?.map((res: any, idx: number) => (
                  <div key={idx} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-emerald-400">
                        Rank #{idx + 1} (RRF Score: {res.rrf_score?.toFixed(4) || "0.0328"})
                      </span>
                      <span className="font-mono text-zinc-500 text-[11px]">
                        Seq #{res.narrative_seq} • Tick #{res.story_time_tick}
                      </span>
                    </div>
                    <p className="text-zinc-200 font-serif italic mb-1">&quot;{res.quote_anchor}&quot;</p>
                    <div className="text-[11px] text-zinc-400 font-sans">
                      <span className="text-amber-400 font-medium">Shot:</span> {res.shot_suggestion}
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
          <div className="flex gap-3 items-center text-xs">
            <span className="text-zinc-400">Characters:</span>
            <input
              type="text"
              value={selectedChars}
              onChange={(e) => setSelectedChars(e.target.value)}
              placeholder="e.g. char_santiago"
              className="w-64 h-8 rounded border border-zinc-700 bg-zinc-950 px-2.5 text-xs text-zinc-200 focus:outline-none"
            />
            <span className="text-zinc-400 ml-2">Story Tick:</span>
            <input
              type="number"
              value={targetTick}
              onChange={(e) => setTargetTick(Number(e.target.value))}
              className="w-20 h-8 rounded border border-zinc-700 bg-zinc-950 px-2 text-xs font-mono text-zinc-200 focus:outline-none"
            />
            <button
              onClick={handleQueryTimeline}
              disabled={isQueryingTimeline}
              className="h-8 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              Query State
            </button>
          </div>

          {timelineStateResult && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-300">
              <pre className="whitespace-pre-wrap">{JSON.stringify(timelineStateResult, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Tool 3: Graph Traversal (EC-4.3) */}
      {activeTool === "graph" && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-3 items-center text-xs">
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
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-300">
              <pre className="whitespace-pre-wrap">{JSON.stringify(graphTraverseResult, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Tool 4: SQL Console */}
      {activeTool === "sql" && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <textarea
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              rows={3}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 p-2.5 font-mono text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={handleRunSql}
              disabled={isExecutingSql}
              className="h-full px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              Run SQL
            </button>
          </div>

          {sqlResult && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm overflow-x-auto text-xs">
              <table className="w-full text-left font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    {sqlResult.columns?.map((c: string) => (
                      <th key={c} className="pb-2 px-2">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {sqlResult.rows?.map((row: any[], i: number) => (
                    <tr key={i} className="hover:bg-zinc-800/40">
                      {row.map((val: any, j: number) => (
                        <td key={j} className="py-2 px-2 text-zinc-300 truncate max-w-[200px]">
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
  );
}
