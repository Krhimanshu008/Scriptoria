"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Film,
  Database,
  Clapperboard,
  ShieldCheck,
  Volume2,
  AlertTriangle,
  Video,
  Download,
  Terminal,
  Activity,
  Upload,
  Search,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { LabNavigation } from "@/components/lab/LabNavigation";
import { Station1Ingestion } from "@/components/lab/stations/Station1Ingestion";
import { Station2Extraction } from "@/components/lab/stations/Station2Extraction";
import { LabStation, IngestionMode } from "@/types/lab";

export default function VisualiserLabPage() {
  const [activeStation, setActiveStation] = useState<LabStation>("ingestion");
  const [loading, setLoading] = useState(false);

  // -------------------------------------------------------------
  // Station 1 State: Ingestion & DOM Walker
  // -------------------------------------------------------------
  const [ingestionMode, setIngestionMode] = useState<
    "epub_upload" | "lotm_vol1" | "shadow_slave" | "paste_html"
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
  // Station 2 State: Story Brain & Live Extraction Streaming Terminal
  // -------------------------------------------------------------
  const [station2SubTab, setStation2SubTab] = useState<"stream" | "fingerprints">("stream");
  const [extractionLogs, setExtractionLogs] = useState<
    Array<{
      timestamp: string;
      type: "worker" | "chunker" | "prompt" | "token" | "schema" | "db" | "complete";
      text: string;
      speed?: number;
      data?: any;
    }>
  >([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionSpeed, setExtractionSpeed] = useState<number>(0);
  const [extractedTokensCount, setExtractedTokensCount] = useState<number>(0);
  const [logFilter, setLogFilter] = useState<"ALL" | "WORKER" | "PROMPTS" | "RAW_LLM" | "DB_COMMITS">("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const [extractionSummary, setExtractionSummary] = useState<any>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  // -------------------------------------------------------------
  // Station 2 Legacy State: Deterministic Fingerprint Sandbox
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
  // Station 4 State: Vector RAG & Temporal Context Sandbox
  // -------------------------------------------------------------
  const [ragSelectedNovel, setRagSelectedNovel] = useState<"shadow_slave" | "lotm_vol1">("lotm_vol1");
  const [ragQueryText, setRagQueryText] = useState("Klein weapon revolver potion Seer Neil Ince");
  const [ragStoryTick, setRagStoryTick] = useState(10000);
  const [ragNarrativeTick, setRagNarrativeTick] = useState(1001001001);
  const [ragResult, setRagResult] = useState<any>(null);
  const [ragLoading, setRagLoading] = useState(false);

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

  useEffect(() => {
    if (autoScroll && terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [extractionLogs, autoScroll]);

  const handleStartKnowledgeExtraction = async () => {
    setIsExtracting(true);
    setExtractionLogs([]);
    setExtractionSummary(null);
    setExtractedTokensCount(0);
    setExtractionSpeed(0);

    try {
      const chapterText = ingestionResult?.full_clean_text || undefined;
      const res = await fetch("/api/lab/extract-knowledge-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter_number: selectedChapterIdx || 1,
          chapter_text: chapterText,
          mock_streaming: true,
        }),
      });

      if (!res.ok) throw new Error("Failed to connect to extraction stream");
      if (!res.body) throw new Error("Readable stream unavailable");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const evt of events) {
          if (!evt.trim()) continue;
          const eventMatch = evt.match(/event:\s*(\w+)/);
          const dataMatch = evt.match(/data:\s*([\s\S]+)/);

          if (eventMatch && dataMatch) {
            const eventType = eventMatch[1];
            try {
              const data = JSON.parse(dataMatch[1]);
              const timestamp = data.timestamp || new Date().toLocaleTimeString();

              if (eventType === "worker_assigned") {
                setExtractionLogs((prev) => [
                  ...prev,
                  {
                    timestamp,
                    type: "worker",
                    text: `[WORKER_ASSIGNED] ${data.worker_node} running ${data.model} (${data.backend}) · VRAM: ${data.vram_allocated_gb}GB / ${data.vram_total_gb}GB`,
                    data,
                  },
                ]);
              } else if (eventType === "beat_chunking") {
                setExtractionLogs((prev) => [
                  ...prev,
                  {
                    timestamp,
                    type: "chunker",
                    text: `[BEAT_CHUNKING] ${data.message}`,
                    data,
                  },
                ]);
              } else if (eventType === "prompt_dispatched") {
                setExtractionLogs((prev) => [
                  ...prev,
                  {
                    timestamp,
                    type: "prompt",
                    text: `[PROMPT_DISPATCHED] Dispatched scene prompt (${data.input_tokens} tokens)\nSystem: ${data.system_prompt}\nUser Preview: ${data.user_prompt_preview}`,
                    data,
                  },
                ]);
              } else if (eventType === "token_stream") {
                setExtractionSpeed(data.speed_tps);
                setExtractedTokensCount(data.tokens_generated);
                setExtractionLogs((prev) => [
                  ...prev,
                  {
                    timestamp,
                    type: "token",
                    text: data.chunk,
                    speed: data.speed_tps,
                  },
                ]);
              } else if (eventType === "schema_validated") {
                setExtractionLogs((prev) => [
                  ...prev,
                  {
                    timestamp,
                    type: "schema",
                    text: `[SCHEMA_VALIDATED] ${data.message} (${data.characters_extracted} characters, ${data.claims_count} claims, ${data.state_transitions_count} transitions)`,
                    data,
                  },
                ]);
              } else if (eventType === "db_persisted") {
                setExtractionSummary(data);
                setExtractionLogs((prev) => [
                  ...prev,
                  {
                    timestamp,
                    type: "db",
                    text: `[DB_PERSISTED] ${data.message}`,
                    data,
                  },
                ]);
              } else if (eventType === "extraction_complete") {
                setExtractionLogs((prev) => [
                  ...prev,
                  {
                    timestamp,
                    type: "complete",
                    text: `[COMPLETE] ${data.message} (Avg Speed: ${data.average_speed_tps} tok/s)`,
                    data,
                  },
                ]);
                toast.success("Story Brain Extraction Complete!");
              }
            } catch (err) {
              console.error("SSE parse error", err);
            }
          }
        }
      }
    } catch (e: any) {
      toast.error(e.message || "Extraction stream failed");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleRunRAGQuery = async () => {
    setRagLoading(true);
    try {
      const res = await fetch("/api/lab/rag-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: ragQueryText,
          current_story_tick: ragStoryTick,
          current_narrative_tick: ragNarrativeTick,
          sample_novel: ragSelectedNovel,
          top_k: 5,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "RAG search failed");
      setRagResult(data);
      toast.success(
        `Retrieved in ${data.retrieval_latency_ms}ms · ${data.spoilers_redacted_count} spoilers blocked`
      );
    } catch (e: any) {
      toast.error(e.message || "RAG query error");
    } finally {
      setRagLoading(false);
    }
  };

  // -------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------
  const handleLoadLotmVol1 = async (runFullAudit: boolean = true) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("sample_novel", "lotm_vol1");
      formData.append("chapter_index", "1");

      const endpoint = runFullAudit ? "/api/lab/parse-epub-dom" : "/api/lab/sample-probe";
      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "LOTM Volume 1 loading failed");

      setIngestionResult(data);
      setSelectedChapterIdx(1);
      if (runFullAudit) {
        toast.success(
          `Ingested Lord of the Mysteries - Vol 1: Clown (${data.total_chapters} chapters)! Gate 0 PASS.`
        );
      } else {
        toast.success(
          `Pre-flight Probe Completed (<100ms)! Book Passport & Dossier ready.`
        );
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

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

  const handleUploadDocument = async (file: File, chapterIdx: number = 1) => {
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
        toast.error(`DRM/Password Protection Detected: ${data.drm_error || "File is encrypted"}`);
      } else {
        const docType = data.document_format?.toUpperCase() || (file.name.endsWith(".pdf") ? "PDF" : "EPUB");
        toast.success(
          `Ingested ${docType}: ${data.metadata?.title || file.name} (${
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

  const handleUploadEpub = handleUploadDocument;

  const handleChangeChapter = async (targetChapter: number) => {
    setLoading(true);
    try {
      const formData = new FormData();
      if (ingestionMode === "lotm_vol1") {
        formData.append("sample_novel", "lotm_vol1");
      } else if (ingestionMode === "shadow_slave") {
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
    setActiveStation("extraction");
    toast.success("Chapter context transferred to Station 2 (Story Brain & Live Extraction Terminal)!");
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

      {/* Station Navigation */}
      <LabNavigation
        activeStation={activeStation}
        onSelectStation={setActiveStation}
      />

      {/* ============================================================ */}
      {/* STATION 1: EPUB INGESTION & DOM WALKER */}
      {/* ============================================================ */}
      {activeStation === "ingestion" && (
        <Station1Ingestion
          ingestionMode={ingestionMode}
          setIngestionMode={setIngestionMode}
          uploadedEpubFile={uploadedEpubFile}
          setUploadedEpubFile={setUploadedEpubFile}
          selectedChapterIdx={selectedChapterIdx}
          setSelectedChapterIdx={setSelectedChapterIdx}
          chapterSearch={chapterSearch}
          setChapterSearch={setChapterSearch}
          rawHtmlInput={rawHtmlInput}
          setRawHtmlInput={setRawHtmlInput}
          ingestionResult={ingestionResult}
          textMode={textMode}
          setTextMode={setTextMode}
          loading={loading}
          onUploadDocument={handleUploadDocument}
          onLoadLotmVol1={handleLoadLotmVol1}
          onLoadSampleNovel={handleLoadSampleNovel}
          onChangeChapter={handleChangeChapter}
          onParseEpubDom={handleParseEpubDom}
          onSendToStation2={handleSendToStation2}
          onSendToStation6={handleSendToStation6}
        />
      )}

      {/* ============================================================ */}
      {/* STATION 2: STORY BRAIN & LIVE EXTRACTION TERMINAL */}
      {/* ============================================================ */}
      {activeStation === "extraction" && (
        <Station2Extraction
          isExtracting={isExtracting}
          extractionSpeed={extractionSpeed}
          extractedTokensCount={extractedTokensCount}
          extractionLogs={extractionLogs}
          extractionSummary={extractionSummary}
          logFilter={logFilter}
          setLogFilter={setLogFilter}
          autoScroll={autoScroll}
          setAutoScroll={setAutoScroll}
          onStartExtraction={handleStartKnowledgeExtraction}
          terminalContainerRef={terminalContainerRef}
          onProceedToFoundry={() => setActiveStation("foundry")}
          onProceedToRAG={() => setActiveStation("rag")}
        />
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
      {/* STATION 4: VECTOR RAG & SPOILER-SAFE RETRIEVAL */}
      {/* ============================================================ */}
      {activeStation === "rag" && (
        <div className="flex flex-col gap-6">
          {/* Header & Story Tick Controls */}
          <div className="p-6 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-400">
                  <Search className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    Vector RAG &amp; Bi-Temporal Spoiler Shield
                    <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 font-mono border border-violet-500/30">
                      Checkpoint 4
                    </span>
                  </h2>
                  <p className="text-xs text-neutral-400">
                    Query scene context without leaking future plot points. Lore claims beyond current story tick are automatically suppressed.
                  </p>
                </div>
              </div>

              {/* Story Tick Display */}
              <div className="flex items-center gap-3 bg-neutral-950 p-2 rounded-xl border border-neutral-800 font-mono text-xs">
                <span className="text-neutral-500">Reading Position:</span>
                <span className="text-violet-400 font-bold">
                  Tick #{ragStoryTick.toLocaleString()}
                </span>
                <span className="px-2 py-0.5 rounded bg-neutral-900 text-neutral-300 border border-neutral-800 text-[10px]">
                  {ragSelectedNovel === "lotm_vol1"
                    ? ragStoryTick <= 10000
                      ? "Ch 1-10 (Tingen Awakening)"
                      : ragStoryTick <= 40000
                      ? "Ch 35-40 (Sequence 9 Seer)"
                      : ragStoryTick <= 110000
                      ? "Ch 105 (Old Neil Tragedy)"
                      : ragStoryTick <= 125000
                      ? "Ch 120 (Sequence 8 Clown)"
                      : ragStoryTick <= 212000
                      ? "Ch 211-212 (Ince & 0-08)"
                      : "Ch 213 (Clown Smile Finale)"
                    : ragStoryTick <= 5000
                    ? "Chapter 1-5"
                    : ragStoryTick <= 30000
                    ? "Chapter 15-30"
                    : "Chapter 50+"}
                </span>
              </div>
            </div>

            {/* Benchmark Novel Switcher */}
            <div className="flex items-center gap-2 pt-2 border-t border-neutral-800">
              <span className="text-xs text-neutral-400 font-medium">Benchmark Corpus:</span>
              <button
                onClick={() => {
                  setRagSelectedNovel("lotm_vol1");
                  setRagQueryText("Klein weapon revolver potion Seer Neil Ince");
                  setRagStoryTick(10000);
                  setRagNarrativeTick(1001001001);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  ragSelectedNovel === "lotm_vol1"
                    ? "bg-violet-600 text-white shadow"
                    : "bg-neutral-950 text-neutral-400 hover:text-white border border-neutral-800"
                }`}
              >
                Lord of the Mysteries (Vol 1: Clown · 213 Ch)
              </button>
              <button
                onClick={() => {
                  setRagSelectedNovel("shadow_slave");
                  setRagQueryText("Sunny weapon shackles true name");
                  setRagStoryTick(1500);
                  setRagNarrativeTick(1000101001);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  ragSelectedNovel === "shadow_slave"
                    ? "bg-amber-600 text-white shadow"
                    : "bg-neutral-950 text-neutral-400 hover:text-white border border-neutral-800"
                }`}
              >
                Shadow Slave (Vol 1-7)
              </button>
            </div>

            {/* Slider */}
            <div className="flex flex-col gap-2 pt-2 border-t border-neutral-800">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>Story Tick Slider (Simulate novel reading progression):</span>
                <span className="font-mono text-cyan-400 font-semibold">{ragStoryTick.toLocaleString()} ticks</span>
              </div>
              <input
                type="range"
                min={1000}
                max={ragSelectedNovel === "lotm_vol1" ? 220000 : 60000}
                step={1000}
                value={ragStoryTick}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setRagStoryTick(val);
                  setRagNarrativeTick(1000000000 + val * 1000);
                }}
                className="w-full accent-violet-500 cursor-pointer"
              />
              {ragSelectedNovel === "lotm_vol1" ? (
                <div className="flex justify-between text-[10px] text-neutral-500 font-mono">
                  <span>Ch 1 (Tick 1k)</span>
                  <span>Ch 35 (Tick 35k - Seer)</span>
                  <span>Ch 105 (Tick 105k - Old Neil)</span>
                  <span>Ch 120 (Tick 120k - Clown)</span>
                  <span>Ch 212 (Tick 212k - 0-08)</span>
                  <span>Ch 213 (Vol 1 Finale)</span>
                </div>
              ) : (
                <div className="flex justify-between text-[10px] text-neutral-500 font-mono">
                  <span>Ch 1 (Tick 1,000)</span>
                  <span>Ch 15 (Tick 15,000)</span>
                  <span>Ch 25 (Tick 25,000 - True Name Reveal)</span>
                  <span>Ch 50 (Tick 50,000)</span>
                </div>
              )}
            </div>

            {/* Search Query Input */}
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={ragQueryText}
                  onChange={(e) => setRagQueryText(e.target.value)}
                  placeholder="Enter context search query..."
                  className="flex-1 bg-neutral-950 text-xs p-3 rounded-lg border border-neutral-800 text-neutral-100 focus:outline-none focus:border-violet-500/50"
                />
                <button
                  onClick={handleRunRAGQuery}
                  disabled={ragLoading}
                  className="px-6 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-neutral-800 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-lg"
                >
                  {ragLoading ? (
                    <Activity className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  Run RAG Query
                </button>
              </div>

              {/* Quick Preset Queries */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
                <span>Quick Test Queries:</span>
                {(ragSelectedNovel === "lotm_vol1"
                  ? [
                      "Klein weapon revolver",
                      "Sequence 9 Seer potion",
                      "Old Neil Hidden Sage corruption",
                      "Ince Zangwill Quill 0-08 betrayal",
                      "Detective Sherlock Moriarty (Vol 2 Spoiler)",
                    ]
                  : [
                      "Sunny weapon shackles",
                      "Lost from Light secret true name",
                      "Caravan Overseer scar whip",
                      "Dark shrine nightmare creature",
                    ]
                ).map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setRagQueryText(q);
                    }}
                    className="px-2 py-0.5 rounded bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 font-mono text-[10px] transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* RAG Query Results */}
          {ragResult && (
            <div className="flex flex-col gap-4">
              {/* Spoiler Shield Banner */}
              <div
                className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
                  ragResult.spoilers_redacted_count > 0
                    ? "bg-rose-950/20 border-rose-800/40 text-rose-300"
                    : "bg-emerald-950/20 border-emerald-800/40 text-emerald-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  {ragResult.spoilers_redacted_count > 0 ? (
                    <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
                  ) : (
                    <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                  )}
                  <div className="text-xs">
                    <span className="font-bold">
                      {ragResult.spoilers_redacted_count > 0
                        ? `Temporal Spoiler Shield Active: ${ragResult.spoilers_redacted_count} future plot spoiler(s) redacted!`
                        : "Temporal Spoiler Shield Active: 0 future spoilers found."}
                    </span>{" "}
                    <span className="opacity-80">
                      (Query executed at Story Tick #{ragStoryTick} in {ragResult.retrieval_latency_ms}ms)
                    </span>
                  </div>
                </div>

                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/40 border border-current font-bold">
                  SPOILER SHIELD LOCKED
                </span>
              </div>

              {/* Two Column Results */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Matched Passages */}
                <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
                  <h3 className="text-xs font-semibold text-neutral-200 flex items-center justify-between">
                    <span>Retrieved Prose Passages</span>
                    <span className="text-[10px] text-neutral-400 font-mono">
                      {ragResult.passages?.length || 0} Excerpts
                    </span>
                  </h3>

                  <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1">
                    {ragResult.passages?.map((p: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs flex flex-col gap-1.5"
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
                          <span className="text-cyan-400 font-bold">
                            {p.canonical_id} • Ch.{p.chapter_number}
                          </span>
                          <span className="px-1.5 py-0.2 rounded bg-neutral-900 text-neutral-300">
                            Sim: {(p.similarity_score * 100).toFixed(0)}%
                          </span>
                        </div>
                        <p className="text-neutral-300 leading-relaxed text-xs">
                          {p.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Matched Lore Claims */}
                <div className="p-5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col gap-3">
                  <h3 className="text-xs font-semibold text-neutral-200 flex items-center justify-between">
                    <span>Active Lore Claims (Tick &le; #{ragStoryTick})</span>
                    <span className="text-[10px] text-neutral-400 font-mono">
                      {ragResult.lore_claims?.length || 0} Claims
                    </span>
                  </h3>

                  <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1">
                    {ragResult.lore_claims?.map((c: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs flex flex-col gap-1.5"
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono">
                          <span className="text-white font-bold">
                            {c.canonical_name} ({c.entity_code})
                          </span>
                          <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Tick #{c.valid_from_tick}
                          </span>
                        </div>
                        <div className="text-xs text-neutral-300">
                          <span className="text-neutral-500 font-mono text-[11px] mr-1">
                            {c.attribute}:
                          </span>
                          <span className="text-cyan-300 font-semibold">{c.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* STATION 5: CO-DIRECTOR & STORYBOARD */}
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

