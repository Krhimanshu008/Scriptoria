"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Clapperboard,
  Camera,
  Film,
  Layers,
  Sparkles,
  Copy,
  Check,
  ChevronRight,
  Sliders,
  Play,
  Pause,
  User,
  MapPin,
  Clock,
  Eye,
  Info,
  Volume2,
  Tv,
  Send,
  Radio,
  Upload,
  ExternalLink,
  FileText,
  Headphones,
  Music,
  BookOpen,
  Cpu,
  RefreshCw,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  HighDensityChapterStoryboard,
  MacroScene,
  SubSceneFrame,
} from "@/types/testbench-contracts";

interface BookOption {
  id?: string;
  book_id?: string;
  title: string;
  author?: string;
  total_chapters?: number;
  status?: string;
  slug?: string;
}

export function FlowTtsWorkstation() {
  // Book & Chapter Selection
  const [books, setBooks] = useState<BookOption[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string>("31d94e54-6308-488b-a6fc-1085ee418d7c");
  const [selectedChapterIdx, setSelectedChapterIdx] = useState<number>(1);
  const [chapterTitle, setChapterTitle] = useState<string>("Chapter 1: Loomings");
  const [chapterText, setChapterText] = useState<string>("");

  // Configuration States
  const [targetFrames, setTargetFrames] = useState<number>(90);
  const [globalStyle, setGlobalStyle] = useState<string>("cinematic dramatic chiaroscuro, 35mm film grain, atmospheric rim lighting, aspect ratio 16:9");
  const [engine, setEngine] = useState<"deterministic" | "multi_ai_brain" | "qwen_swarm">("qwen_swarm");
  const [viewMode, setViewMode] = useState<"grid" | "theater">("grid");
  const [isDecomposing, setIsDecomposing] = useState(false);
  const [storyboard, setStoryboard] = useState<HighDensityChapterStoryboard | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [copiedFrameIdx, setCopiedFrameIdx] = useState<number | null>(null);
  const [allPromptsCopied, setAllPromptsCopied] = useState(false);
  const [isDispatchingFlow, setIsDispatchingFlow] = useState(false);

  // AI Studio 3.8 TTS Playground States
  const [isTtsModalOpen, setIsTtsModalOpen] = useState(false);
  const [screenplayScript, setScreenplayScript] = useState<string>("");
  const [isFormattingScreenplay, setIsFormattingScreenplay] = useState(false);
  const [isPushingPlayground, setIsPushingPlayground] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  // AV Player Theater Mode States
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudioTime, setCurrentAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeFrameIndex, setActiveFrameIndex] = useState<number>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load books on mount
  useEffect(() => {
    async function loadBooks() {
      try {
        const res = await fetch("/api/pipeline/books");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.books) && data.books.length > 0) {
            setBooks(data.books);
            const parsedMoby = data.books.find(
              (b: any) =>
                (b.title?.toLowerCase().includes("moby") || b.slug?.toLowerCase().includes("moby")) &&
                (b.status === "PARSED" || (b.total_chapters && b.total_chapters > 0))
            ) || data.books.find((b: any) => b.title?.toLowerCase().includes("moby") || b.slug?.toLowerCase().includes("moby"));
            if (parsedMoby) {
              setSelectedBookId(parsedMoby.book_id || parsedMoby.id);
            } else if (data.books[0]) {
              setSelectedBookId(data.books[0].book_id || data.books[0].id);
            }
          }
        }
      } catch {
        // Fallback default
      }
    }
    loadBooks();
  }, []);

  // Fetch chapter text from R2 whenever selected book or chapter changes
  useEffect(() => {
    async function loadChapterProse() {
      const bookId = selectedBookId || "31d94e54-6308-488b-a6fc-1085ee418d7c";
      try {
        const chKey = `parsed/${bookId}/ch_${String(selectedChapterIdx).padStart(3, "0")}.md`;
        const res = await fetch(`/api/pipeline/r2/object?key=${encodeURIComponent(chKey)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.content && typeof data.content === "string") {
            setChapterText(data.content);
          }
        }
      } catch {
        // Non-fatal
      }
    }
    loadChapterProse();
  }, [selectedBookId, selectedChapterIdx]);

  // Flattened frames list for theater playback
  const allFlatFrames: SubSceneFrame[] = React.useMemo(() => {
    if (!storyboard) return [];
    const frames: SubSceneFrame[] = [];
    storyboard.scenes.forEach((sc) => {
      sc.sub_scenes.forEach((sub) => {
        frames.push(sub);
      });
    });
    return frames.sort((a, b) => a.frame_index - b.frame_index);
  }, [storyboard]);

  // Audio Playback Listener & Real-time Frame Cutting
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const cur = audio.currentTime;
      setCurrentAudioTime(cur);

      // Match current audio second to active subscene frame
      const matching = allFlatFrames.find(
        (f) =>
          f.audio_start_sec !== undefined &&
          f.audio_end_sec !== undefined &&
          cur >= (f.audio_start_sec || 0) &&
          cur < (f.audio_end_sec || 0)
      );

      if (matching && matching.frame_index !== activeFrameIndex) {
        setActiveFrameIndex(matching.frame_index);
      }
    };

    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [allFlatFrames, activeFrameIndex]);

  // Compute active theater frame
  const activeTheaterFrame = React.useMemo(() => {
    if (allFlatFrames.length === 0) return null;
    return allFlatFrames.find((f) => f.frame_index === activeFrameIndex) || allFlatFrames[0];
  }, [allFlatFrames, activeFrameIndex]);

  // Handle Decompose Chapter Execution
  const handleDecompose = async () => {
    setIsDecomposing(true);
    const bookIdToSend = selectedBookId || "31d94e54-6308-488b-a6fc-1085ee418d7c";
    try {
      const res = await fetch("/api/pipeline/storyboard/decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookIdToSend,
          chapter_index: selectedChapterIdx,
          chapter_title: chapterTitle,
          raw_text: chapterText.trim().length > 50 ? chapterText : "",
          target_frames: targetFrames,
          global_style: globalStyle,
          engine: engine,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error?.message || `Server returned ${res.status}`);
      }

      const data: HighDensityChapterStoryboard = await res.json();
      setStoryboard(data);
      if (data.scenes && data.scenes.length > 0) {
        setSelectedSceneId(data.scenes[0].scene_id);
      }

      // Calculate total duration from last frame
      let maxDuration = 180;
      data.scenes.forEach((sc) => {
        sc.sub_scenes.forEach((sub) => {
          if (sub.audio_end_sec && sub.audio_end_sec > maxDuration) {
            maxDuration = sub.audio_end_sec;
          }
        });
      });
      setAudioDuration(maxDuration);
      if (data.audio_track_url) {
        setAudioUrl(data.audio_track_url);
      }

      const engineName =
        engine === "qwen_swarm"
          ? "Dual Kaggle Qwen Swarm (Acc 2 Director + Acc 1 Cinematographer)"
          : engine === "multi_ai_brain"
          ? "Google AI Studio Gemini Brain"
          : "Deterministic NLP Engine";

      toast.success(
        `Generated ${data.total_frames} atomic frames across ${data.scenes.length} macro scenes via ${engineName}!`
      );
    } catch (err: any) {
      toast.error(`Decomposition failed: ${err.message}`);
    } finally {
      setIsDecomposing(false);
    }
  };

  // Format 3.8 TTS Screenplay
  const handleFormatScreenplay = async () => {
    if (!storyboard) {
      toast.error("Decompose a chapter first to generate the scene structure.");
      return;
    }
    setIsFormattingScreenplay(true);
    try {
      const res = await fetch("/api/pipeline/storyboard/tts/format-screenplay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: storyboard.book_id || selectedBookId,
          chapter_index: storyboard.chapter_index || selectedChapterIdx,
          chapter_title: storyboard.chapter_title || chapterTitle,
          raw_text: chapterText,
          storyboard,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error?.message || "Screenplay formatting failed");
      const script = data.screenplay_text || data.formatted_screenplay || "";
      setScreenplayScript(script);
      setIsTtsModalOpen(true);
      const words = data.total_words || data.word_count || 0;
      const dur = data.estimated_audio_duration_sec || data.estimated_duration_seconds || Math.round(words / 2.33);
      toast.success(`Screenplay formatted for 3.8 TTS (${words} words, ~${Math.round(dur / 60)} min audio)`);
    } catch (err: any) {
      toast.error(`Screenplay generation error: ${err.message}`);
    } finally {
      setIsFormattingScreenplay(false);
    }
  };

  // Dispatch to open Google AI Studio Tab via WebSocket companion
  const handlePushPlayground = async () => {
    if (!screenplayScript) {
      toast.error("Screenplay script is empty. Format screenplay first.");
      return;
    }
    setIsPushingPlayground(true);
    try {
      const res = await fetch("/api/pipeline/storyboard/tts/dispatch-playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: storyboard?.book_id || selectedBookId,
          chapter_index: storyboard?.chapter_index || selectedChapterIdx,
          screenplay_text: screenplayScript,
          voice_model: "google-3.8-tts",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Playground dispatch failed");
      toast.success(data.message || "Dispatched screenplay to open Google AI Studio tab!");
    } catch (err: any) {
      toast.error(`Dispatch error: ${err.message}. Ensure Google AI Studio Playground tab is open with Scriptoria extension.`);
    } finally {
      setIsPushingPlayground(false);
    }
  };

  // Copy Screenplay to Clipboard
  const handleCopyScreenplay = () => {
    if (!screenplayScript) return;
    navigator.clipboard.writeText(screenplayScript);
    toast.success("3.8 TTS Screenplay copied! Paste directly into Google AI Studio Playground.");
  };

  // Upload/Attach Audio File
  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingAudio(true);
    try {
      const formData = new FormData();
      formData.append("audio_file", file);
      formData.append("book_id", storyboard?.book_id || selectedBookId);
      formData.append("chapter_index", String(storyboard?.chapter_index || selectedChapterIdx));

      const res = await fetch("/api/pipeline/storyboard/audio/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Audio upload failed");

      setAudioUrl(data.audio_url);
      setAudioDuration(data.duration_sec);
      toast.success(`Attached 3.8 Master Audio Track (${Math.round(data.duration_sec)}s)! Ready for AV Sync Play.`);
    } catch (err: any) {
      toast.error(`Audio upload failed: ${err.message}`);
    } finally {
      setIsUploadingAudio(false);
      if (audioFileInputRef.current) audioFileInputRef.current.value = "";
    }
  };

  // Batch Dispatch to Flow Extension
  const handleBatchDispatchFlow = async () => {
    if (!storyboard) {
      toast.error("No storyboard frames to dispatch.");
      return;
    }
    setIsDispatchingFlow(true);
    try {
      const framesPayload = allFlatFrames.map((f) => ({
        frame_index: f.frame_index,
        scene_id: f.scene_id,
        prompt: f.compiled_image_prompt,
        shot_type: f.shot_type,
        lens: f.lens,
        verbatim_excerpt: f.sentence_span,
      }));

      const res = await fetch("/api/pipeline/storyboard/flow/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: storyboard.book_id,
          chapter_index: storyboard.chapter_index,
          chapter_title: storyboard.chapter_title,
          frames: framesPayload,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Batch dispatch failed");

      toast.success(
        `Dispatched ${data.dispatched_count} frames to Google Flow Bridge! Check Companion Extension tab.`
      );
    } catch (err: any) {
      toast.error(`Flow Dispatch Error: ${err.message}`);
    } finally {
      setIsDispatchingFlow(false);
    }
  };

  // Copy Single Frame Prompt
  const handleCopyPrompt = (idx: number, prompt: string) => {
    navigator.clipboard.writeText(prompt);
    setCopiedFrameIdx(idx);
    setTimeout(() => setCopiedFrameIdx(null), 2000);
    toast.success(`Copied Frame #${idx} prompt`);
  };

  // Copy All Prompts
  const handleCopyAllPrompts = () => {
    if (!storyboard) return;
    const all = allFlatFrames
      .map((f) => `[FRAME #${String(f.frame_index).padStart(2, "0")} | ${f.shot_type} ${f.lens}]\n${f.compiled_image_prompt}`)
      .join("\n\n---\n\n");
    navigator.clipboard.writeText(all);
    setAllPromptsCopied(true);
    setTimeout(() => setAllPromptsCopied(false), 2500);
    toast.success(`Copied all ${allFlatFrames.length} prompts to clipboard!`);
  };

  // Player controls
  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch((e) => toast.error("Audio playback error: " + e.message));
    }
  };

  const handleSeek = (sec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = sec;
    setCurrentAudioTime(sec);
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const activeScene = storyboard?.scenes.find((s) => s.scene_id === selectedSceneId) || storyboard?.scenes[0];

  return (
    <div className="space-y-4">
      {/* Header & Cluster Status Bar */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Clapperboard className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-zinc-100">
                  Google Flow & AI Studio 3.8 TTS Storyboard Studio
                </h1>
                <span className="rounded bg-indigo-500/15 border border-indigo-500/40 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                  Dual-Kaggle Swarm
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Transforms novel chapters (~2,000 words) into 80–100 atomic visual beats with zero context loss, Flow batch generation, and synchronized 3.8 TTS audio play.
              </p>
            </div>
          </div>

          {/* Active Cluster Status Pill */}
          <div className="flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold">Kaggle Swarm Online</span>
            <span className="text-zinc-500">|</span>
            <span className="text-[11px] text-zinc-300 font-mono">Acc 2 (27B) + Acc 1 (5M)</span>
          </div>
        </div>

        {/* Configuration Controls Bar */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end">
          {/* Book Selector */}
          <div className="lg:col-span-2">
            <label className="text-[11px] font-medium text-zinc-400 block mb-1 flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5 text-amber-400" /> Active Novel
            </label>
            <select
              value={selectedBookId}
              onChange={(e) => setSelectedBookId(e.target.value)}
              className="w-full h-8 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
            >
              {books.length > 0 ? (
                books.map((b) => {
                  const id = b.book_id || b.id;
                  const chapterLabel = b.total_chapters ? `${b.total_chapters} chapters` : b.status || "uploaded";
                  return (
                    <option key={id} value={id}>
                      {b.title} ({chapterLabel})
                    </option>
                  );
                })
              ) : (
                <option value="31d94e54-6308-488b-a6fc-1085ee418d7c">
                  herman-melville_moby-dick (147 chapters - PARSED)
                </option>
              )}
            </select>
          </div>

          {/* Chapter Selector */}
          <div>
            <label className="text-[11px] font-medium text-zinc-400 block mb-1">
              Chapter Index
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={150}
                value={selectedChapterIdx}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  setSelectedChapterIdx(val);
                  setChapterTitle(`Chapter ${val}: Loomings`);
                }}
                className="w-full h-8 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none font-mono"
              />
            </div>
          </div>

          {/* Target Frames */}
          <div>
            <label className="text-[11px] font-medium text-zinc-400 block mb-1">
              Target Frames
            </label>
            <input
              type="number"
              min={40}
              max={150}
              value={targetFrames}
              onChange={(e) => setTargetFrames(parseInt(e.target.value) || 90)}
              className="w-full h-8 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none font-mono"
            />
          </div>

          {/* AI Engine */}
          <div>
            <label className="text-[11px] font-medium text-zinc-400 block mb-1">
              AI Brain Engine
            </label>
            <select
              value={engine}
              onChange={(e: any) => setEngine(e.target.value)}
              className="w-full h-8 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
            >
              <option value="qwen_swarm">⚡ Dual Kaggle Qwen Swarm</option>
              <option value="multi_ai_brain">Google AI Studio (Gemini 3.5)</option>
              <option value="deterministic">Deterministic Canonical NLP</option>
            </select>
          </div>

          {/* Decompose CTA */}
          <div>
            <button
              onClick={handleDecompose}
              disabled={isDecomposing}
              className="w-full h-8 rounded bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-zinc-950 font-semibold text-xs flex items-center justify-center gap-1.5 shadow transition disabled:opacity-50"
            >
              {isDecomposing ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Decomposing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Decompose Chapter</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Workspace Area */}
      {storyboard ? (
        <div className="space-y-4">
          {/* Top Actions & Stats Ribbon */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex items-center gap-4 text-xs">
              <span className="text-zinc-400">
                Chapter: <strong className="text-zinc-100">{storyboard.chapter_title}</strong>
              </span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400">
                Total Words: <strong className="text-zinc-100">{storyboard.total_words}</strong>
              </span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400">
                Total Frames: <strong className="text-amber-400 font-mono font-semibold">{storyboard.total_frames}</strong>
              </span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400">
                Runtime: <strong className="text-zinc-100">{formatTime(audioDuration || 882)}</strong> (~{Math.round((storyboard.total_words / storyboard.total_frames) * 10) / 10} words/shot)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* View Switcher */}
              <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`px-2.5 py-1 rounded font-medium flex items-center gap-1.5 transition ${
                    viewMode === "grid" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Film className="h-3 w-3" /> Filmstrip Grid
                </button>
                <button
                  onClick={() => setViewMode("theater")}
                  className={`px-2.5 py-1 rounded font-medium flex items-center gap-1.5 transition ${
                    viewMode === "theater" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Tv className="h-3 w-3" /> Theater Mode (AV Sync)
                </button>
              </div>

              {/* Format 3.8 TTS Screenplay Button */}
              <button
                onClick={handleFormatScreenplay}
                disabled={isFormattingScreenplay}
                className="h-7 px-3 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1.5 border border-zinc-700 transition"
              >
                {isFormattingScreenplay ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Radio className="h-3 w-3 text-rose-400" />}
                Format 3.8 TTS Screenplay
              </button>

              {/* Flow Batch Dispatch Button */}
              <button
                onClick={handleBatchDispatchFlow}
                disabled={isDispatchingFlow}
                className="h-7 px-3 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow transition disabled:opacity-50"
              >
                {isDispatchingFlow ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Batch Dispatch to Flow ({storyboard.total_frames})
              </button>

              {/* Copy All Prompts */}
              <button
                onClick={handleCopyAllPrompts}
                className="h-7 px-2.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-xs flex items-center gap-1 transition"
                title="Copy all 90 modular prompts"
              >
                {allPromptsCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* THEATER MODE AV SYNC VIEW */}
          {viewMode === "theater" && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <div className="flex items-center gap-2">
                  <Tv className="h-4 w-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-zinc-200">
                    Audio-Visual Sync Theater Player
                  </h3>
                  <span className="text-[11px] text-zinc-400">
                    (Frame {activeTheaterFrame?.frame_index || 1} of {allFlatFrames.length})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={audioFileInputRef}
                    onChange={handleAudioUpload}
                    accept="audio/*"
                    className="hidden"
                  />
                  <button
                    onClick={() => audioFileInputRef.current?.click()}
                    disabled={isUploadingAudio}
                    className="h-6 px-2.5 rounded bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-zinc-300 text-[11px] flex items-center gap-1.5 transition"
                  >
                    <Upload className="h-3 w-3 text-amber-400" />
                    {audioUrl ? "Replace 3.8 Audio" : "Attach 3.8 Master Audio"}
                  </button>
                </div>
              </div>

              {/* Hidden HTML5 Audio Element */}
              <audio
                ref={audioRef}
                src={audioUrl || "/media/demo_narration.mp3"}
                onEnded={() => setIsPlaying(false)}
              />

              {/* Main Theater Display Canvas */}
              <div className="relative aspect-video w-full rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col justify-between shadow-2xl">
                {/* Visual Placeholder / Rendered Flow Asset */}
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
                  <div className="text-center p-6 max-w-lg space-y-3">
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 border border-zinc-800 text-amber-400 shadow-inner">
                      <Camera className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="text-xs uppercase font-mono text-zinc-400 tracking-wider">
                        {activeTheaterFrame?.shot_type} • {activeTheaterFrame?.lens}
                      </div>
                      <div className="text-sm font-medium text-zinc-200 mt-1 line-clamp-2">
                        {activeTheaterFrame?.compiled_image_prompt}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Top Overlay Badge */}
                <div className="relative z-10 flex items-center justify-between p-3 bg-gradient-to-b from-black/80 to-transparent">
                  <span className="rounded bg-black/60 border border-zinc-700 px-2 py-0.5 text-xs font-mono font-semibold text-amber-400">
                    Frame #{String(activeTheaterFrame?.frame_index || 1).padStart(2, "0")}
                  </span>
                  <span className="text-xs text-zinc-300 bg-black/60 px-2 py-0.5 rounded border border-zinc-800">
                    {formatTime(activeTheaterFrame?.audio_start_sec || 0)} - {formatTime(activeTheaterFrame?.audio_end_sec || 0)}
                  </span>
                </div>

                {/* Bottom Subtitle / Sentence Anchor Bar */}
                <div className="relative z-10 p-4 bg-gradient-to-t from-black/95 via-black/80 to-transparent text-center">
                  <p className="text-sm sm:text-base font-serif italic text-zinc-100 max-w-2xl mx-auto drop-shadow">
                    &ldquo;{activeTheaterFrame?.sentence_span || "Call me Ishmael..."}&rdquo;
                  </p>
                </div>
              </div>

              {/* Master Audio Playback Controls */}
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    className="h-8 w-8 rounded-full bg-amber-500 hover:bg-amber-400 text-zinc-950 flex items-center justify-center shadow transition"
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
                  </button>

                  {/* Scrubber Bar */}
                  <div className="flex-1 flex items-center gap-2">
                    <span className="text-xs font-mono text-zinc-400 w-10 text-right">
                      {formatTime(currentAudioTime)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={audioDuration || 882}
                      step={0.1}
                      value={currentAudioTime}
                      onChange={(e) => handleSeek(parseFloat(e.target.value))}
                      className="flex-1 h-1.5 rounded-lg bg-zinc-800 accent-amber-500 cursor-pointer"
                    />
                    <span className="text-xs font-mono text-zinc-400 w-10">
                      {formatTime(audioDuration || 882)}
                    </span>
                  </div>
                </div>

                {/* Horizontal Filmstrip Scrubber Track */}
                <div className="flex items-center gap-1.5 overflow-x-auto py-2 no-scrollbar border-t border-zinc-800/60 mt-1">
                  {allFlatFrames.map((f) => (
                    <button
                      key={f.frame_index}
                      onClick={() => {
                        setActiveFrameIndex(f.frame_index);
                        handleSeek(f.audio_start_sec || 0);
                      }}
                      className={`h-12 w-20 shrink-0 rounded border text-[10px] font-mono flex flex-col items-center justify-between p-1 transition ${
                        f.frame_index === activeFrameIndex
                          ? "border-amber-400 bg-amber-500/20 text-amber-200"
                          : "border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-600"
                      }`}
                    >
                      <span>#{f.frame_index}</span>
                      <span className="text-[9px] text-zinc-500">{f.shot_type.slice(0, 4)}</span>
                      <span className="text-[8px] text-zinc-400">{formatTime(f.audio_start_sec || 0)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FILMSTRIP GRID VIEW */}
          {viewMode === "grid" && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {/* Left Column: Macro Scene Selector */}
              <div className="lg:col-span-1 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 px-1">
                  Macro Scenes ({storyboard.scenes.length})
                </h4>
                <div className="space-y-1.5">
                  {storyboard.scenes.map((sc) => (
                    <button
                      key={sc.scene_id}
                      onClick={() => setSelectedSceneId(sc.scene_id)}
                      className={`w-full text-left p-3 rounded-lg border transition ${
                        sc.scene_id === selectedSceneId
                          ? "border-amber-500/60 bg-amber-500/10 text-zinc-100"
                          : "border-zinc-800/80 bg-zinc-900/40 text-zinc-400 hover:bg-zinc-800/40"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>Scene {sc.scene_order}</span>
                        <span className="text-[10px] text-amber-400 font-mono">
                          {sc.sub_scenes.length} frames
                        </span>
                      </div>
                      <div className="text-xs font-medium text-zinc-200 mt-1 line-clamp-1">
                        {sc.scene_heading}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-1 line-clamp-2">
                        {sc.summary}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Right Column: Micro-Beats & Visual Prompts */}
              <div className="lg:col-span-3 space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-200">
                      {activeScene?.scene_heading || "Scene Beats"}
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {activeScene?.sub_scenes.length} atomic visual frames generated for this dramatic arc.
                    </p>
                  </div>
                  <span className="text-xs font-mono text-zinc-400">
                    {activeScene?.location_handle}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[680px] overflow-y-auto pr-1">
                  {activeScene?.sub_scenes.map((sub) => (
                    <div
                      key={sub.frame_index}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 flex flex-col justify-between space-y-2 hover:border-zinc-700 transition"
                    >
                      <div>
                        {/* Frame Header */}
                        <div className="flex items-center justify-between text-xs border-b border-zinc-800/60 pb-1.5">
                          <span className="font-mono font-bold text-amber-400">
                            Frame #{String(sub.frame_index).padStart(2, "0")}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-300">
                              {sub.shot_type}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-indigo-300">
                              {sub.lens}
                            </span>
                          </div>
                        </div>

                        {/* Verbatim Excerpt */}
                        <p className="text-xs font-serif italic text-zinc-300 mt-2 line-clamp-2">
                          &ldquo;{sub.sentence_span}&rdquo;
                        </p>

                        {/* Modular Generation Prompt */}
                        <div className="mt-2 rounded bg-zinc-950/80 p-2 text-[11px] text-zinc-400 font-mono line-clamp-3">
                          {sub.compiled_image_prompt}
                        </div>
                      </div>

                      {/* Card Footer: Timestamp & Action */}
                      <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60 text-[10px] text-zinc-500">
                        <span className="font-mono">
                          {formatTime(sub.audio_start_sec || 0)} - {formatTime(sub.audio_end_sec || 0)}
                        </span>
                        <button
                          onClick={() => handleCopyPrompt(sub.frame_index, sub.compiled_image_prompt)}
                          className="flex items-center gap-1 text-zinc-400 hover:text-amber-400 transition"
                        >
                          {copiedFrameIdx === sub.frame_index ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          Copy Prompt
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Empty State */
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-12 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-zinc-400 mb-3">
            <Film className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-200">No Storyboard Generated Yet</h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto mt-1 mb-4">
            Select your novel chapter above and click <strong>Decompose Chapter</strong> to partition it into 80–100 atomic visual frames with the Dual-Kaggle Swarm.
          </p>
          <button
            onClick={handleDecompose}
            disabled={isDecomposing}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs inline-flex items-center gap-1.5 transition disabled:opacity-50"
          >
            {isDecomposing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span>Decompose Chapter 1: Loomings (90 Frames)</span>
          </button>
        </div>
      )}

      {/* Screenplay Drawer Modal */}
      {isTtsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-rose-400" />
                <h3 className="text-sm font-bold text-zinc-100">
                  Google AI Studio 3.8 TTS Screenplay Transcript
                </h3>
              </div>
              <button
                onClick={() => setIsTtsModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-200 text-xs"
              >
                Close
              </button>
            </div>

            <textarea
              readOnly
              value={screenplayScript}
              rows={15}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 text-xs font-mono text-zinc-200 focus:outline-none"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800">
              <span className="text-[11px] text-zinc-400">
                Formatted with speaker markers & emotion tags for 24kHz synthesis.
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyScreenplay}
                  className="px-3 py-1.5 rounded border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs flex items-center gap-1.5 transition"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy Screenplay
                </button>
                <button
                  onClick={handlePushPlayground}
                  disabled={isPushingPlayground}
                  className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow transition disabled:opacity-50"
                >
                  {isPushingPlayground ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                  Dispatch to AI Studio Tab
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
