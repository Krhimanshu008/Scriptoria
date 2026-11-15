"use client";

import React, { useState, useEffect } from "react";
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
  Save,
  Search,
  BookOpen,
  Split,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

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

export function Tab1Parser({ activeBookId }: Tab1ParserProps) {
  // Manifest state
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [selectedSectionIdx, setSelectedSectionIdx] = useState<number>(1);

  // Parser Config State
  const [maxWords, setMaxWords] = useState<number>(4500);
  const [normLigatures, setNormLigatures] = useState<boolean>(true);
  const [fixHyphens, setFixHyphens] = useState<boolean>(true);
  const [skipFrontmatter, setSkipFrontmatter] = useState<boolean>(true);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parseResult, setParseResult] = useState<any>(null);

  // Markdown Content Viewer State
  const [rawMarkdown, setRawMarkdown] = useState<string>("");
  const [viewMode, setViewMode] = useState<"rendered" | "raw">("rendered");
  const [mdLoading, setMdLoading] = useState<boolean>(false);

  // Edge case search / artifact detection
  const [artifactHits, setArtifactHits] = useState<Array<{ type: string; line: number; match: string }>>([]);
  const [isSearchingArtifacts, setIsSearchingArtifacts] = useState<boolean>(false);

  // Fetch Manifest
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
    } catch (err: any) {
      toast.error("Failed to fetch manifest: " + err.message);
    } finally {
      setManifestLoading(false);
    }
  };

  useEffect(() => {
    fetchManifest();
  }, [activeBookId]);

  // Fetch Section Markdown
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
        scanArtifacts(data.text || "");
      } catch (err: any) {
        toast.error("Failed to load section text: " + err.message);
      } finally {
        setMdLoading(false);
      }
    };

    fetchMarkdown();
  }, [selectedSection?.r2_key]);

  // Run Deterministic Parser
  const handleRunParser = async () => {
    if (!activeBookId) return;
    setIsParsing(true);
    try {
      const res = await fetch(`/api/pipeline/books/${activeBookId}/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_chunk_words: maxWords,
          normalize_ligatures: normLigatures,
          fix_hyphens: fixHyphens,
          skip_frontmatter: skipFrontmatter,
        }),
      });
      const data = await res.json();
      setParseResult(data);
      if (data.success) {
        toast.success(`Parsing complete: ${data.total_story_chapters} story chapters parsed!`);
        fetchManifest();
      } else {
        toast.error("Parser failed: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      toast.error("Parser request error: " + err.message);
    } finally {
      setIsParsing(false);
    }
  };

  // Scan Leftover Artifacts (Regex scan for broken hyphens, ligatures, page numbers)
  const scanArtifacts = (text: string) => {
    setIsSearchingArtifacts(true);
    const lines = text.split("\n");
    const hits: Array<{ type: string; line: number; match: string }> = [];

    lines.forEach((line, idx) => {
      // Check for unjoined hyphens: word-\n
      if (/[a-zA-Z]+-\s*$/.test(line)) {
        hits.push({ type: "Trailing Hyphen", line: idx + 1, match: line.slice(-15) });
      }
      // Check for raw ligatures
      const ligMatch = line.match(/[\uFB00-\uFB06]/);
      if (ligMatch) {
        hits.push({ type: "Unnormalized Ligature", line: idx + 1, match: ligMatch[0] });
      }
      // Check for stray page numbers e.g. "Page 123"
      const pageMatch = line.match(/\bPage\s+\d+\b/i);
      if (pageMatch) {
        hits.push({ type: "Stray Page Marker", line: idx + 1, match: pageMatch[0] });
      }
    });

    setArtifactHits(hits);
    setIsSearchingArtifacts(false);
  };

  // Toggle Section Classification (FRONTMATTER <-> STORY)
  const handleToggleClassification = async (secIndex: number) => {
    if (!manifest || !Array.isArray(manifest.sections)) return;
    const updated = { ...manifest, sections: [...manifest.sections] };
    const target = updated.sections.find((s) => s.chapter_index === secIndex);
    if (!target) return;

    target.classification = target.classification === "STORY" ? "FRONTMATTER" : "STORY";
    // Recount story chapters
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
    } catch (err: any) {
      toast.error("Failed to save updated manifest: " + err.message);
    }
  };

  const getBadgeStyle = (classification: string) => {
    switch (classification) {
      case "STORY":
        return "bg-cyan-950/80 text-cyan-400 border-cyan-800";
      case "SPLIT_PART":
        return "bg-amber-950/80 text-amber-400 border-amber-800";
      default:
        return "bg-zinc-800 text-zinc-400 border-zinc-700";
    }
  };

  // Render markdown with bright orange pills for <SCENE_BREAK />
  const renderFormattedMarkdown = (text: string) => {
    if (!text) return null;

    const parts = text.split(/(<SCENE_BREAK\s*\/>)/g);
    return (
      <div className="space-y-4 leading-relaxed font-serif text-zinc-300 text-sm">
        {parts.map((p, i) => {
          if (p.includes("<SCENE_BREAK")) {
            return (
              <div key={i} className="my-6 flex items-center justify-center">
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/40 text-amber-400 font-mono text-[11px] font-semibold tracking-wide">
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
  };

  return (
    <div className="flex flex-col gap-4 p-5 max-w-[1600px] mx-auto text-zinc-100 h-full">
      {/* Header Banner */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <FileText className="h-5 w-5 text-cyan-400" />
            Checkpoint 1: Deterministic Novel Parser Inspector (Zero-LLM)
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Standardize scene breaks to &lt;SCENE_BREAK /&gt;, normalize ligatures (fi, fl), join broken hyphens, split oversized chapters (&gt;4,500 words), and verify frontmatter classification.
          </p>
        </div>
      </div>

      {/* Parser Config Bar */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 shadow-sm flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-5 text-xs text-zinc-300">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-amber-400" />
            <span className="font-semibold text-zinc-200">Parser Config:</span>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-zinc-400">Max Words:</span>
            <input
              type="number"
              value={maxWords}
              onChange={(e) => setMaxWords(Number(e.target.value))}
              className="w-20 h-7 rounded border border-zinc-700 bg-zinc-950 px-2 text-xs font-mono text-zinc-200 focus:border-amber-500 focus:outline-none"
            />
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={normLigatures}
              onChange={(e) => setNormLigatures(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-950 text-amber-500 focus:ring-0"
            />
            <span>Normalize Ligatures (fi, fl)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={fixHyphens}
              onChange={(e) => setFixHyphens(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-950 text-amber-500 focus:ring-0"
            />
            <span>Fix Broken Hyphens</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={skipFrontmatter}
              onChange={(e) => setSkipFrontmatter(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-950 text-amber-500 focus:ring-0"
            />
            <span>Skip Frontmatter</span>
          </label>
        </div>

        <button
          onClick={handleRunParser}
          disabled={isParsing || !activeBookId}
          className="h-8 px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-zinc-950 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
        >
          {isParsing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run Deterministic Parser
        </button>
      </div>

      {/* Main Split Grid: Navigator (Left) + Markdown / Diff Viewer (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0">
        {/* Left Pane (4 cols): Chapter & Section Navigator */}
        <div className="lg:col-span-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm flex flex-col min-h-0 h-full">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3 flex-shrink-0">
            <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-cyan-400" />
              Sections ({manifest?.sections?.length || 0})
            </div>
            <div className="text-[11px] text-zinc-400">
              {manifest?.total_story_chapters || 0} Story Chapters
            </div>
          </div>

          {manifestLoading ? (
            <div className="flex items-center justify-center p-12 text-xs text-zinc-500">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading manifest...
            </div>
          ) : !manifest?.sections || !Array.isArray(manifest.sections) || manifest.sections.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
              No parsed sections found. Click &quot;Run Deterministic Parser&quot; to parse EPUB.
            </div>
          ) : (
            <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 pr-1">
              {(manifest.sections || []).map((sec) => {
                const isSelected = sec.chapter_index === selectedSectionIdx;
                return (
                  <div
                    key={sec.chapter_index}
                    onClick={() => setSelectedSectionIdx(sec.chapter_index)}
                    className={`cursor-pointer rounded-lg border p-3 transition-all ${
                      isSelected
                        ? "border-amber-500/80 bg-zinc-800/90 shadow-sm"
                        : "border-zinc-800/80 bg-zinc-950/40 hover:bg-zinc-800/40 hover:border-zinc-700"
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
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${getBadgeStyle(
                          sec.classification
                        )}`}
                        title="Click to toggle FRONTMATTER / STORY classification"
                      >
                        {sec.classification}
                      </button>
                    </div>

                    <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-400 font-mono">
                      <span>{sec.word_count?.toLocaleString()} words</span>
                      <span>•</span>
                      <span>{sec.scene_breaks_count || 0} breaks</span>
                      {sec.is_split_part && (
                        <span className="text-amber-400 font-semibold">
                          Part {sec.part_index}/{sec.total_parts}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Pane (8 cols): Sanitization & Markdown Viewer */}
        <div className="lg:col-span-8 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm flex flex-col min-h-0 h-full">
          {/* Section Toolbar */}
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4 flex-shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-amber-400" />
                {selectedSection?.section_title || `Section ${selectedSectionIdx}`}
              </h2>
              <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                {selectedSection?.r2_key} • {selectedSection?.word_count?.toLocaleString()} words
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Rendered vs Raw Toggle */}
              <div className="flex rounded-lg border border-zinc-700 bg-zinc-950 p-0.5 text-xs">
                <button
                  onClick={() => setViewMode("rendered")}
                  className={`px-2.5 py-1 rounded font-medium transition ${
                    viewMode === "rendered"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Eye className="h-3 w-3 inline mr-1" /> Rendered
                </button>
                <button
                  onClick={() => setViewMode("raw")}
                  className={`px-2.5 py-1 rounded font-medium transition ${
                    viewMode === "raw"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Code className="h-3 w-3 inline mr-1" /> Raw MD
                </button>
              </div>
            </div>
          </div>

          {/* Leftover Artifacts Warning Pill */}
          {artifactHits.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-900/80 bg-amber-950/30 p-3 text-xs text-amber-300 flex-shrink-0">
              <div className="flex items-center gap-1.5 font-semibold text-amber-200 mb-1">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                {artifactHits.length} Potential Cleanup Artifacts Detected:
              </div>
              <div className="flex flex-wrap gap-2 mt-1">
                {artifactHits.slice(0, 5).map((h, i) => (
                  <span key={i} className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 font-mono text-[10px]">
                    L{h.line}: {h.type} (&quot;{h.match}&quot;)
                  </span>
                ))}
                {artifactHits.length > 5 && (
                  <span className="text-zinc-400 text-[11px]">+{artifactHits.length - 5} more</span>
                )}
              </div>
            </div>
          )}

          {/* Content Pane */}
          <div className="flex-1 overflow-y-auto min-h-0 rounded-lg border border-zinc-800 bg-zinc-950 p-5">
            {mdLoading ? (
              <div className="flex items-center justify-center p-16 text-zinc-500 text-xs">
                <RefreshCw className="h-5 w-5 animate-spin mr-2 text-cyan-400" /> Fetching section from Cloudflare R2...
              </div>
            ) : !rawMarkdown ? (
              <div className="text-center p-16 text-zinc-500 text-xs">
                No section selected or file empty.
              </div>
            ) : viewMode === "rendered" ? (
              renderFormattedMarkdown(rawMarkdown)
            ) : (
              <pre className="font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {rawMarkdown}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
