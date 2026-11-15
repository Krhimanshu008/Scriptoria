"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  Play,
  Settings2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Scissors,
  Eye,
  Code,
  Search,
  BookOpen,
  Layers,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Copy,
  Check,
  Hash,
  Info,
  Sliders,
  Maximize2,
  ListTree,
  Boxes,
} from "lucide-react";
import { toast } from "sonner";
import type {
  ParserPresetsResponse,
  ParserProfile,
  ParseInspectResponse,
  DocumentNode,
  ParsedChunk,
  ParseDiagnostic,
  SpanRange,
  ApiErrorEnvelope,
} from "@/types/testbench-contracts";
import { isApiErrorEnvelope } from "@/types/testbench-contracts";

interface Tab1ParserProps {
  activeBookId: string;
}

interface ManifestSection {
  chapter_index: number;
  section_title: string;
  source_filename?: string;
  r2_key: string;
  classification: "FRONTMATTER" | "STORY" | "SPLIT_PART" | "BACKMATTER";
  word_count: number;
  char_count: number;
  scene_breaks_count: number;
  is_split_part?: boolean;
  part_index?: number;
  total_parts?: number;
}

interface Manifest {
  book_id: string;
  total_sections: number;
  total_story_chapters: number;
  sections: ManifestSection[];
}

const SAMPLE_NOVEL_CHAPTER = `# Chapter 1: The Lantern at the Gate

The cold mountain wind howled through the narrow mountain pass, whipping snow across the frozen stone ramparts. Far below, where the pines thinned against the rocky crag, a solitary lantern flickered against the darkness.

"Wait for the signal," Marcus murmured, his breath forming pale clouds in the freezing air. He gripped the hilt of his sword, listening to the silence of the valley.

<SCENE_BREAK />

Three hours later, the lantern flared twice in rapid succession.

Across the frozen lake, the riders emerged from the pine shadows. Their armor gleamed like polished obsidian under the starlight 🌟.

## Chapter 2: The Crossing

The frozen lake groaned beneath their horses' hooves. Even the horses seemed to sense the perilous thinness of the ice sheet.`;

const SAMPLE_LIGATURE_TEST = `# Chapter 1: The Alchemist's Office

The officer found the difficult manuscripts floating in the fluid. Scientific affinity and official definitions clashed with the cliffside reflections.

<SCENE_BREAK />

Launch sequence initiated: 🚀 Destination: Mars 🪐 (Alpha Centauri ✨).
Special ligatures: \uFB00 (ff), \uFB01 (fi), \uFB02 (fl), \uFB03 (ffi), \uFB04 (ffl), and \uFB05 (st).
Trailing hyphen test-
Line continues smoothly on the next paragraph.`;

export function Tab1Parser({ activeBookId }: Tab1ParserProps) {
  // Mode selection: "live-inspector" (FastAPI Endpoints) vs "book-manifest" (R2 Batch Pipeline)
  const [activeTabMode, setActiveTabMode] = useState<"live-inspector" | "book-manifest">("live-inspector");

  // --- Live Parser Inspector State ---
  const [presets, setPresets] = useState<ParserPresetsResponse | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("standard-novel");
  const [inputText, setInputText] = useState<string>(SAMPLE_NOVEL_CHAPTER);
  const [sourceName, setSourceName] = useState<string>("novel_chapter_sample.md");
  const [normalizeLigatures, setNormalizeLigatures] = useState<boolean>(true);
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [inspectResult, setInspectResult] = useState<ParseInspectResponse | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<{
    span: SpanRange;
    label: string;
    source: "ast" | "chunk" | "diagnostic";
  } | null>(null);
  const [leftSubView, setLeftSubView] = useState<"ast" | "chunks" | "diagnostics">("ast");
  const [rightSubView, setRightSubView] = useState<"highlighted" | "normalized" | "json">("highlighted");
  const [copiedTrace, setCopiedTrace] = useState<boolean>(false);

  // --- Book Manifest / Legacy Pipeline State ---
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState<boolean>(false);
  const [selectedSectionIdx, setSelectedSectionIdx] = useState<number>(1);
  const [rawMarkdown, setRawMarkdown] = useState<string>("");
  const [mdLoading, setMdLoading] = useState<boolean>(false);
  const [maxWords, setMaxWords] = useState<number>(4500);
  const [normLigatures, setNormLigatures] = useState<boolean>(true);
  const [fixHyphens, setFixHyphens] = useState<boolean>(true);
  const [skipFrontmatter, setSkipFrontmatter] = useState<boolean>(true);
  const [isBatchParsing, setIsBatchParsing] = useState<boolean>(false);

  // Reference for scrolling highlighted text into view
  const highlightRef = useRef<HTMLSpanElement | null>(null);

  // Fetch parser presets on mount
  useEffect(() => {
    async function loadPresets() {
      try {
        const res = await fetch("/api/testbench/parser/presets");
        if (!res.ok) {
          throw new Error(`Presets status: ${res.status}`);
        }
        const data = await res.json();
        if (data.ok) {
          setPresets(data);
          if (data.default_profile_id) {
            setSelectedProfileId(data.default_profile_id);
          }
        }
      } catch (err: unknown) {
        console.warn("Failed to load parser presets from FastAPI bridge:", err);
      }
    }
    loadPresets();
  }, []);

  // Run initial inspect automatically on mount so inspector is never blank
  useEffect(() => {
    handleRunInspect(SAMPLE_NOVEL_CHAPTER, "novel_chapter_sample.md", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch Manifest if activeBookId is supplied
  const fetchManifest = async () => {
    if (!activeBookId) return;
    setManifestLoading(true);
    try {
      const res = await fetch(`/api/pipeline/books/${activeBookId}/manifest`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.sections)) {
          setManifest(data);
        } else {
          setManifest({ book_id: activeBookId, total_sections: 0, total_story_chapters: 0, sections: [] });
        }
      } else {
        setManifest(null);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to fetch manifest: " + message);
    } finally {
      setManifestLoading(false);
    }
  };

  useEffect(() => {
    fetchManifest();
  }, [activeBookId]);

  // Fetch Section Markdown for active book section
  const selectedSection = manifest?.sections?.find(
    (s) => s.chapter_index === selectedSectionIdx
  ) || manifest?.sections?.[0];

  useEffect(() => {
    if (!selectedSection?.r2_key) {
      setRawMarkdown("");
      return;
    }

    const fetchMarkdown = async () => {
      setMdLoading(true);
      try {
        const res = await fetch(
          `/api/pipeline/r2/object?key=${encodeURIComponent(selectedSection.r2_key)}`
        );
        const data = await res.json();
        setRawMarkdown(data.text || "");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to load section text: " + message);
      } finally {
        setMdLoading(false);
      }
    };

    fetchMarkdown();
  }, [selectedSection?.r2_key]);

  // Run Live AST Inspector
  const handleRunInspect = async (textToInspect?: string, name?: string, lig?: boolean) => {
    const text = textToInspect !== undefined ? textToInspect : inputText;
    const sName = name !== undefined ? name : sourceName;
    const doLig = lig !== undefined ? lig : normalizeLigatures;

    if (!text.trim()) {
      toast.error("Input text cannot be empty for parser inspection.");
      return;
    }

    setIsInspecting(true);
    try {
      const res = await fetch("/api/testbench/parser/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_text: text,
          source_name: sName,
          normalize_ligatures: doLig,
          include_ast: true,
          include_chunks: true,
        }),
      });

      const data = await res.json();

      if (isApiErrorEnvelope(data)) {
        toast.error(`Parser Inspector Error [${data.error.stage}]: ${data.error.message}`);
        return;
      }

      if (data.ok) {
        setInspectResult(data);
        toast.success(
          `Inspected successfully! ${data.chapter_count} chapters, ${data.scene_count} scenes, ${data.chunks.length} chunks.`
        );
      } else {
        toast.error("Inspection failed with unknown error envelope");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Network or bridge error: " + message);
    } finally {
      setIsInspecting(false);
    }
  };

  // Copy trace ID
  const handleCopyTrace = (traceId: string) => {
    navigator.clipboard.writeText(traceId);
    setCopiedTrace(true);
    toast.success("Copied trace ID to clipboard");
    setTimeout(() => setCopiedTrace(false), 2000);
  };

  // Send section from book manifest into live inspector
  const handleSendSectionToInspector = () => {
    if (!rawMarkdown) {
      toast.error("No section markdown loaded yet.");
      return;
    }
    setInputText(rawMarkdown);
    setSourceName(selectedSection?.section_title || `Section_${selectedSectionIdx}.md`);
    setActiveTabMode("live-inspector");
    handleRunInspect(rawMarkdown, selectedSection?.section_title || `Section_${selectedSectionIdx}.md`, normalizeLigatures);
  };

  // Toggle classification in manifest
  const handleToggleClassification = async (secIndex: number) => {
    if (!manifest || !Array.isArray(manifest.sections)) return;
    const updated = { ...manifest, sections: [...manifest.sections] };
    const target = updated.sections.find((s) => s.chapter_index === secIndex);
    if (!target) return;

    target.classification = target.classification === "STORY" ? "FRONTMATTER" : "STORY";
    updated.total_story_chapters = updated.sections.filter((s) => s.classification === "STORY").length;
    setManifest(updated);

    try {
      const res = await fetch(`/api/pipeline/books/${activeBookId}/manifest`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Updated classification for Section ${secIndex} to ${target.classification}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to save updated manifest: " + message);
    }
  };

  // Render Synchronized Highlighted Markdown
  const renderSynchronizedMarkdown = (text: string) => {
    if (!text) {
      return <div className="text-zinc-500 text-xs italic p-4">No text to display.</div>;
    }

    if (!selectedSpan) {
      // Just render with scene breaks highlighted
      const parts = text.split(/(<SCENE_BREAK\s*\/>)/g);
      return (
        <div className="space-y-4 leading-relaxed font-serif text-zinc-300 text-sm">
          {parts.map((p, i) => {
            if (p.includes("<SCENE_BREAK")) {
              return (
                <div key={i} className="my-5 flex items-center justify-center">
                  <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/40 text-amber-400 font-mono text-[11px] font-semibold">
                    <Scissors className="h-3.5 w-3.5" />
                    &lt;SCENE_BREAK /&gt;
                  </div>
                </div>
              );
            }
            return (
              <p key={i} className="whitespace-pre-wrap">
                {p}
              </p>
            );
          })}
        </div>
      );
    }

    // Cut exact UTF-16 code unit slices: client string.slice matches backend utf16_start/utf16_end
    const { utf16_start, utf16_end } = selectedSpan.span;
    const clampedStart = Math.max(0, Math.min(utf16_start, text.length));
    const clampedEnd = Math.max(clampedStart, Math.min(utf16_end, text.length));

    const before = text.slice(0, clampedStart);
    const highlighted = text.slice(clampedStart, clampedEnd);
    const after = text.slice(clampedEnd);

    return (
      <div className="space-y-3 font-serif text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">
        <span>{before}</span>
        <mark
          ref={highlightRef}
          className="bg-amber-400/25 text-amber-200 border-2 border-amber-400/80 rounded px-1 py-0.5 shadow-sm font-semibold transition-all"
        >
          {highlighted}
        </mark>
        <span>{after}</span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-5 max-w-[1700px] mx-auto text-zinc-100 h-full">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between border-b border-zinc-800 pb-3 flex-shrink-0 gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
              <FileText className="h-5 w-5 text-cyan-400" />
              Tab 1: Deterministic Novel Parser Inspector
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-950/80 border border-cyan-800 text-cyan-300">
              Zero-LLM • Dual-Span AST
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Deterministic AST generation, bidirectional UTF-16 &amp; Codepoint offset synchronization, chunk boundaries, and ligature sanitization.
          </p>
        </div>

        {/* Tab Mode Switcher */}
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950 p-1 text-xs">
          <button
            onClick={() => setActiveTabMode("live-inspector")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition ${
              activeTabMode === "live-inspector"
                ? "bg-cyan-600/90 text-zinc-950 font-semibold shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            FastAPI AST Inspector
          </button>
          <button
            onClick={() => setActiveTabMode("book-manifest")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition ${
              activeTabMode === "book-manifest"
                ? "bg-cyan-600/90 text-zinc-950 font-semibold shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Book Manifest (R2 Batch)
          </button>
        </div>
      </div>

      {activeTabMode === "live-inspector" ? (
        /* ============================================================ */
        /* MODE 1: LIVE FASTAPI AST INSPECTOR                           */
        /* ============================================================ */
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Controls Bar */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3.5 shadow-sm flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-300">
              {/* Profile Selector */}
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-cyan-400" />
                <span className="font-semibold text-zinc-200">Profile:</span>
                <select
                  value={selectedProfileId}
                  onChange={(e) => {
                    const profId = e.target.value;
                    setSelectedProfileId(profId);
                    const prof = presets?.profiles.find((p) => p.id === profId);
                    if (prof) {
                      setNormalizeLigatures(prof.normalize_ligatures);
                    }
                  }}
                  className="h-8 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 text-xs font-mono text-zinc-200 focus:border-cyan-500 focus:outline-none"
                >
                  {presets?.profiles ? (
                    presets.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} (max {p.max_chunk_words}w)
                      </option>
                    ))
                  ) : (
                    <option value="standard-novel">Standard Novel (max 4500w)</option>
                  )}
                </select>
              </div>

              {/* Sample Preset Buttons */}
              <div className="flex items-center gap-1.5 border-l border-zinc-800 pl-4">
                <span className="text-zinc-400">Samples:</span>
                <button
                  type="button"
                  onClick={() => {
                    setInputText(SAMPLE_NOVEL_CHAPTER);
                    setSourceName("novel_chapter_sample.md");
                    handleRunInspect(SAMPLE_NOVEL_CHAPTER, "novel_chapter_sample.md", normalizeLigatures);
                  }}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-mono transition"
                >
                  Novel Excerpt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputText(SAMPLE_LIGATURE_TEST);
                    setSourceName("ligature_astral_stress.md");
                    handleRunInspect(SAMPLE_LIGATURE_TEST, "ligature_astral_stress.md", normalizeLigatures);
                  }}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-mono transition"
                >
                  Ligature &amp; Astral Test
                </button>
              </div>

              {/* Toggle Ligature Normalization */}
              <label className="flex items-center gap-2 cursor-pointer select-none border-l border-zinc-800 pl-4">
                <input
                  type="checkbox"
                  checked={normalizeLigatures}
                  onChange={(e) => setNormalizeLigatures(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-cyan-500 focus:ring-0"
                />
                <span>Normalize Ligatures (fi, fl, ffi)</span>
              </label>
            </div>

            {/* Run Button */}
            <button
              onClick={() => handleRunInspect()}
              disabled={isInspecting}
              className="h-8 px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
            >
              {isInspecting ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run Parser Inspector
            </button>
          </div>

          {/* Main Inspector Grid: Left (AST & Chunks) + Right (Viewer & Highlight) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0">
            {/* Left Column (5 cols): AST Tree / Chunks / Diagnostics */}
            <div className="lg:col-span-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm flex flex-col min-h-0 h-full">
              {/* Sub-view switcher */}
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3 flex-shrink-0">
                <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-xs">
                  <button
                    onClick={() => setLeftSubView("ast")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
                      leftSubView === "ast"
                        ? "bg-zinc-800 text-cyan-300 font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <ListTree className="h-3.5 w-3.5" />
                    AST Tree
                  </button>
                  <button
                    onClick={() => setLeftSubView("chunks")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
                      leftSubView === "chunks"
                        ? "bg-zinc-800 text-cyan-300 font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <Boxes className="h-3.5 w-3.5" />
                    Chunks ({inspectResult?.chunks.length || 0})
                  </button>
                  <button
                    onClick={() => setLeftSubView("diagnostics")}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
                      leftSubView === "diagnostics"
                        ? "bg-zinc-800 text-amber-300 font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Diagnostics ({inspectResult?.diagnostics.length || 0})
                  </button>
                </div>

                {inspectResult?.trace_id && (
                  <button
                    onClick={() => handleCopyTrace(inspectResult.trace_id)}
                    className="flex items-center gap-1 text-[10px] font-mono text-zinc-500 hover:text-cyan-400 transition"
                    title="Click to copy trace ID"
                  >
                    {copiedTrace ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{inspectResult.trace_id.slice(0, 8)}...</span>
                  </button>
                )}
              </div>

              {/* Sub-view Content */}
              <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-2">
                {isInspecting ? (
                  <div className="flex flex-col items-center justify-center p-16 text-xs text-zinc-500 gap-2">
                    <RefreshCw className="h-5 w-5 animate-spin text-cyan-400" />
                    <span>Parsing AST and computing dual-span offsets...</span>
                  </div>
                ) : !inspectResult ? (
                  <div className="p-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
                    Click &quot;Run Parser Inspector&quot; to inspect text.
                  </div>
                ) : leftSubView === "ast" ? (
                  inspectResult.document_tree ? (
                    <AstTreeNode
                      node={inspectResult.document_tree}
                      selectedSpan={selectedSpan?.span || null}
                      onSelectNode={(node) => {
                        setSelectedSpan({
                          span: node.span,
                          label: `${node.node_type}: ${node.title || node.node_id}`,
                          source: "ast",
                        });
                      }}
                    />
                  ) : (
                    <div className="text-xs text-zinc-500 p-4">No AST tree returned in response.</div>
                  )
                ) : leftSubView === "chunks" ? (
                  <div className="space-y-2">
                    {inspectResult.chunks.map((chunk) => {
                      const isSelected =
                        selectedSpan?.span.codepoint_start === chunk.span.codepoint_start &&
                        selectedSpan?.span.codepoint_end === chunk.span.codepoint_end;
                      return (
                        <div
                          key={chunk.chunk_id}
                          onClick={() => {
                            setSelectedSpan({
                              span: chunk.span,
                              label: `Chunk #${chunk.chunk_index} (${chunk.chunk_id.slice(0, 8)})`,
                              source: "chunk",
                            });
                          }}
                          className={`cursor-pointer rounded-lg border p-3 transition-all ${
                            isSelected
                              ? "border-amber-500 bg-zinc-800/90 shadow-sm"
                              : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-zinc-200">
                              Chunk #{chunk.chunk_index} (Ch.{chunk.chapter_index}, Sc.{chunk.scene_index})
                            </span>
                            <span className="font-mono text-[10px] text-zinc-400">
                              {chunk.codepoint_length} cp / {chunk.utf16_length} u16
                            </span>
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-zinc-500 truncate">
                            sha256: {chunk.sha256}
                          </div>
                          <div className="mt-2 text-[11px] font-serif text-zinc-400 line-clamp-2 italic">
                            &quot;{chunk.raw_text.slice(0, 120)}...&quot;
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Diagnostics View */
                  <div className="space-y-2">
                    {inspectResult.diagnostics.length === 0 ? (
                      <div className="p-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
                        <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
                        Zero parser anomalies or diagnostics detected.
                      </div>
                    ) : (
                      inspectResult.diagnostics.map((diag, i) => (
                        <div
                          key={i}
                          onClick={() => {
                            if (diag.span) {
                              setSelectedSpan({
                                span: diag.span,
                                label: `Diagnostic: ${diag.code}`,
                                source: "diagnostic",
                              });
                            }
                          }}
                          className={`rounded-lg border p-3 text-xs transition ${
                            diag.severity === "error"
                              ? "border-red-900/80 bg-red-950/20 text-red-200"
                              : diag.severity === "warning"
                              ? "border-amber-900/80 bg-amber-950/20 text-amber-200"
                              : "border-cyan-900/80 bg-cyan-950/20 text-cyan-200"
                          } ${diag.span ? "cursor-pointer hover:border-zinc-500" : ""}`}
                        >
                          <div className="flex items-center justify-between font-semibold">
                            <span className="font-mono text-[11px]">
                              [{diag.severity.toUpperCase()}] {diag.code}
                            </span>
                            {diag.line && (
                              <span className="font-mono text-[10px] text-zinc-400">
                                Line {diag.line}:{diag.column || 0}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-zinc-300">{diag.message}</p>
                          {diag.span && (
                            <span className="mt-1.5 inline-block text-[10px] font-mono text-amber-400">
                              Click to highlight span [{diag.span.utf16_start}..{diag.span.utf16_end}]
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column (7 cols): Text Input & Synchronized Span Highlighter */}
            <div className="lg:col-span-7 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm flex flex-col min-h-0 h-full">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center justify-between border-b border-zinc-800 pb-3 mb-3 flex-shrink-0 gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-200">View Mode:</span>
                  <div className="flex rounded-lg border border-zinc-700 bg-zinc-950 p-0.5 text-xs">
                    <button
                      onClick={() => setRightSubView("highlighted")}
                      className={`px-2.5 py-1 rounded font-medium transition ${
                        rightSubView === "highlighted"
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <Eye className="h-3 w-3 inline mr-1" /> Highlighted Text
                    </button>
                    <button
                      onClick={() => setRightSubView("normalized")}
                      className={`px-2.5 py-1 rounded font-medium transition ${
                        rightSubView === "normalized"
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <Code className="h-3 w-3 inline mr-1" /> Raw / Edit Input
                    </button>
                    <button
                      onClick={() => setRightSubView("json")}
                      className={`px-2.5 py-1 rounded font-medium transition ${
                        rightSubView === "json"
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <Hash className="h-3 w-3 inline mr-1" /> AST JSON
                    </button>
                  </div>
                </div>

                {/* Selected Span Telemetry */}
                {selectedSpan ? (
                  <div className="flex items-center gap-2 bg-amber-950/40 border border-amber-800/80 rounded-lg px-2.5 py-1 text-[11px] font-mono text-amber-300">
                    <span className="font-semibold text-amber-200 truncate max-w-[160px]">
                      {selectedSpan.label}
                    </span>
                    <span>•</span>
                    <span>
                      UTF-16: [{selectedSpan.span.utf16_start}..{selectedSpan.span.utf16_end}]
                    </span>
                    <span>•</span>
                    <span>
                      CP: [{selectedSpan.span.codepoint_start}..{selectedSpan.span.codepoint_end}]
                    </span>
                    <button
                      onClick={() => setSelectedSpan(null)}
                      className="ml-1 text-zinc-400 hover:text-zinc-200 text-xs"
                      title="Clear selection"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-zinc-500 font-mono">
                    Click an AST node or chunk to highlight its exact span
                  </span>
                )}
              </div>

              {/* Viewer Content */}
              <div className="flex-1 overflow-y-auto min-h-0 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                {rightSubView === "highlighted" ? (
                  renderSynchronizedMarkdown(inspectResult?.normalized_markdown || inputText)
                ) : rightSubView === "normalized" ? (
                  <div className="flex flex-col h-full gap-2">
                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                      <span>Source: {sourceName}</span>
                      <span>{inputText.length} UTF-16 code units</span>
                    </div>
                    <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Paste novel text or markdown here..."
                      className="flex-1 w-full bg-zinc-900/60 border border-zinc-800 rounded p-3 font-mono text-xs text-zinc-200 leading-relaxed resize-none focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                ) : (
                  <pre className="font-mono text-[11px] text-zinc-300 leading-relaxed overflow-x-auto">
                    {JSON.stringify(inspectResult?.document_tree || inspectResult, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ============================================================ */
        /* MODE 2: BOOK MANIFEST (R2 BATCH INGESTION)                   */
        /* ============================================================ */
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Manifest Toolbar */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 shadow-sm flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-300">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-cyan-400" />
                <span className="font-semibold text-zinc-200">Active Book:</span>
                <span className="font-mono text-cyan-300">
                  {activeBookId || "No book selected (select in TopBar)"}
                </span>
              </div>

              {selectedSection && (
                <button
                  type="button"
                  onClick={handleSendSectionToInspector}
                  className="px-3 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 text-xs font-medium flex items-center gap-1.5 transition"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Load Current Section into Live AST Inspector
                </button>
              )}
            </div>

            <button
              onClick={fetchManifest}
              disabled={manifestLoading || !activeBookId}
              className="h-8 px-3 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${manifestLoading ? "animate-spin" : ""}`} />
              Refresh Manifest
            </button>
          </div>

          {/* Manifest Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0">
            {/* Left Pane (4 cols): Chapter & Section Navigator */}
            <div className="lg:col-span-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm flex flex-col min-h-0 h-full">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3 flex-shrink-0">
                <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-cyan-400" />
                  Sections ({manifest?.sections?.length || 0})
                </div>
                <div className="text-[11px] text-zinc-400 font-mono">
                  {manifest?.total_story_chapters || 0} Story Chapters
                </div>
              </div>

              {manifestLoading ? (
                <div className="flex items-center justify-center p-12 text-xs text-zinc-500">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading manifest...
                </div>
              ) : !manifest?.sections || manifest.sections.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
                  No parsed sections found for book &quot;{activeBookId}&quot;.
                </div>
              ) : (
                <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 pr-1">
                  {manifest.sections.map((sec) => {
                    const isSelected = sec.chapter_index === selectedSectionIdx;
                    return (
                      <div
                        key={sec.chapter_index}
                        onClick={() => setSelectedSectionIdx(sec.chapter_index)}
                        className={`cursor-pointer rounded-lg border p-3 transition-all ${
                          isSelected
                            ? "border-cyan-500 bg-zinc-800/90 shadow-sm"
                            : "border-zinc-800 bg-zinc-950/40 hover:bg-zinc-800/40 hover:border-zinc-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-xs text-zinc-200 truncate">
                            {sec.section_title || `Section ${sec.chapter_index}`}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleClassification(sec.chapter_index);
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${
                              sec.classification === "STORY"
                                ? "bg-cyan-950/80 text-cyan-400 border-cyan-800"
                                : sec.classification === "SPLIT_PART"
                                ? "bg-amber-950/80 text-amber-400 border-amber-800"
                                : "bg-zinc-800 text-zinc-400 border-zinc-700"
                            }`}
                            title="Click to toggle FRONTMATTER / STORY classification"
                          >
                            {sec.classification}
                          </button>
                        </div>

                        <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-400 font-mono">
                          <span>{sec.word_count?.toLocaleString()} words</span>
                          <span>•</span>
                          <span>{sec.scene_breaks_count || 0} breaks</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Pane (8 cols): Cloudflare R2 Section Viewer */}
            <div className="lg:col-span-8 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm flex flex-col min-h-0 h-full">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4 flex-shrink-0">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-cyan-400" />
                    {selectedSection?.section_title || `Section ${selectedSectionIdx}`}
                  </h2>
                  <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                    {selectedSection?.r2_key} • {selectedSection?.word_count?.toLocaleString()} words
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0 rounded-lg border border-zinc-800 bg-zinc-950 p-5">
                {mdLoading ? (
                  <div className="flex items-center justify-center p-16 text-zinc-500 text-xs">
                    <RefreshCw className="h-5 w-5 animate-spin mr-2 text-cyan-400" /> Fetching section from Cloudflare R2...
                  </div>
                ) : !rawMarkdown ? (
                  <div className="text-center p-16 text-zinc-500 text-xs">
                    No section selected or file empty.
                  </div>
                ) : (
                  <pre className="font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">
                    {rawMarkdown}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Collapsible AST Tree Node Component
interface AstTreeNodeProps {
  node: DocumentNode;
  selectedSpan: SpanRange | null;
  onSelectNode: (node: DocumentNode) => void;
  depth?: number;
}

function AstTreeNode({ node, selectedSpan, onSelectNode, depth = 0 }: AstTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const hasChildren = node.children && node.children.length > 0;
  const isSelected =
    selectedSpan?.codepoint_start === node.span.codepoint_start &&
    selectedSpan?.codepoint_end === node.span.codepoint_end;

  const getNodeBadgeColor = (type: string) => {
    switch (type) {
      case "document":
        return "bg-purple-950/80 text-purple-300 border-purple-800";
      case "chapter":
        return "bg-cyan-950/80 text-cyan-300 border-cyan-800";
      case "scene":
        return "bg-amber-950/80 text-amber-300 border-amber-800";
      case "scene_break":
        return "bg-rose-950/80 text-rose-300 border-rose-800";
      default:
        return "bg-zinc-800 text-zinc-400 border-zinc-700";
    }
  };

  return (
    <div className="text-xs">
      <div
        onClick={(e) => {
          e.stopPropagation();
          onSelectNode(node);
        }}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        className={`group flex items-center justify-between py-1.5 px-2 rounded-md cursor-pointer transition ${
          isSelected
            ? "bg-amber-500/20 border border-amber-500/70 text-amber-200"
            : "hover:bg-zinc-800/60 text-zinc-300"
        }`}
      >
        <div className="flex items-center gap-1.5 truncate">
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="p-0.5 text-zinc-400 hover:text-zinc-200"
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          ) : (
            <span className="w-4" />
          )}

          <span
            className={`px-1.5 py-0.2 rounded text-[10px] font-mono uppercase font-semibold border ${getNodeBadgeColor(
              node.node_type
            )}`}
          >
            {node.node_type}
          </span>

          <span className="font-mono text-zinc-200 truncate">
            {node.title || `#${node.order_index}`}
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500 group-hover:text-zinc-400 flex-shrink-0">
          <span>
            [{node.span.utf16_start}..{node.span.utf16_end}]
          </span>
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="flex flex-col">
          {node.children.map((child) => (
            <AstTreeNode
              key={child.node_id}
              node={child}
              selectedSpan={selectedSpan}
              onSelectNode={onSelectNode}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
