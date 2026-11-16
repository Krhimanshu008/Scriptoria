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
  X,
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
} from "lucide-react";
import { toast } from "sonner";
import type {
  HighDensityChapterStoryboard,
  MacroScene,
  SubSceneFrame,
} from "@/types/testbench-contracts";

interface HighDensityStoryboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeBookId?: string;
  defaultChapterIndex?: number;
  defaultChapterTitle?: string;
  chapterText?: string;
}

export function HighDensityStoryboardModal({
  isOpen,
  onClose,
  activeBookId,
  defaultChapterIndex = 1,
  defaultChapterTitle = "Chapter 1",
  chapterText = "",
}: HighDensityStoryboardModalProps) {
  const [targetFrames, setTargetFrames] = useState<number>(90);
  const [globalStyle, setGlobalStyle] = useState<string>("cinematic dramatic chiaroscuro");
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

  const handleDecompose = async () => {
    setIsDecomposing(true);
    try {
      const textToUse = chapterText.trim().length > 100 ? chapterText : "";

      const res = await fetch("/api/pipeline/storyboard/decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: activeBookId || "31d94e54-6308-488b-a6fc-1085ee418d7c",
          chapter_index: defaultChapterIndex || 1,
          chapter_title: defaultChapterTitle || "Chapter 1: Loomings",
          raw_text: textToUse,
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
          ? "Dual Kaggle Qwen Swarm"
          : engine === "multi_ai_brain"
          ? "Google AI Studio Gemini Brain"
          : "Deterministic NLP Engine";

      toast.success(
        `Generated ${data.total_frames} atomic frames across ${data.scenes.length} macro scenes via ${engineName}!`
      );
    } catch (err: any) {
      toast.error("Decomposition failed: " + err.message);
    } finally {
      setIsDecomposing(false);
    }
  };

  const handleCopyAllPrompts = () => {
    if (!storyboard) return;
    const prompts = allFlatFrames.map((f) => ({
      frame_index: f.frame_index,
      scene_id: f.scene_id,
      shot_type: f.shot_type,
      lens: f.lens,
      sentence_span: f.sentence_span,
      compiled_image_prompt: f.compiled_image_prompt,
      audio_window: `[${f.audio_start_sec}s - ${f.audio_end_sec}s]`,
    }));

    navigator.clipboard.writeText(JSON.stringify(prompts, null, 2));
    setAllPromptsCopied(true);
    toast.success(`Copied all ${prompts.length} production prompts to clipboard!`);
    setTimeout(() => setAllPromptsCopied(false), 2500);
  };

  const handleDispatchToFlow = async () => {
    if (!storyboard || allFlatFrames.length === 0) return;
    setIsDispatchingFlow(true);
    try {
      const res = await fetch("/api/pipeline/storyboard/flow/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: storyboard.book_id,
          chapter_index: storyboard.chapter_index,
          chapter_title: storyboard.chapter_title,
          frames: allFlatFrames.map((f) => ({
            frame_index: f.frame_index,
            scene_id: f.scene_id,
            compiled_image_prompt: f.compiled_image_prompt,
            sentence_span: f.sentence_span,
          })),
          aspect_ratio: "16:9",
          model_engine: "nano_banana",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server returned ${res.status}`);
      }

      const data = await res.json();
      toast.success(
        `Dispatched ${data.dispatched_count} frames to Google Flow Companion Bridge! Extension will now generate assets.`
      );
    } catch (err: any) {
      toast.error("Flow dispatch error: " + err.message);
    } finally {
      setIsDispatchingFlow(false);
    }
  };

  // Google AI Studio 3.8 TTS Screenplay Formatting & Playground Integration
  const handleOpenTtsModal = async () => {
    setIsTtsModalOpen(true);
    if (!screenplayScript) {
      setIsFormattingScreenplay(true);
      try {
        const textToUse =
          chapterText.trim().length > 100
            ? chapterText
            : `# ${defaultChapterTitle}\n\nIt was not a great while after the affair of the pipe...`;

        const res = await fetch("/api/pipeline/storyboard/tts/format-screenplay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            book_id: activeBookId || "book-active",
            chapter_index: defaultChapterIndex,
            chapter_title: defaultChapterTitle,
            raw_text: textToUse,
            narrator_voice: "Enzo",
            voice_mode: "SINGLE_NARRATOR",
            enable_emotion_tags: true,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setScreenplayScript(data.formatted_screenplay || "");
        } else {
          // Fallback client-side screenplay format
          setScreenplayScript(
            `## Transcript:\n[Speaker: Narrator, Style: atmospheric, dramatic]\n${textToUse}`
          );
        }
      } catch (e) {
        setScreenplayScript(
          `## Transcript:\n[Speaker: Narrator, Style: atmospheric, dramatic]\n${chapterText || defaultChapterTitle}`
        );
      } finally {
        setIsFormattingScreenplay(false);
      }
    }
  };

  const handleCopyScreenplay = () => {
    if (!screenplayScript) return;
    navigator.clipboard.writeText(screenplayScript);
    toast.success("Copied 3.8 TTS Screenplay! Ready to paste into Google AI Studio Playground.");
  };

  const handlePushToPlayground = async () => {
    setIsPushingPlayground(true);
    try {
      const textToUse = chapterText.trim().length > 100 ? chapterText : screenplayScript;
      const res = await fetch("/api/pipeline/storyboard/tts/dispatch-playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: activeBookId || "book-active",
          chapter_index: defaultChapterIndex,
          chapter_title: defaultChapterTitle,
          raw_text: textToUse,
          narrator_voice: "Enzo",
          voice_mode: "SINGLE_NARRATOR",
          enable_emotion_tags: true,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (data.dispatched) {
        toast.success("Dispatched to active AI Studio tab! Check your AI Studio Playground window.");
      } else {
        toast.info(
          "AI Studio Companion dock is ready. Open Google AI Studio Playground in Chrome to receive the script."
        );
      }
    } catch (err: any) {
      toast.error("Could not reach companion: " + err.message);
    } finally {
      setIsPushingPlayground(false);
    }
  };

  const handleAudioFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingAudio(true);
    try {
      // Create local immediate preview URL
      const localBlobUrl = URL.createObjectURL(file);
      setAudioUrl(localBlobUrl);

      // Read as base64 to persist on backend
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = (reader.result || "").toString().split(",")[1];
        if (!base64Data) {
          toast.error("Failed to read audio file bytes.");
          setIsUploadingAudio(false);
          return;
        }

        const res = await fetch("/api/pipeline/storyboard/audio/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            book_id: activeBookId || "book-active",
            chapter_index: defaultChapterIndex,
            filename: file.name,
            audio_base64: base64Data,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.audio_url) setAudioUrl(data.audio_url);
          if (data.duration_seconds) setAudioDuration(data.duration_seconds);
          toast.success(`Loaded AI Studio 3.8 TTS Audio (${data.duration_seconds}s)! Synced with AV Theater.`);
          setViewMode("theater");
          setIsTtsModalOpen(false);
        } else {
          toast.success("Loaded local audio track into AV Theater.");
          setViewMode("theater");
          setIsTtsModalOpen(false);
        }
        setIsUploadingAudio(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toast.error("Error uploading audio: " + err.message);
      setIsUploadingAudio(false);
    }
  };

  const handleTogglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (timeSec: number) => {
    setCurrentAudioTime(timeSec);
    if (audioRef.current) {
      audioRef.current.currentTime = timeSec;
    }
  };

  const handleCopyPrompt = (prompt: string, frameIdx: number) => {
    navigator.clipboard.writeText(prompt);
    setCopiedFrameIdx(frameIdx);
    toast.success(`Copied Frame #${frameIdx} production prompt`);
    setTimeout(() => setCopiedFrameIdx(null), 2000);
  };

  const activeScene = storyboard?.scenes.find(
    (s) => s.scene_id === (selectedSceneId || storyboard.scenes[0]?.scene_id)
  );

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative flex flex-col w-full max-w-7xl h-[92vh] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-6 py-4 bg-zinc-900/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Clapperboard className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-zinc-100">
                  High-Density Storyboard Studio (Layer E)
                </h2>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/30">
                  80–100 FRAMES / CH
                </span>
                {storyboard && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                    {storyboard.total_frames} FRAMES READY
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                Micro-beat sub-scene decomposition &middot; {defaultChapterTitle} &middot; AI Director + AV Sync Theater
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Switcher */}
            {storyboard && (
              <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5 mr-2">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                    viewMode === "grid"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>Grid View</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("theater")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                    viewMode === "theater"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Tv className="h-3.5 w-3.5 text-amber-400" />
                  <span>AV Theater</span>
                </button>
              </div>
            )}

            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Engine Controls & Decomposition Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/60 px-6 py-2.5 bg-zinc-900/40 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 font-medium">Target Frames:</span>
              <select
                value={targetFrames}
                onChange={(e) => setTargetFrames(Number(e.target.value))}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
              >
                <option value={60}>60 Frames (Light)</option>
                <option value={80}>80 Frames (Standard)</option>
                <option value={90}>90 Frames (High-Density Recommended)</option>
                <option value={100}>100 Frames (Full Feature)</option>
              </select>
            </div>

            {/* AI Director Engine Selector */}
            <div className="flex items-center gap-1.5 bg-zinc-950/80 border border-zinc-800 rounded-lg p-1">
              <span className="text-[11px] text-zinc-400 font-medium px-1.5">Brain:</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEngine("qwen_swarm")}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all cursor-pointer ${
                    engine === "qwen_swarm"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Dual Kaggle Dual-T4 VM Swarm (Acc 1 Director + Acc 2 Cinematographer)"
                >
                  <Radio className="h-3 w-3 text-amber-400" />
                  <span>Qwen Swarm (2 VMs)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEngine("multi_ai_brain")}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all cursor-pointer ${
                    engine === "multi_ai_brain"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Google AI Studio Gemini Multi-Model Cognitive Swarm"
                >
                  <Sparkles className="h-3 w-3 text-amber-400" />
                  <span>Gemini</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEngine("deterministic")}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all cursor-pointer ${
                    engine === "deterministic"
                      ? "bg-zinc-800 text-zinc-200 border border-zinc-700"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Deterministic NLP Rule Engine (Fast, 0-cost, 100% offline)"
                >
                  <span>⚡ Fast NLP</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {storyboard && (
              <>
                <button
                  onClick={handleDispatchToFlow}
                  disabled={isDispatchingFlow}
                  className="flex items-center gap-1 rounded-lg border border-purple-800/80 bg-purple-950/40 hover:bg-purple-900/60 px-2.5 py-1.5 text-xs font-semibold text-purple-300 transition-colors cursor-pointer disabled:opacity-50"
                  title="Dispatch all 80-100 prompts to Google Flow Browser Extension"
                >
                  <Send className="h-3.5 w-3.5 text-purple-400" />
                  <span>{isDispatchingFlow ? "Dispatching..." : "Send to Flow Extension"}</span>
                </button>

                <button
                  onClick={handleOpenTtsModal}
                  className="flex items-center gap-1.5 rounded-lg border border-blue-700/80 bg-blue-950/50 hover:bg-blue-900/70 px-2.5 py-1.5 text-xs font-bold text-blue-200 transition-all cursor-pointer shadow-sm shadow-blue-500/10"
                  title="Google AI Studio 3.8 TTS Playground Audio Synthesis (No API Key Required)"
                >
                  <Volume2 className="h-3.5 w-3.5 text-blue-400" />
                  <span>AI Studio 3.8 TTS</span>
                </button>

                <button
                  onClick={handleCopyAllPrompts}
                  className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
                  title="Copy all 80-100 prompts as JSON array for Flow / ComfyUI"
                >
                  {allPromptsCopied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Export Prompts</span>
                    </>
                  )}
                </button>
              </>
            )}

            <button
              onClick={handleDecompose}
              disabled={isDecomposing}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 px-3 py-1.5 text-xs font-bold text-black shadow-md shadow-amber-500/20 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isDecomposing ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black border-t-transparent" />
                  <span>Decomposing via {engine === "qwen_swarm" ? "Qwen Swarm..." : engine === "multi_ai_brain" ? "Gemini Brain..." : "Fast NLP..."}</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Generate {targetFrames} Storyboard Frames</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {viewMode === "theater" ? (
            /* ============================================================= */
            /* AV Sync Theater Mode Player                                   */
            /* ============================================================= */
            <div className="flex-1 flex flex-col h-full bg-black/90 p-4 gap-3 overflow-hidden">
              {/* Cinema Canvas Viewport */}
              <div className="flex-1 relative rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-black overflow-hidden flex flex-col items-center justify-center p-6 text-center shadow-inner">
                {activeTheaterFrame ? (
                  <div className="flex flex-col items-center justify-between h-full w-full max-w-4xl py-2">
                    {/* Top Metadata Bar */}
                    <div className="flex items-center justify-between w-full text-xs text-zinc-400">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-[11px]">
                          Frame #{activeTheaterFrame.frame_index} of {allFlatFrames.length}
                        </span>
                        <span className="font-semibold text-zinc-300 uppercase tracking-wider text-[11px]">
                          {activeTheaterFrame.shot_type.replace(/_/g, " ")}
                        </span>
                        <span className="text-zinc-500">•</span>
                        <span className="font-mono text-zinc-400 text-[11px]">
                          {activeTheaterFrame.lens}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-400 text-xs">
                        <span>{activeTheaterFrame.spatial_environment_focus}</span>
                        {activeTheaterFrame.audio_start_sec !== undefined && (
                          <span className="font-mono text-amber-400/90 text-[11px]">
                            [{formatSeconds(activeTheaterFrame.audio_start_sec || 0)} - {formatSeconds(activeTheaterFrame.audio_end_sec || 0)}]
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle Graphic Frame Simulation */}
                    <div className="my-auto flex flex-col items-center justify-center w-full max-w-2xl p-6 rounded-xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md shadow-2xl relative">
                      <div className="absolute top-2 right-2 flex items-center gap-2 text-[10px] text-zinc-500 uppercase tracking-widest font-mono">
                        <span>Google Flow &bull; AI Studio 3.8 TTS</span>
                      </div>
                      <Camera className="h-12 w-12 text-amber-500/40 mb-3 stroke-[1.5]" />
                      <div className="text-xs font-mono text-zinc-300 line-clamp-3 italic text-center max-w-xl">
                        &quot;{activeTheaterFrame.compiled_image_prompt}&quot;
                      </div>
                    </div>

                    {/* Active Subtitle Display */}
                    <div className="w-full max-w-3xl bg-black/60 border border-zinc-800 rounded-lg p-3 text-center backdrop-blur-sm">
                      <p className="text-sm font-medium text-amber-200/90 italic">
                        &quot;{activeTheaterFrame.sentence_span}&quot;
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-zinc-500">
                    <Film className="h-12 w-12 mb-2 stroke-[1.5]" />
                    <p className="text-sm">No storyboard frames decomposed yet.</p>
                    <button
                      onClick={handleDecompose}
                      className="mt-3 px-3 py-1.5 rounded-lg bg-amber-500 text-black text-xs font-bold"
                    >
                      Generate 90 Storyboard Frames
                    </button>
                  </div>
                )}
              </div>

              {/* Master Audio Track Bar & Scrubber */}
              <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 p-3 shadow-lg">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTogglePlay}
                    disabled={allFlatFrames.length === 0}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 text-black font-bold hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-40"
                    title={isPlaying ? "Pause Narration" : "Play Narration & Auto-Cut Frames"}
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                  </button>

                  <div className="flex items-center gap-1.5 text-xs font-mono text-zinc-300 min-w-[75px]">
                    <Clock className="h-3.5 w-3.5 text-amber-400" />
                    <span>{formatSeconds(currentAudioTime)}</span>
                  </div>

                  {/* Scrubber Range */}
                  <input
                    type="range"
                    min={0}
                    max={audioDuration || 180}
                    step={0.5}
                    value={currentAudioTime}
                    onChange={(e) => handleSeek(Number(e.target.value))}
                    disabled={allFlatFrames.length === 0}
                    className="flex-1 accent-amber-500 h-1.5 rounded-lg bg-zinc-800 cursor-pointer disabled:opacity-40"
                  />

                  <span className="text-xs font-mono text-zinc-400 min-w-[40px]">
                    {formatSeconds(audioDuration)}
                  </span>

                  {/* Upload / Attach Audio Button */}
                  <label
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors cursor-pointer"
                    title="Attach or upload AI Studio 3.8 TTS generated audio (.wav, .mp3)"
                  >
                    <Upload className="h-3.5 w-3.5 text-amber-400" />
                    <span>{isUploadingAudio ? "Attaching..." : "Attach 3.8 Audio"}</span>
                    <input
                      type="file"
                      ref={audioFileInputRef}
                      accept="audio/*"
                      onChange={handleAudioFileUpload}
                      className="hidden"
                    />
                  </label>

                  {audioUrl && (
                    <audio
                      ref={audioRef}
                      src={audioUrl}
                      onEnded={() => setIsPlaying(false)}
                      className="hidden"
                    />
                  )}
                </div>

                {/* Bottom Filmstrip Carousel */}
                <div className="flex items-center gap-1.5 overflow-x-auto pt-1 pb-0.5 no-scrollbar">
                  {allFlatFrames.map((f) => {
                    const isCurrent = activeTheaterFrame?.frame_index === f.frame_index;
                    return (
                      <button
                        key={f.frame_index}
                        onClick={() => handleSeek(f.audio_start_sec || 0)}
                        className={`flex flex-col items-center justify-center h-12 w-16 shrink-0 rounded border text-[10px] transition-all cursor-pointer ${
                          isCurrent
                            ? "bg-amber-500/20 border-amber-500 text-amber-300 font-bold shadow-md shadow-amber-500/20 scale-105"
                            : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                        }`}
                        title={`Frame #${f.frame_index}: ${f.shot_type}`}
                      >
                        <span className="font-bold">#{f.frame_index}</span>
                        <span className="text-[9px] text-zinc-500 uppercase font-mono">
                          {f.shot_type.slice(0, 4)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* ============================================================= */
            /* Grid View: Macro Scenes & Micro Beat Cards                    */
            /* ============================================================= */
            <>
              {/* Left Column: Macro Scene Navigator */}
              <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-zinc-800/80 bg-zinc-950/60 p-3 overflow-y-auto shrink-0 flex flex-col gap-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 px-1 mb-1 flex items-center justify-between">
                  <span>Macro Scenes</span>
                  {storyboard && (
                    <span className="text-amber-400">{storyboard.scenes.length} Scenes</span>
                  )}
                </div>

                {storyboard?.scenes.map((sc) => {
                  const isSelected = (selectedSceneId || storyboard.scenes[0]?.scene_id) === sc.scene_id;
                  return (
                    <button
                      key={sc.scene_id}
                      onClick={() => setSelectedSceneId(sc.scene_id)}
                      className={`flex flex-col gap-1 rounded-xl p-2.5 text-left transition-all cursor-pointer border ${
                        isSelected
                          ? "bg-amber-500/10 border-amber-500/40 text-amber-200 shadow-sm"
                          : "border-zinc-800/60 bg-zinc-900/30 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-zinc-200">
                          Scene {sc.scene_order}
                        </span>
                        <span className="rounded bg-zinc-800 px-1.5 py-0.2 text-[10px] font-mono text-zinc-400">
                          {sc.sub_scenes.length} frames
                        </span>
                      </div>
                      <p className="text-[11px] font-medium text-zinc-300 line-clamp-1">
                        {sc.scene_heading}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                        <span className="flex items-center gap-0.5">
                          <MapPin className="h-2.5 w-2.5" />
                          {sc.location_handle}
                        </span>
                        <span>&bull;</span>
                        <span>{sc.time_of_day}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Right Column: 80-100 Atomic Sub-Scene Beats */}
              <div className="flex-1 flex flex-col bg-zinc-950 p-4 overflow-y-auto">
                {activeScene && (
                  <>
                    <div className="mb-4 flex flex-col gap-1 border-b border-zinc-800 pb-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                          <span>Scene {activeScene.scene_order}: {activeScene.scene_heading}</span>
                          <span className="text-xs font-normal text-amber-400/90 font-mono">
                            ({activeScene.sub_scenes.length} Atomic Beats)
                          </span>
                        </h3>
                      </div>
                      <p className="text-xs text-zinc-400">{activeScene.summary}</p>
                    </div>

                    {/* Sub-Scenes Card Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {activeScene.sub_scenes.map((fr) => (
                        <div
                          key={fr.frame_index}
                          className="flex flex-col gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3 hover:border-zinc-700 transition-all shadow-sm"
                        >
                          {/* Card Header: Frame #, Shot Type Badge, Lens */}
                          <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                            <div className="flex items-center gap-1.5">
                              <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-500/20 text-[10px] font-bold text-amber-400">
                                #{String(fr.frame_index).padStart(2, "0")}
                              </span>
                              <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">
                                {fr.shot_type.replace(/_/g, " ")}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {fr.audio_start_sec !== undefined && (
                                <span className="text-[10px] text-amber-400/80 font-mono">
                                  {formatSeconds(fr.audio_start_sec || 0)}s
                                </span>
                              )}
                              <span className="text-[10px] text-zinc-400 font-mono">
                                {fr.lens.split(" ")[0]}
                              </span>
                            </div>
                          </div>

                          {/* Verbatim Sentence Span */}
                          <div className="text-xs text-zinc-200 bg-zinc-950/70 p-2 rounded border border-zinc-800/80 italic">
                            &quot;{fr.sentence_span}&quot;
                          </div>

                          {/* Character State Tags */}
                          {fr.active_characters.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {fr.active_characters.map((ch, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 border border-zinc-700"
                                >
                                  <User className="h-2.5 w-2.5" />
                                  {ch.handle}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Compiled Prompt */}
                          <div className="flex flex-col gap-1 mt-auto pt-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                              Compiled Production Prompt
                            </span>
                            <div className="relative group">
                              <div className="text-[11px] text-zinc-300 font-mono bg-zinc-950 p-2 rounded border border-zinc-800/60 line-clamp-3 group-hover:line-clamp-none transition-all">
                                {fr.compiled_image_prompt}
                              </div>
                              <button
                                onClick={() => handleCopyPrompt(fr.compiled_image_prompt, fr.frame_index)}
                                className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-all opacity-80 group-hover:opacity-100 cursor-pointer"
                                title="Copy production prompt"
                              >
                                {copiedFrameIdx === fr.frame_index ? (
                                  <Check className="h-3 w-3 text-emerald-400" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* ================================================================= */}
        {/* Google AI Studio 3.8 TTS Playground Integration Drawer/Modal      */}
        {/* ================================================================= */}
        {isTtsModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-150">
            <div className="relative flex flex-col w-full max-w-3xl max-h-[85vh] rounded-2xl border border-blue-800/60 bg-zinc-950 p-6 shadow-2xl overflow-hidden">
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
                    <Headphones className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-zinc-100">
                        Google AI Studio Playground · Gemini 3.8 TTS
                      </h3>
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                        ZERO API KEYS REQUIRED
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400">
                      Generate 24kHz broadcast speech directly in your Google AI Studio Playground session.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsTtsModalOpen(false)}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Action Buttons Row */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <button
                  onClick={handleCopyScreenplay}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all cursor-pointer"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy 3.8 TTS Screenplay</span>
                </button>

                <a
                  href="https://aistudio.google.com/prompts/new_chat"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-blue-400" />
                  <span>Open AI Studio Playground</span>
                </a>

                <button
                  onClick={handlePushToPlayground}
                  disabled={isPushingPlayground}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-300 transition-colors cursor-pointer disabled:opacity-50"
                  title="Push screenplay directly into open Google AI Studio Chrome tab via Extension"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{isPushingPlayground ? "Pushing..." : "⚡ Push to AI Studio Tab"}</span>
                </button>
              </div>

              {/* Screenplay Script Viewer */}
              <div className="flex-1 min-h-[220px] flex flex-col gap-1.5 overflow-hidden mb-4">
                <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5 text-blue-400" />
                    Screenplay Transcript (Gemini 3.8 Flash TTS Format)
                  </span>
                  <span className="text-[11px] font-mono text-zinc-500">
                    Voice: Enzo &bull; Pacing: ~140 WPM &bull; Expressive Tags Active
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap selection:bg-blue-900/60">
                  {isFormattingScreenplay ? (
                    <div className="flex items-center justify-center h-full text-zinc-500">
                      Formatting chapter into 3.8 TTS blocks...
                    </div>
                  ) : (
                    screenplayScript || "Generating screenplay transcript..."
                  )}
                </div>
              </div>

              {/* Attach / Upload Audio Section */}
              <div className="flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3.5 mt-auto">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <Music className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-200">
                      Attach AI Studio Audio Track
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Upload the exported .wav or .mp3 from AI Studio to sync with the 80–100 storyboard frames.
                    </p>
                  </div>
                </div>

                <label className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-white shadow-md transition-all cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>{isUploadingAudio ? "Attaching..." : "Select Audio File"}</span>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
