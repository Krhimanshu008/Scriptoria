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
  activeBookId: string;
  defaultChapterTitle?: string;
  defaultChapterIndex?: number;
  chapterText?: string;
}

const VISUAL_STYLES = [
  {
    id: "19th-century-realism",
    label: "19th-Century Maritime Realism (Dark Oil Painting)",
    style:
      "19th-century maritime realism, dark oil-painting atmospheric lighting, cinematic 35mm film grain, chiaroscuro",
  },
  {
    id: "cyberpunk-noir",
    label: "Cyberpunk Neo-Noir (Anamorphic Neon)",
    style:
      "cyberpunk neo-noir, high-contrast anamorphic neon rim light, moody wet asphalt reflections, 35mm film grain",
  },
  {
    id: "anime-cinematic",
    label: "Anime Cinematic Storyboard (Makoto Shinkai Style)",
    style:
      "cinematic anime aesthetic, rich cloud volumetric lighting, vibrant environmental palettes, sharp line work",
  },
  {
    id: "grimdark-fantasy",
    label: "Grimdark Epic Fantasy (Dark Textured Fantasy)",
    style:
      "dark fantasy realism, desaturated cold tones, heavy mist, battered iron and weathered stone textures, volumetric haze",
  },
];

export function HighDensityStoryboardModal({
  isOpen,
  onClose,
  activeBookId,
  defaultChapterTitle = "Chapter 36: The Quarter-Deck",
  defaultChapterIndex = 1,
  chapterText = "",
}: HighDensityStoryboardModalProps) {
  const [targetFrames, setTargetFrames] = useState<number>(90);
  const [selectedStyleId, setSelectedStyleId] = useState<string>("19th-century-realism");
  const [engine, setEngine] = useState<"multi_ai_brain" | "qwen_swarm" | "deterministic">("qwen_swarm");
  const [isDecomposing, setIsDecomposing] = useState<boolean>(false);
  const [storyboard, setStoryboard] = useState<HighDensityChapterStoryboard | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [copiedFrameIdx, setCopiedFrameIdx] = useState<number | null>(null);
  const [allPromptsCopied, setAllPromptsCopied] = useState<boolean>(false);

  // AV Theater Mode States
  const [viewMode, setViewMode] = useState<"grid" | "theater">("grid");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentAudioTime, setCurrentAudioTime] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(180);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isDispatchingFlow, setIsDispatchingFlow] = useState<boolean>(false);
  const [isSynthesizingTTS, setIsSynthesizingTTS] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Flattened frames array for timeline navigation
  const allFlatFrames: SubSceneFrame[] = storyboard
    ? storyboard.scenes.flatMap((s) => s.sub_scenes)
    : [];

  // Active frame in theater mode (resolved by audio timestamp)
  const activeTheaterFrame: SubSceneFrame | undefined =
    allFlatFrames.find(
      (f) =>
        typeof f.audio_start_sec === "number" &&
        typeof f.audio_end_sec === "number" &&
        currentAudioTime >= f.audio_start_sec &&
        currentAudioTime < f.audio_end_sec
    ) || allFlatFrames[0];

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      if (audioRef.current && !audioRef.current.paused) {
        setCurrentAudioTime(audioRef.current.currentTime);
      } else if (!audioUrl) {
        setCurrentAudioTime((prev) => {
          const next = prev + 0.25;
          return next >= audioDuration ? 0 : next;
        });
      }
    }, 250);
    return () => clearInterval(interval);
  }, [isPlaying, audioUrl, audioDuration]);

  if (!isOpen) return null;

  const currentStyle =
    VISUAL_STYLES.find((s) => s.id === selectedStyleId)?.style || VISUAL_STYLES[0].style;

  const handleDecompose = async () => {
    setIsDecomposing(true);
    try {
      const textToUse =
        chapterText.trim().length > 100
          ? chapterText
          : `# ${defaultChapterTitle}\n\n` +
            `It was not a great while after the affair of the pipe, that one morning shortly after breakfast, ` +
            `Ahab ascended the cabin-gangway to the deck. Soon his steady, ivory stride was heard pacing his rounds upon the planks, ` +
            `all over dented with the peculiar mark of his bone leg.\n\n<SCENE_BREAK />\n\n` +
            `"D'ye see him?" cried Ahab, holding up a broad bright Spanish gold piece to the sun. "It is a sixteen dollar piece, men! ` +
            `Whosoever of ye raises me that same white-headed whale, with three holes in his starboard fluke, he shall have this gold ounce!"\n\n` +
            `Starbuck brought the heavy iron top-maul hammer, and with one mighty blow Ahab pinned the gleaming gold doubloon to the mainmast.\n\n<SCENE_BREAK />\n\n` +
            `"Aye, Starbuck; aye, my hearties all round; it was Moby Dick that dismasted me; Moby Dick that brought me to this dead stump I stand on now." ` +
            `The crew cheered with savage joy, while Queequeg and Tashtego gripped their harpoons with glistening eyes.`;

      const res = await fetch("/api/pipeline/storyboard/decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: activeBookId || "book-active",
          chapter_index: defaultChapterIndex,
          chapter_title: defaultChapterTitle,
          raw_text: textToUse,
          target_frames: targetFrames,
          global_style: currentStyle,
          engine: engine,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server returned ${res.status}`);
      }

      const data: HighDensityChapterStoryboard = await res.json();
      setStoryboard(data);
      if (data.scenes && data.scenes.length > 0) {
        setSelectedSceneId(data.scenes[0].scene_id);
      }

      const lastScene = data.scenes[data.scenes.length - 1];
      if (lastScene && lastScene.sub_scenes.length > 0) {
        const lastFrame = lastScene.sub_scenes[lastScene.sub_scenes.length - 1];
        if (lastFrame.audio_end_sec) {
          setAudioDuration(lastFrame.audio_end_sec);
        }
      }

      toast.success(
        `Generated ${data.total_frames} cinematic sub-scene frames via ${
          engine === "qwen_swarm"
            ? "Local Qwen Swarm (2 Kaggle VMs)"
            : engine === "multi_ai_brain"
            ? "Gemini Story Brain"
            : "Fast NLP"
        } across ${data.scenes.length} macro scenes!`
      );
    } catch (err: any) {
      toast.error("Decomposition failed: " + err.message);
    } finally {
      setIsDecomposing(false);
    }
  };

  const handleCopyAllPrompts = () => {
    if (!storyboard) return;
    const allPrompts = storyboard.scenes.flatMap((s) =>
      s.sub_scenes.map((sub) => ({
        frame_index: sub.frame_index,
        scene_id: sub.scene_id,
        lens: sub.lens,
        shot_type: sub.shot_type,
        audio_start_sec: sub.audio_start_sec,
        audio_end_sec: sub.audio_end_sec,
        prompt: sub.compiled_image_prompt,
      }))
    );
    navigator.clipboard.writeText(JSON.stringify(allPrompts, null, 2));
    setAllPromptsCopied(true);
    toast.success(`Copied all ${allPrompts.length} compiled prompts to clipboard (Flow / ComfyUI format)!`);
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
          book_id: activeBookId || "book-active",
          chapter_index: defaultChapterIndex,
          chapter_title: defaultChapterTitle,
          frames: allFlatFrames,
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

  const handleSynthesizeTTS = async () => {
    setIsSynthesizingTTS(true);
    try {
      const textToUse =
        chapterText.trim().length > 100
          ? chapterText
          : `# ${defaultChapterTitle}\n\nIt was not a great while after the affair of the pipe...`;

      const res = await fetch("/api/pipeline/storyboard/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: activeBookId || "book-active",
          chapter_index: defaultChapterIndex,
          chapter_title: defaultChapterTitle,
          raw_text: textToUse,
          narrator_voice: "Enzo",
          voice_mode: "SINGLE_NARRATOR",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server returned ${res.status}`);
      }

      const data = await res.json();
      if (data.audio_url) {
        setAudioUrl(data.audio_url);
        if (data.duration_seconds) setAudioDuration(data.duration_seconds);
        toast.success(`Google AI Studio 24kHz audio synthesized (${data.duration_seconds}s)!`);
      } else {
        toast.info(data.notice || "Audio synthesis completed.");
      }
    } catch (err: any) {
      toast.error("TTS Synthesis error: " + err.message);
    } finally {
      setIsSynthesizingTTS(false);
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
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5">
      <div className="flex flex-col w-full max-w-6xl h-[90vh] rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3 bg-zinc-900/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Clapperboard className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-tight text-white">
                  High-Density Storyboard Studio (80–100 Frames / Chapter)
                </h2>
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30">
                  v2.0 Cognitive Swarm
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                2 Kaggle VMs (Qwen Swarm) • Google Flow Extension • AI Studio TTS Sync
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Switcher */}
            <div className="flex rounded-md bg-zinc-900 p-0.5 border border-zinc-800">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Grid View</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("theater")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                  viewMode === "theater"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Tv className="h-3.5 w-3.5 text-amber-400" />
                <span>AV Theater</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/60 px-4 py-2.5 bg-zinc-900/30 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            {/* Visual Style Selection */}
            <div className="flex items-center gap-1.5">
              <Film className="h-3.5 w-3.5 text-zinc-400" />
              <span className="text-xs text-zinc-400">Style:</span>
              <select
                value={selectedStyleId}
                onChange={(e) => setSelectedStyleId(e.target.value)}
                className="h-7 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                {VISUAL_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Target Frames Slider */}
            <div className="flex items-center gap-2 border-l border-zinc-800 pl-3">
              <Sliders className="h-3.5 w-3.5 text-zinc-400" />
              <span className="text-xs text-zinc-400">Target Frames:</span>
              <input
                type="range"
                min={50}
                max={120}
                step={5}
                value={targetFrames}
                onChange={(e) => setTargetFrames(Number(e.target.value))}
                className="w-24 accent-amber-500 cursor-pointer"
              />
              <span className="text-xs font-bold text-amber-400 min-w-[28px]">{targetFrames}</span>
            </div>

            {/* Engine Selection: Qwen Swarm vs Gemini Brain vs Fast NLP */}
            <div className="flex items-center gap-1 border-l border-zinc-800 pl-3">
              <span className="text-xs text-zinc-400 mr-1">Brain:</span>
              <div className="flex rounded-md bg-zinc-900 p-0.5 border border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEngine("qwen_swarm")}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all cursor-pointer ${
                    engine === "qwen_swarm"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Local Qwen Swarm across 2 Kaggle Dual-T4 VMs (Account 1 & 2)"
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
                  onClick={handleSynthesizeTTS}
                  disabled={isSynthesizingTTS}
                  className="flex items-center gap-1 rounded-lg border border-blue-800/80 bg-blue-950/40 hover:bg-blue-900/60 px-2.5 py-1.5 text-xs font-semibold text-blue-300 transition-colors cursor-pointer disabled:opacity-50"
                  title="Synthesize 24kHz chapter audio via Google AI Studio TTS"
                >
                  <Volume2 className="h-3.5 w-3.5 text-blue-400" />
                  <span>{isSynthesizingTTS ? "Synthesizing..." : "AI Studio TTS"}</span>
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
                      <div className="absolute top-2 right-2 text-[10px] text-zinc-500 uppercase tracking-widest font-mono">
                        Flow Companion Sync
                      </div>
                      <Camera className="h-12 w-12 text-amber-500/40 mb-3 stroke-[1.5]" />
                      <div className="text-xs font-mono text-zinc-300 line-clamp-3 italic text-center max-w-xl">
                        &quot;{activeTheaterFrame.compiled_image_prompt}&quot;
                      </div>
                    </div>

                    {/* Subtitle Karaoke Display */}
                    <div className="w-full max-w-3xl bg-zinc-950/90 border border-zinc-800 rounded-lg p-3 text-center shadow-lg">
                      <p className="text-sm font-medium text-amber-200 tracking-wide leading-relaxed animate-in fade-in duration-150">
                        &quot;{activeTheaterFrame.sentence_span}&quot;
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-zinc-500 text-sm flex flex-col items-center gap-2">
                    <Film className="h-10 w-10 text-zinc-700 stroke-[1.5]" />
                    <p>Decompose chapter to start synchronized AV playback.</p>
                  </div>
                )}
              </div>

              {/* Master Audio Sync Control Strip */}
              <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleTogglePlay}
                    disabled={allFlatFrames.length === 0}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold shadow-md shadow-amber-500/20 transition-all disabled:opacity-40 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
                  </button>

                  <span className="text-xs font-mono text-zinc-400 min-w-[40px]">
                    {formatSeconds(currentAudioTime)}
                  </span>

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

                {!storyboard && (
                  <div className="flex flex-col items-center justify-center p-6 text-center text-zinc-500 text-xs gap-2">
                    <Film className="h-8 w-8 text-zinc-700 stroke-[1.5]" />
                    <p>Click &quot;Generate Storyboard&quot; above to decompose chapter into 80–100 micro frames.</p>
                  </div>
                )}

                {storyboard?.scenes.map((sc) => {
                  const isSelected = (selectedSceneId || storyboard.scenes[0]?.scene_id) === sc.scene_id;
                  return (
                    <button
                      key={sc.scene_id}
                      onClick={() => setSelectedSceneId(sc.scene_id)}
                      className={`flex flex-col text-left p-2.5 rounded-lg border transition-all text-xs cursor-pointer ${
                        isSelected
                          ? "bg-amber-500/10 border-amber-500/40 text-amber-200 shadow-sm"
                          : "bg-zinc-900/40 border-zinc-800 hover:border-zinc-700 text-zinc-300"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-semibold text-zinc-200">
                          Scene {sc.scene_order}: {sc.scene_heading}
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-amber-400 shrink-0">
                          {sc.sub_scenes.length} fr
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-400 mt-1 line-clamp-2">
                        {sc.summary}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Right Column: Frame Gallery & Timeline Cards */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3 bg-zinc-950/40">
                {!activeScene && (
                  <div className="flex flex-col items-center justify-center h-full text-center text-zinc-500 gap-3">
                    <Camera className="h-10 w-10 text-zinc-700 stroke-[1.5]" />
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-300">Ready to Decompose</h3>
                      <p className="text-xs text-zinc-500 max-w-sm mt-1">
                        Every 15–25 words is mapped to a dedicated frame with shot types, focal lenses, and active continuity deltas.
                      </p>
                    </div>
                  </div>
                )}

                {activeScene && (
                  <>
                    <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5 mb-1 shrink-0">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>Scene {activeScene.scene_order}: {activeScene.scene_heading}</span>
                        </h3>
                        <p className="text-xs text-zinc-400 mt-0.5 flex items-center gap-3">
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-amber-400" /> {activeScene.location_handle}</span>
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-zinc-400" /> {activeScene.time_of_day}</span>
                          <span className="flex items-center gap-1"><Layers className="h-3 w-3 text-emerald-400" /> {activeScene.sub_scenes.length} visual frames</span>
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {activeScene.sub_scenes.map((fr) => (
                        <div
                          key={fr.frame_index}
                          className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 hover:border-zinc-700 transition-all gap-2"
                        >
                          {/* Frame Header */}
                          <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-7 items-center justify-center rounded bg-amber-500/10 border border-amber-500/30 text-[10px] font-black text-amber-400">
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
      </div>
    </div>
  );
}
