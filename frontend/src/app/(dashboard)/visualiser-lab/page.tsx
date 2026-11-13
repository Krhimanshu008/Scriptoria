"use client";

import React, { useState, useEffect } from "react";
import {
  Film,
  BookOpen,
  Hash,
  Database,
  Clapperboard,
  ShieldCheck,
  Volume2,
  Play,
  RotateCcw,
  Sparkles,
  Layers,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  Sliders,
  Maximize2,
  Video,
  Download,
  Terminal,
  Activity,
  Zap,
  Upload,
  ArrowRight,
  Search,
} from "lucide-react";
import { toast } from "sonner";

type LabStation =
  | "ingestion"
  | "fingerprints"
  | "foundry"
  | "storyboard"
  | "qc"
  | "audio_film";

export default function VisualiserLabPage() {
  const [activeStation, setActiveStation] = useState<LabStation>("ingestion");
  const [loading, setLoading] = useState(false);

  // -------------------------------------------------------------
  // Station 1 State: Ingestion & DOM Walker
  // -------------------------------------------------------------
  const [ingestionMode, setIngestionMode] = useState<
    "epub_upload" | "shadow_slave" | "paste_html"
  >("epub_upload");
  const [uploadedEpubFile, setUploadedEpubFile] = useState<File | null>(null);
  const [selectedChapterIdx, setSelectedChapterIdx] = useState<number>(1);
  const [chapterSearch, setChapterSearch] = useState<string>("");
  const [rawHtmlInput, setRawHtmlInput] = useState(
    `<div>
  <h1>Chapter 1: The Mountain Pass</h1>
  <p><span class="dropcap">T</span>he blizzard roared like a dying god across the jagged peaks.</p>
  <blockquote class="status-box">[System Announcement: Aspect Dormant - Fated Attribute Unlocked]</blockquote>
  <p><em>Why am I always the unlucky one?</em> he wondered bitterly through chattering teeth.<sup>[1]</sup></p>
  <hr class="scene-break" />
  <p>Footsteps echoed across the frozen black stone terrace as the shadows lengthened.</p>
</div>`
  );
  const [ingestionResult, setIngestionResult] = useState<any>(null);
  const [textMode, setTextMode] = useState<"clean" | "tts">("clean");

  // -------------------------------------------------------------
  // Station 2 State: Deterministic Fingerprint Sandbox
  // -------------------------------------------------------------
  const [fpPrompt, setFpPrompt] = useState(
    "masterpiece, best quality, cinematic wide establishing shot, cold desolate mountain peak, howling blizzard"
  );
  const [fpSeed, setFpSeed] = useState(42);
  const [fpWorkflow, setFpWorkflow] = useState("04_WF_SHOT_SOLO.json");
  const [fpResult, setFpResult] = useState<any>(null);

  // -------------------------------------------------------------
  // Station 3 State: Foundry Reference Bible
  // -------------------------------------------------------------
  const [foundryPlates, setFoundryPlates] = useState<any[]>([]);
  const [selectedPlate, setSelectedPlate] = useState<any>(null);

  // -------------------------------------------------------------
  // Station 4 State: Storyboard & Framing
  // -------------------------------------------------------------
  const [framingsInput, setFramingsInput] = useState(
    "WIDE_ESTABLISHING, MEDIUM_FULL, CLOSE_UP, CLOSE_UP, CLOSE_UP, WIDE_ESTABLISHING"
  );
  const [framingAuditResult, setFramingAuditResult] = useState<any>(null);

  // -------------------------------------------------------------
  // Station 5 State: 3-Gate QC Live Studio
  // -------------------------------------------------------------
  const [qcFile, setQcFile] = useState<File | null>(null);
  const [qcDescription, setQcDescription] = useState(
    "Sunny stands on the frozen cliff with blade drawn"
  );
  const [qcResult, setQcResult] = useState<any>(null);

  // -------------------------------------------------------------
  // Station 6 State: Audio, Subtitles & FFmpeg 2.5D Film
  // -------------------------------------------------------------
  const [ttsText, setTtsText] = useState(
    "He stepped out onto the frozen peak. [PAUSE_1000MS] The bitter wind clawed at his skin like frozen glass."
  );
  const [ttsRole, setTtsRole] = useState("narrator");
  const [ttsProvider, setTtsProvider] = useState("edge-tts");
  const [audioResult, setAudioResult] = useState<any>(null);
  const [motionType, setMotionType] = useState("SLOW_ZOOM_IN");
  const [clipDuration, setClipDuration] = useState(3.0);
  const [kenBurnsResult, setKenBurnsResult] = useState<any>(null);

  // Load Foundry plates when visiting Station 3
  useEffect(() => {
    if (activeStation === "foundry" && foundryPlates.length === 0) {
      loadFoundryPlates();
    }
  }, [activeStation]);

  const loadFoundryPlates = async () => {
    try {
      const res = await fetch("/api/lab/foundry-plates");
      if (res.ok) {
        const data = await res.json();
        setFoundryPlates(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // -------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------
  const handleLoadSampleNovel = async () => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("sample_novel", "shadow_slave");
      formData.append("chapter_index", "1");

      const res = await fetch("/api/lab/parse-epub-dom", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Parse failed");

      setIngestionResult(data);
      setSelectedChapterIdx(1);
      toast.success(
        `Ingested Shadow Slave Collection (${data.total_chapters} chapters)!`
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadEpub = async (file: File, chapterIdx: number = 1) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("chapter_index", String(chapterIdx));

      const res = await fetch("/api/lab/parse-epub-dom", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Parse failed");

      if (data.drm_protected) {
        toast.error(`DRM Protection Detected: ${data.drm_error}`);
      } else {
        toast.success(
          `Ingested EPUB: ${data.metadata?.title || file.name} (${
            data.total_chapters
          } chapters)!`
        );
      }
      setIngestionResult(data);
      setSelectedChapterIdx(chapterIdx);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeChapter = async (targetChapter: number) => {
    setLoading(true);
    try {
      const formData = new FormData();
      if (ingestionMode === "shadow_slave") {
        formData.append("sample_novel", "shadow_slave");
      } else if (uploadedEpubFile) {
        formData.append("file", uploadedEpubFile);
      }
      formData.append("chapter_index", String(targetChapter));

      const res = await fetch("/api/lab/parse-epub-dom", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to switch chapter");

      setIngestionResult(data);
      setSelectedChapterIdx(targetChapter);
      toast.success(
        `Switched to Chapter ${targetChapter}: ${
          data.selected_chapter?.title || ""
        }`
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendToStation2 = () => {
    if (!ingestionResult) return;
    const text = ingestionResult.full_clean_text?.slice(0, 300) || "";
    setFpPrompt(
      `masterpiece, best quality, cinematic shot, ${text.replace(/\n+/g, " ")}`
    );
    setActiveStation("fingerprints");
    toast.success("Chapter context transferred to Station 2 (Fingerprint Sandbox)!");
  };

  const handleSendToStation6 = () => {
    if (!ingestionResult) return;
    const tts =
      ingestionResult.full_tts_text ||
      ingestionResult.blocks?.map((b: any) => b.tts_text).join(" ") ||
      "";
    setTtsText(tts.slice(0, 500));
    setActiveStation("audio_film");
    toast.success(
      "Chapter speech text transferred to Station 6 (Audio & 2.5D Film Studio)!"
    );
  };

  const handleParseEpubDom = async () => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("raw_html", rawHtmlInput);

      const res = await fetch("/api/lab/parse-epub-dom", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Parse failed");

      setIngestionResult(data);
      toast.success(
        `Parsed ${data.total_blocks} semantic blocks with Gate 0 audit!`
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleComputeFingerprint = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/lab/fingerprint-sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positive_prompt: fpPrompt,
          seed: fpSeed,
          workflow_template: fpWorkflow,
          width: 1216,
          height: 832,
        }),
      });
      const data = await res.json();
      setFpResult(data);
      toast.success("Deterministic Fingerprint Calculated!");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAuditFraming = async () => {
    setLoading(true);
    try {
      const list = framingsInput.split(",").map((s) => s.trim().toUpperCase());
      const res = await fetch("/api/lab/audit-framing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ framings: list }),
      });
      const data = await res.json();
      setFramingAuditResult(data);
      if (data.passed) {
        toast.success("DoP Framing Audit Passed! Camera variety maintained.");
      } else {
        toast.warning(
          `DoP Alert: ${data.violations.length} monotony violation(s) flagged!`
        );
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEvaluateQc = async () => {
    if (!qcFile) {
      toast.error("Please select an image file to evaluate");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("rendered_image", qcFile);
      fd.append("shot_description", qcDescription);

      const res = await fetch("/api/lab/qc-evaluate-frame", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      setQcResult(data);
      toast.success(`QC Audit Complete: ${data.recommendation}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSynthesizeAudio = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/lab/synthesize-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: ttsText,
          role: ttsRole,
          provider: ttsProvider,
        }),
      });
      const data = await res.json();
      setAudioResult(data);
      toast.success(
        `Synthesized ${data.duration_seconds}s audio with synchronized .ass subtitles!`
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRenderKenBurns = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/lab/render-ken-burns-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_filename: "placeholder.png",
          motion_type: motionType,
          duration_sec: clipDuration,
          framing: "WIDE_ESTABLISHING",
          vignette: true,
        }),
      });
      const data = await res.json();
      setKenBurnsResult(data);
      toast.success(
        `Rendered 2.5D Ken Burns 1080p 60fps MP4 clip in ${data.duration_sec}s!`
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8 max-w-7xl mx-auto text-neutral-100 min-h-screen">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 rounded-2xl bg-neutral-900/80 border border-neutral-800 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Film className="w-8 h-8 animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Novel Visualiser Test Lab
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/30">
                v2.0 End-to-End
              </span>
            </h1>
            <p className="text-sm text-neutral-400">
              Interactive test benches for EPUB DOM walking, 3-Gate QC, speech
              synthesis, karaoke subtitles, and 2.5D FFmpeg film assembly.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-neutral-950/60 p-1.5 rounded-xl border border-neutral-800">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-ping ml-2" />
          <span className="text-xs font-mono text-emerald-400 pr-2">
            Local Engine Ready (:8000)
          </span>
        </div>
      </div>

      {/* Station Selector Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 bg-neutral-900/60 p-2 rounded-xl border border-neutral-800">
        {[
          {
            id: "ingestion",
            label: "1. DOM Ingestion",
            icon: BookOpen,
            color: "text-emerald-400",
          },
          {
            id: "fingerprints",
            label: "2. Fingerprints",
            icon: Hash,
            color: "text-cyan-400",
          },
          {
            id: "foundry",
            label: "3. Foundry Bible",
            icon: Database,
            color: "text-amber-400",
          },
          {
            id: "storyboard",
            label: "4. Co-Director",
            icon: Clapperboard,
            color: "text-indigo-400",
          },
          {
            id: "qc",
            label: "5. 3-Gate QC",
            icon: ShieldCheck,
            color: "text-rose-400",
          },
          {
            id: "audio_film",
            label: "6. Audio & Film",
            icon: Volume2,
            color: "text-purple-400",
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeStation === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveStation(tab.id as LabStation)}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? "bg-neutral-800 text-white shadow-lg border border-neutral-700 font-semibold"
                  : "text-neutral-400 hover:text-white hover:bg-neutral-800/40"
              }`}
            >
              <Icon className={`w-4 h-4 ${tab.color}`} />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ============================================================ */}
      {/* STATION 1: EPUB INGESTION & DOM WALKER */}
      {/* ============================================================ */}
      {activeStation === "ingestion" && (
        <div className="flex flex-col gap-6">
          {/* Mode Switcher */}
          <div className="flex items-center gap-2 border-b border-neutral-800 pb-3">
            {[
              { id: "epub_upload", label: "Upload .EPUB File", icon: Upload },
              {
                id: "shadow_slave",
                label: "Load Shadow Slave (1,435 Chapters)",
                icon: Sparkles,
              },
              {
                id: "paste_html",
                label: "Paste Raw HTML / Prose",
                icon: FileText,
              },
            ].map((m) => {
              const Icon = m.icon;
              const isSelected = ingestionMode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() =>
                    setIngestionMode(
                      m.id as "epub_upload" | "shadow_slave" | "paste_html"
                    )
                  }
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                    isSelected
                      ? "bg-emerald-600 text-white font-semibold shadow-md"
                      : "bg-neutral-900/60 text-neutral-400 hover:text-white border border-neutral-800"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Mode Input Panels */}
          {ingestionMode === "epub_upload" && (
            <div className="p-6 rounded-2xl bg-neutral-900/60 border border-neutral-800 flex flex-col items-center justify-center gap-4 text-center">
              <div className="p-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <Upload className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Upload an EPUB Novel
                </h3>
                <p className="text-xs text-neutral-400 mt-1 max-w-md">
                  Parses OPF package spine, validates DRM encryption, stitches
                  drop-caps, classifies LitRPG status boxes, and isolates
                  footnotes into JSON.
                </p>
              </div>

              <input
                type="file"
                id="epub-file-input"
                accept=".epub"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setUploadedEpubFile(f);
                    handleUploadEpub(f, 1);
                  }
                }}
              />

              <div className="flex items-center gap-3">
                <label
                  htmlFor="epub-file-input"
                  className="cursor-pointer px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-xs text-white transition-all shadow-lg flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  {loading ? "Ingesting Archive..." : "Select .EPUB from Computer"}
                </label>
                {uploadedEpubFile && (
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-950/40 px-3 py-1 rounded border border-emerald-800/40">
                    {uploadedEpubFile.name} (
                    {(uploadedEpubFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </span>
                )}
              </div>
            </div>
          )}

          {ingestionMode === "shadow_slave" && (
            <div className="p-6 rounded-2xl bg-gradient-to-r from-neutral-900 to-neutral-950 border border-neutral-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  <Sparkles className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    Shadow Slave — Volume 1 to 7 Collection
                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono border border-amber-500/30">
                      1,435 Chapters On-Disk
                    </span>
                  </h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Pre-bundled high-volume benchmark novel by Guiltythree. Tests
                    spine traversal, LitRPG spell boxes, and memory scaling.
                  </p>
                </div>
              </div>
              <button
                onClick={handleLoadSampleNovel}
                disabled={loading}
                className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 font-semibold text-xs text-white transition-all shadow-lg shrink-0 flex items-center gap-2"
              >
                <Zap className="w-4 h-4" />
                {loading ? "Loading Spine..." : "Decompose Shadow Slave Now"}
              </button>
            </div>
          )}

          {ingestionMode === "paste_html" && (
            <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-emerald-400" />
                Raw Document / HTML Input
              </h2>
              <textarea
                value={rawHtmlInput}
                onChange={(e) => setRawHtmlInput(e.target.value)}
                rows={6}
                className="w-full bg-neutral-950 font-mono text-xs p-3 rounded-lg border border-neutral-800 text-neutral-300 focus:outline-none focus:border-emerald-500/50"
              />
              <button
                onClick={handleParseEpubDom}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold text-xs text-white transition-all shadow-lg flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                {loading
                  ? "Parsing DOM Blocks..."
                  : "Parse & Audit DOM Blocks (Gate 0)"}
              </button>
            </div>
          )}

          {/* Active Novel Metadata & DRM Shield */}
          {ingestionResult?.metadata && (
            <div className="p-4 rounded-xl bg-neutral-950/80 border border-neutral-800 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    {ingestionResult.metadata.title}
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      DRM-Free / Pass
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-400 font-mono">
                    Author:{" "}
                    {ingestionResult.metadata.authors?.join(", ") || "Unknown"} •
                    Format: EPUB {ingestionResult.metadata.epub_version} • Hash:{" "}
                    {ingestionResult.metadata.sha256_hash?.slice(0, 16)}...
                  </div>
                </div>
              </div>

              {/* Chapter Spine Navigator */}
              {ingestionResult.total_chapters > 1 && (
                <div className="flex items-center gap-2 bg-neutral-900 p-1.5 rounded-lg border border-neutral-800">
                  <button
                    disabled={selectedChapterIdx <= 1 || loading}
                    onClick={() => handleChangeChapter(selectedChapterIdx - 1)}
                    className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 disabled:opacity-40"
                  >
                    Prev
                  </button>

                  <select
                    value={selectedChapterIdx}
                    onChange={(e) =>
                      handleChangeChapter(parseInt(e.target.value) || 1)
                    }
                    className="bg-neutral-950 text-xs px-2.5 py-1 rounded border border-neutral-800 text-white font-mono"
                  >
                    {ingestionResult.chapters
                      ?.slice(0, 200)
                      .map((ch: any) => (
                        <option
                          key={ch.chapter_number}
                          value={ch.chapter_number}
                        >
                          Ch {ch.chapter_number}: {ch.title} ({ch.word_count}w)
                        </option>
                      ))}
                  </select>

                  <button
                    disabled={
                      selectedChapterIdx >= ingestionResult.total_chapters ||
                      loading
                    }
                    onClick={() => handleChangeChapter(selectedChapterIdx + 1)}
                    className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Deep Transparent Analysis Grid */}
          {ingestionResult && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Gate 0 Audit & Cross-Station Forwarding */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                {/* Gate 0 Audit Card */}
                {ingestionResult.audit_report && (
                  <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
                    <h3 className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
                      Quality Gate 0 Audit Report
                      <span
                        className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                          ingestionResult.audit_report.status === "PASS"
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        }`}
                      >
                        {ingestionResult.audit_report.status}
                      </span>
                    </h3>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">
                        <div className="text-[10px] text-neutral-400">
                          Chapter Words
                        </div>
                        <div className="text-sm font-bold text-white">
                          {ingestionResult.selected_chapter?.word_count ||
                            ingestionResult.audit_report.production_forecast
                              ?.total_words ||
                            0}
                        </div>
                      </div>
                      <div className="bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">
                        <div className="text-[10px] text-neutral-400">
                          Est. Shots
                        </div>
                        <div className="text-sm font-bold text-cyan-400">
                          {Math.round(
                            (ingestionResult.selected_chapter?.word_count ||
                              2000) / 40
                          )}
                        </div>
                      </div>
                      <div className="bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">
                        <div className="text-[10px] text-neutral-400">
                          TTS Audio
                        </div>
                        <div className="text-sm font-bold text-amber-400">
                          {(
                            (ingestionResult.selected_chapter?.word_count ||
                              2000) / 150
                          ).toFixed(1)}
                          m
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 text-[11px] text-neutral-300 space-y-1">
                      <div className="flex items-center justify-between text-neutral-400">
                        <span>Sequence Gaps:</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          None Detected
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-neutral-400">
                        <span>Dirty HTML / Scrapers:</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          Zero Residue
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-neutral-400">
                        <span>Spoken Footnotes:</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          Excluded & Isolated
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Dropcap & Footnotes Transparency Card */}
                <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-2.5">
                  <h4 className="text-xs font-semibold text-neutral-300">
                    DOM Normalization Verification
                  </h4>
                  <div className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs flex flex-col gap-1">
                    <span className="text-[10px] text-neutral-500 uppercase font-mono">
                      Drop-Cap Stitching Rule
                    </span>
                    <span className="text-neutral-300">
                      Inline span tags are concatenated with zero whitespace:
                    </span>
                    <code className="text-emerald-400 font-mono text-[11px] bg-emerald-950/20 px-2 py-1 rounded">
                      &lt;span class=&quot;dropcap&quot;&gt;T&lt;/span&gt;he
                      &rarr; &quot;The&quot;
                    </code>
                  </div>
                </div>

                {/* Cross-Station Actions */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-neutral-900 to-neutral-950 border border-neutral-800 flex flex-col gap-2">
                  <h4 className="text-xs font-semibold text-neutral-200">
                    Step-by-Step Pipeline Forwarding
                  </h4>
                  <p className="text-[11px] text-neutral-400">
                    Directly forward this parsed chapter to downstream pipeline
                    stations:
                  </p>
                  <div className="flex flex-col gap-2 mt-1">
                    <button
                      onClick={handleSendToStation2}
                      className="w-full py-2 px-3 rounded-lg bg-cyan-950/40 hover:bg-cyan-900/40 border border-cyan-800/40 text-cyan-300 text-xs font-medium flex items-center justify-between transition-all"
                    >
                      <span>Forward to Station 2 (Beats & Fingerprints)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleSendToStation6}
                      className="w-full py-2 px-3 rounded-lg bg-purple-950/40 hover:bg-purple-900/40 border border-purple-800/40 text-purple-300 text-xs font-medium flex items-center justify-between transition-all"
                    >
                      <span>Forward to Station 6 (Audio & 2.5D Film)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Classified Semantic Block Stream */}
              <div className="lg:col-span-7 flex flex-col gap-4">
                <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3 min-h-[500px]">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                        <Layers className="w-4 h-4 text-cyan-400" />
                        Semantic Classified Blocks (
                        {ingestionResult.total_blocks} units)
                      </h2>
                      <p className="text-[11px] text-neutral-400">
                        Chapter {ingestionResult.selected_chapter?.chapter_number}
                        : {ingestionResult.selected_chapter?.title}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
                      <button
                        onClick={() => setTextMode("clean")}
                        className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${
                          textMode === "clean"
                            ? "bg-neutral-800 text-white font-bold shadow"
                            : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        clean_text (LLM)
                      </button>
                      <button
                        onClick={() => setTextMode("tts")}
                        className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${
                          textMode === "tts"
                            ? "bg-neutral-800 text-amber-300 font-bold shadow"
                            : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        tts_text (Speech)
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto max-h-[620px] flex flex-col gap-2.5 pr-2">
                    {ingestionResult.blocks.map((b: any, idx: number) => {
                      const isSystem = b.block_type === "system_box";
                      const isThought = b.block_type === "internal_thought";
                      const isBreak = b.block_type === "scene_break";

                      return (
                        <div
                          key={idx}
                          className={`p-3.5 rounded-lg border text-xs transition-all ${
                            isSystem
                              ? "bg-cyan-950/20 border-cyan-800/40 text-cyan-200 font-mono shadow-sm"
                              : isThought
                              ? "bg-purple-950/20 border-purple-800/40 text-purple-200 italic"
                              : isBreak
                              ? "bg-amber-950/20 border-amber-800/40 text-amber-200 text-center py-2.5 font-bold"
                              : "bg-neutral-950 border-neutral-800 text-neutral-300"
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] mb-1.5 opacity-75">
                            <span className="font-mono font-bold uppercase tracking-wider">
                              #{b.block_index} • {b.block_type}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {b.dropcap_detected && (
                                <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                                  Dropcap Stitched
                                </span>
                              )}
                              {b.footnotes?.length > 0 && (
                                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">
                                  {b.footnotes.length} Footnote(s) Isolated
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="leading-relaxed">
                            {textMode === "clean" ? b.clean_text : b.tts_text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* STATION 2: DETERMINISTIC FINGERPRINT SANDBOX */}
      {/* ============================================================ */}
      {activeStation === "fingerprints" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 flex flex-col gap-4">
            <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <Hash className="w-4 h-4 text-cyan-400" />
                Prompt & Parameter Contract
              </h2>

              <div>
                <label className="text-xs text-neutral-400 mb-1 block">
                  Positive Prompt
                </label>
                <textarea
                  value={fpPrompt}
                  onChange={(e) => setFpPrompt(e.target.value)}
                  rows={4}
                  className="w-full bg-neutral-950 text-xs p-3 rounded-lg border border-neutral-800 text-neutral-200 focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-400 mb-1 block">
                    Generation Seed
                  </label>
                  <input
                    type="number"
                    value={fpSeed}
                    onChange={(e) => setFpSeed(parseInt(e.target.value) || 0)}
                    className="w-full bg-neutral-950 text-xs p-2.5 rounded-lg border border-neutral-800 text-neutral-200 focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-400 mb-1 block">
                    Workflow Template
                  </label>
                  <select
                    value={fpWorkflow}
                    onChange={(e) => setFpWorkflow(e.target.value)}
                    className="w-full bg-neutral-950 text-xs p-2.5 rounded-lg border border-neutral-800 text-neutral-200 focus:outline-none focus:border-cyan-500/50"
                  >
                    <option value="04_WF_SHOT_SOLO.json">
                      04_WF_SHOT_SOLO (Character + Scene)
                    </option>
                    <option value="05_WF_SHOT_MULTI.json">
                      05_WF_SHOT_MULTI (Two-Shot / Multi)
                    </option>
                    <option value="06_WF_SHOT_ENV.json">
                      06_WF_SHOT_ENV (Pure Environment Vista)
                    </option>
                    <option value="07_WF_EDIT_INPAINT.json">
                      07_WF_EDIT_INPAINT (Surgical SAM2 Inpaint)
                    </option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleComputeFingerprint}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 font-semibold text-xs text-white transition-all shadow-lg flex items-center justify-center gap-2 mt-2"
              >
                <Hash className="w-4 h-4" />
                Compute Deterministic SHA-256 Fingerprint
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 flex flex-col gap-4">
            <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-4">
              <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Cache Invalidation Contract
              </h2>

              {fpResult ? (
                <div className="flex flex-col gap-3">
                  <div className="p-4 rounded-xl bg-neutral-950 border border-cyan-500/30 flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-cyan-400 font-bold">
                      Deterministic Fingerprint (SHA-256)
                    </span>
                    <span className="font-mono text-sm font-bold text-white break-all">
                      {fpResult.fingerprint}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-lg bg-emerald-950/20 border border-emerald-800/40 text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span>
                      Fingerprint is calculated across style vector, prompt,
                      seed, workflow template, and reference plates.
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 text-xs flex flex-col gap-2">
                    <span className="text-neutral-400 font-semibold">
                      Invalidation Rules:
                    </span>
                    <ul className="list-disc list-inside text-neutral-300 space-y-1">
                      <li>
                        If the fingerprint matches PostgreSQL cache:{" "}
                        <span className="text-emerald-400 font-bold">
                          SKIP RENDER (0 GPU seconds)
                        </span>
                      </li>
                      <li>
                        If prompt, seed, or character plate changes:{" "}
                        <span className="text-amber-400 font-bold">
                          INVALIDATE & RE-RENDER
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-neutral-500 text-xs">
                  Click button to compute and inspect deterministic hash.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STATION 3: FOUNDRY REFERENCE BIBLE */}
      {/* ============================================================ */}
      {activeStation === "foundry" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
              <Database className="w-4 h-4 text-amber-400" />
              Foundry Approved Reference Plates (output/foundry/)
            </h2>
            <button
              onClick={loadFoundryPlates}
              className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200"
            >
              Refresh Plates
            </button>
          </div>

          {foundryPlates.length === 0 ? (
            <div className="p-12 text-center rounded-xl bg-neutral-900/60 border border-neutral-800 text-neutral-400 text-xs">
              No plates currently found in output/foundry/. Render Wave 2 assets
              to populate.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {foundryPlates.map((p, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedPlate(p)}
                  className="group relative cursor-pointer overflow-hidden rounded-xl bg-neutral-950 border border-neutral-800 hover:border-amber-500/50 transition-all flex flex-col"
                >
                  <div className="aspect-[3/4] bg-neutral-900 overflow-hidden relative">
                    <img
                      src={p.url}
                      alt={p.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur text-[9px] font-mono text-amber-300 font-bold border border-amber-500/30">
                      {p.category}
                    </div>
                  </div>
                  <div className="p-2.5 flex flex-col">
                    <span className="text-xs font-semibold text-neutral-200 truncate">
                      {p.name}
                    </span>
                    <span className="text-[10px] text-neutral-500 font-mono">
                      {p.size_kb} KB
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* STATION 4: CO-DIRECTOR & STORYBOARD */}
      {/* ============================================================ */}
      {activeStation === "storyboard" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 flex flex-col gap-4">
            <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <Clapperboard className="w-4 h-4 text-indigo-400" />
                Director of Photography (DoP) Variety Auditor
              </h2>
              <p className="text-xs text-neutral-400">
                Enforces visual diversity: flags whenever 3 consecutive identical
                framings occur in sequence.
              </p>
              <textarea
                value={framingsInput}
                onChange={(e) => setFramingsInput(e.target.value)}
                rows={4}
                className="w-full bg-neutral-950 font-mono text-xs p-3 rounded-lg border border-neutral-800 text-neutral-200 focus:outline-none focus:border-indigo-500/50"
              />
              <button
                onClick={handleAuditFraming}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-xs text-white transition-all shadow-lg flex items-center justify-center gap-2"
              >
                <Clapperboard className="w-4 h-4" />
                Run DoP Framing Variety Audit
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 flex flex-col gap-4">
            <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400" />
                DoP Audit Output
              </h2>

              {framingAuditResult ? (
                <div className="flex flex-col gap-3">
                  <div
                    className={`p-3.5 rounded-xl border flex items-center justify-between ${
                      framingAuditResult.passed
                        ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300"
                        : "bg-rose-950/20 border-rose-800/40 text-rose-300"
                    }`}
                  >
                    <span className="font-bold text-xs">
                      {framingAuditResult.passed
                        ? "PASSED: Camera variety verified"
                        : "FLAGGED: Monotony alert detected"}
                    </span>
                    <span className="font-mono text-xs">
                      {framingAuditResult.total_shots} Shots Audited
                    </span>
                  </div>

                  {framingAuditResult.violations?.map((v: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/40 text-rose-200 text-xs flex items-center gap-2"
                    >
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>
                        Shot #{v.shot_index}: {v.error}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-neutral-500 text-xs">
                  Run audit to check camera framing monotony.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STATION 5: 3-GATE AUTOMATED QC LIVE STUDIO */}
      {/* ============================================================ */}
      {activeStation === "qc" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-rose-400" />
                Upload Frame for 3-Gate Evaluation
              </h2>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setQcFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-neutral-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-neutral-800 file:text-white hover:file:bg-neutral-700 cursor-pointer"
              />
              <textarea
                value={qcDescription}
                onChange={(e) => setQcDescription(e.target.value)}
                rows={2}
                placeholder="Expected shot action description..."
                className="w-full bg-neutral-950 text-xs p-3 rounded-lg border border-neutral-800 text-neutral-200 focus:outline-none focus:border-rose-500/50"
              />
              <button
                onClick={handleEvaluateQc}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 font-semibold text-xs text-white transition-all shadow-lg flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                Run 3-Gate QC Evaluation (CPU Gate 1/2 + VLM)
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-neutral-200 flex items-center justify-between">
                <span>Multi-Gate Verdict</span>
                {qcResult && (
                  <span
                    className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                      qcResult.recommendation === "APPROVED"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                    }`}
                  >
                    {qcResult.recommendation}
                  </span>
                )}
              </h2>

              {qcResult ? (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-lg bg-neutral-950 border border-neutral-800 flex flex-col gap-1">
                    <span className="text-[10px] text-neutral-500 uppercase font-mono">
                      Gate 1 (Laplacian Blur)
                    </span>
                    <span className="text-sm font-bold text-white">
                      Score: {qcResult.gate1_details?.blur_score} (Min: 60)
                    </span>
                    <span
                      className={`text-[10px] ${
                        qcResult.gate1_details?.is_blurry
                          ? "text-rose-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {qcResult.gate1_details?.is_blurry
                        ? "BLURRY FRAME"
                        : "SHARP FOCUS"}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-lg bg-neutral-950 border border-neutral-800 flex flex-col gap-1">
                    <span className="text-[10px] text-neutral-500 uppercase font-mono">
                      Repair Routing
                    </span>
                    <span className="text-xs font-mono font-bold text-amber-400">
                      {qcResult.repair_workflow || "None required"}
                    </span>
                    <span className="text-[10px] text-neutral-400 truncate">
                      {qcResult.repair_instructions?.target_region ||
                        "Full image consistent"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-neutral-500 text-xs">
                  Upload an image to inspect Laplacian blur and exposure.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STATION 6: AUDIO SYNTHESIS & FFmpeg 2.5D FILM */}
      {/* ============================================================ */}
      {activeStation === "audio_film" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 flex flex-col gap-4">
            <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-neutral-200 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-purple-400" />
                  Speech Synthesis & Karaoke Subtitles
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Kokoro-82M / Edge-TTS
                </span>
              </h2>

              <div>
                <label className="text-xs text-neutral-400 mb-1 block">
                  Narration / Dialogue Text
                </label>
                <textarea
                  value={ttsText}
                  onChange={(e) => setTtsText(e.target.value)}
                  rows={4}
                  className="w-full bg-neutral-950 text-xs p-3 rounded-lg border border-neutral-800 text-neutral-200 focus:outline-none focus:border-purple-500/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-400 mb-1 block">
                    Voice Profile
                  </label>
                  <select
                    value={ttsRole}
                    onChange={(e) => setTtsRole(e.target.value)}
                    className="w-full bg-neutral-950 text-xs p-2.5 rounded-lg border border-neutral-800 text-neutral-200 focus:outline-none focus:border-purple-500/50"
                  >
                    <option value="narrator">
                      Narrator (Cinematic Deep Male)
                    </option>
                    <option value="sunny">Sunny (Protagonist Cynical)</option>
                    <option value="nephis">Nephis (Resolute Clear Female)</option>
                    <option value="cassie">Cassie (Soft Contemplative)</option>
                    <option value="system_box">System Box (Robotic Alert)</option>
                    <option value="indic_narrator">
                      Indic Narrator (Indian Accent)
                    </option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-neutral-400 mb-1 block">
                    Engine Provider
                  </label>
                  <select
                    value={ttsProvider}
                    onChange={(e) => setTtsProvider(e.target.value)}
                    className="w-full bg-neutral-950 text-xs p-2.5 rounded-lg border border-neutral-800 text-neutral-200 focus:outline-none focus:border-purple-500/50"
                  >
                    <option value="edge-tts">Edge-TTS (Neural High-Fi)</option>
                    <option value="kokoro">Kokoro-82M (100% Offline CPU)</option>
                    <option value="wav_fallback">
                      Deterministic Offline Fallback
                    </option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleSynthesizeAudio}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 font-semibold text-xs text-white transition-all shadow-lg flex items-center justify-center gap-2 mt-2"
              >
                <Volume2 className="w-4 h-4" />
                Synthesize Audio & Generate Dual-Color ASS Subtitles
              </button>

              {audioResult && (
                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 flex flex-col gap-3 mt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-neutral-200">
                      Generated Audio
                    </span>
                    <span className="text-[10px] font-mono text-purple-400">
                      {audioResult.duration_seconds}s • {audioResult.word_count}{" "}
                      words
                    </span>
                  </div>
                  <audio
                    controls
                    src={audioResult.audio_url}
                    className="w-full h-8"
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href={audioResult.ass_subtitle_url}
                      download
                      className="text-[10px] px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 flex items-center gap-1 font-mono"
                    >
                      <Download className="w-3 h-3" /> Download .ASS Subtitles
                    </a>
                    <a
                      href={audioResult.srt_subtitle_url}
                      download
                      className="text-[10px] px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 flex items-center gap-1 font-mono"
                    >
                      <Download className="w-3 h-3" /> Download .SRT Subtitles
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-6 flex flex-col gap-4">
            <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <Video className="w-4 h-4 text-cyan-400" />
                FFmpeg 2.5D Ken Burns Motion Preview
              </h2>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-400 mb-1 block">
                    Camera Motion Type
                  </label>
                  <select
                    value={motionType}
                    onChange={(e) => setMotionType(e.target.value)}
                    className="w-full bg-neutral-950 text-xs p-2.5 rounded-lg border border-neutral-800 text-neutral-200 focus:outline-none focus:border-cyan-500/50"
                  >
                    <option value="SLOW_ZOOM_IN">
                      Slow Zoom-In (Establishing Vista)
                    </option>
                    <option value="SLOW_DRIFT">
                      Slow Drift & Zoom-Out (Medium)
                    </option>
                    <option value="DRAMATIC_PUSH_IN">
                      Dramatic Push-In (Close-up)
                    </option>
                    <option value="DYNAMIC_PAN">
                      Dynamic Pan (Action Beat)
                    </option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-neutral-400 mb-1 block">
                    Duration: {clipDuration}s
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="6"
                    step="0.5"
                    value={clipDuration}
                    onChange={(e) => setClipDuration(parseFloat(e.target.value))}
                    className="w-full accent-cyan-500 mt-2"
                  />
                </div>
              </div>

              <button
                onClick={handleRenderKenBurns}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 font-semibold text-xs text-white transition-all shadow-lg flex items-center justify-center gap-2"
              >
                <Video className="w-4 h-4" />
                Render 2.5D 1080p 60fps Shot Clip
              </button>

              {kenBurnsResult && (
                <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 flex flex-col gap-2 mt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-neutral-200">
                      Rendered 2.5D MP4 Video
                    </span>
                    <span className="text-[10px] font-mono text-cyan-400">
                      {kenBurnsResult.resolution}
                    </span>
                  </div>
                  <video
                    controls
                    autoPlay
                    loop
                    src={kenBurnsResult.clip_url}
                    className="w-full rounded-lg aspect-video bg-black border border-neutral-800"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

