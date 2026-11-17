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
  Rocket,
} from "lucide-react";
import { toast } from "sonner";
import type {
  HighDensityChapterStoryboard,
  MacroScene,
  SubSceneFrame,
} from "@/types/testbench-contracts";
import { FlowCompanionBadge } from "@/components/flow/FlowCompanionBadge";
import { CompanionSetupModal } from "@/components/flow/CompanionSetupModal";
import type { FlowCompanionStatus } from "@/types/flow-contracts";

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
  const [isDispatchingMaster, setIsDispatchingMaster] = useState(false);

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
  const [selectedCandidates, setSelectedCandidates] = useState<Record<number, number>>({});
  const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [flowModelEngine, setFlowModelEngine] = useState<"NANO_BANANA" | "VEO_3_1">("NANO_BANANA");
  const [capturedAssets, setCapturedAssets] = useState<Record<number, string[]>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Casting & Pre-Flight States
  const [isCastingModalOpen, setIsCastingModalOpen] = useState(false);
  const [preflightStatus, setPreflightStatus] = useState<any>(null);
  const [isLoadingPreflight, setIsLoadingPreflight] = useState(false);
  const [isSyncingPreflight, setIsSyncingPreflight] = useState(false);
  const [selectedCharacterLookdev, setSelectedCharacterLookdev] = useState<any>(null);
  const [isGeneratingLookdev, setIsGeneratingLookdev] = useState(false);

  // Companion Extension & Account Setup Modal
  const [isCompanionModalOpen, setIsCompanionModalOpen] = useState(false);
  const [companionStatus, setCompanionStatus] = useState<FlowCompanionStatus | null>(null);

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

  // Poll recent Flow media results to populate live candidates
  useEffect(() => {
    let timer: any;
    async function pollRecentMedia() {
      try {
        const res = await fetch("/api/v1/flow-bridge/events/recent");
        if (res.ok) {
          const events = await res.json();
          if (Array.isArray(events)) {
            const nextMap: Record<number, string[]> = {};
            events.forEach((ev: any) => {
              const beatId = ev.beat_id || "";
              const match = beatId.match(/beat_(\d+)/);
              if (match) {
                const frameIdx = parseInt(match[1], 10);
                const urls = (ev.candidates || [])
                  .map((c: any) => c.remote_url || (c.local_relative_path ? `/api/outputs/${c.local_relative_path}` : ""))
                  .filter(Boolean);
                if (urls.length > 0) {
                  nextMap[frameIdx] = urls;
                }
              }
            });
            if (Object.keys(nextMap).length > 0) {
              setCapturedAssets((prev) => ({ ...prev, ...nextMap }));
            }
          }
        }
      } catch {
        // Non-fatal background poll
      }
    }
    timer = setInterval(pollRecentMedia, 3500);
    pollRecentMedia();
    return () => clearInterval(timer);
  }, []);

  // Fetch Pre-Flight Status
  const loadPreflightStatus = React.useCallback(async () => {
    setIsLoadingPreflight(true);
    try {
      const bookId = selectedBookId || "31d94e54-6308-488b-a6fc-1085ee418d7c";
      const res = await fetch(`/api/v1/flow-bridge/preflight/status?book_id=${encodeURIComponent(bookId)}`);
      if (res.ok) {
        const data = await res.json();
        setPreflightStatus(data);
      }
    } catch {
      // Non-fatal
    } finally {
      setIsLoadingPreflight(false);
    }
  }, [selectedBookId]);

  useEffect(() => {
    loadPreflightStatus();
  }, [loadPreflightStatus]);

  const handleSyncAllPreflight = async () => {
    setIsSyncingPreflight(true);
    try {
      const bookId = selectedBookId || "31d94e54-6308-488b-a6fc-1085ee418d7c";
      const res = await fetch(`/api/v1/flow-bridge/preflight/sync-all?book_id=${encodeURIComponent(bookId)}`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Pre-flight sync dispatched for ${data.dispatched_count || "all"} ingredients in Flow.`);
        await loadPreflightStatus();
      } else {
        toast.error("Failed to sync pre-flight ingredients to Flow.");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to trigger pre-flight sync.");
    } finally {
      setIsSyncingPreflight(false);
    }
  };

  const handleGenerateLookdev = async (char: any) => {
    setIsGeneratingLookdev(true);
    try {
      const bookId = selectedBookId || "31d94e54-6308-488b-a6fc-1085ee418d7c";
      const res = await fetch("/api/v1/flow-bridge/lookdev/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          character_id: char.ingredient_id || `char_${char.mention_handle.toLowerCase()}`,
          canonical_name: char.name || char.mention_handle,
          mention_handle: char.mention_handle,
          visual_tier: char.visual_tier || "TIER_1_CORE",
          physical_description: "weathered 19th-century maritime sailor, sharp features",
          wardrobe_description: "authentic period wool sea pea coat and sailor cap",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedCharacterLookdev(data);
        toast.success(`Generated 4-angle turnaround prompts for @${char.mention_handle}`);
      } else {
        toast.error("Failed to generate character lookdev.");
      }
    } catch (err: any) {
      toast.error(err.message || "Error generating lookdev.");
    } finally {
      setIsGeneratingLookdev(false);
    }
  };

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

      if (data.connected_clients === 0) {
        toast.warning(
          `Enqueued ${data.dispatched_count} frames, but Scriptoria Flow Companion is offline.`,
          { duration: 5000 }
        );
        setIsCompanionModalOpen(true);
      } else if (!data.flow_connected) {
        toast.info(
          `Enqueued ${data.dispatched_count} frames! Extension online. Opening Google Flow tab...`,
          { duration: 4000 }
        );
        window.open("https://flow.google.com", "_blank");
      } else {
        toast.success(
          `Dispatched ${data.dispatched_count} frames to Google Flow Bridge! Check Companion Extension tab.`
        );
      }
    } catch (err: any) {
      toast.error(`Flow Dispatch Error: ${err.message}`);
    } finally {
      setIsDispatchingFlow(false);
    }
  };

  // Master 1-Click Launch: Sync Chapter Context, TTS Screenplay, and 90 Frames to Extension
  const handleMasterChapterDispatch = async () => {
    if (!storyboard) {
      toast.error("No storyboard frames to dispatch.");
      return;
    }
    setIsDispatchingMaster(true);
    try {
      let script = screenplayScript;
      if (!script) {
        const fmtRes = await fetch("/api/pipeline/storyboard/tts/format-screenplay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            book_id: storyboard.book_id || selectedBookId,
            chapter_index: storyboard.chapter_index || selectedChapterIdx,
            chapter_title: storyboard.chapter_title,
            storyboard: storyboard,
          }),
        });
        if (fmtRes.ok) {
          const fmtData = await fmtRes.json();
          script = fmtData.screenplay_text || "";
          setScreenplayScript(script);
        }
      }

      const activeBook = books.find((b) => (b.book_id || b.id) === (storyboard.book_id || selectedBookId));

      const payload = {
        book_id: storyboard.book_id || selectedBookId,
        book_title: activeBook?.title || "Moby Dick",
        chapter_index: storyboard.chapter_index || selectedChapterIdx,
        chapter_title: storyboard.chapter_title || `Chapter ${selectedChapterIdx}`,
        total_words: storyboard.total_words || 2206,
        estimated_audio_duration_sec: Math.round(((storyboard.total_words || 2206) / 140) * 60),
        screenplay_transcript: script,
        narrator_voice: "Enzo",
        media_type: mediaType,
        model_engine: flowModelEngine,
        aspect_ratio: "16:9",
        candidate_count: mediaType === "VIDEO" ? 1 : 4,
        total_frames: storyboard.total_frames || allFlatFrames.length,
        frames: allFlatFrames.map((f) => ({
          frame_index: f.frame_index,
          scene_id: f.scene_id,
          compiled_image_prompt: f.compiled_image_prompt,
          shot_type: f.shot_type,
          lens: f.lens,
        })),
        characters: [
          {
            name: "Ishmael",
            mention_handle: "Ishmael",
            archetype: "Narrator & 19th-century sailor",
            visual_prompt:
              "A gaunt contemplative 28-year-old 19th-century American sailor, dark unruly curls under a navy knit fisherman watch cap, patched indigo wool pea coat with bone buttons, weather-beaten fair skin, hollowed melancholic eyes, cinematic chiaroscuro rim lighting, 50mm portrait prime photograph",
            category: "CHARACTER",
          },
          {
            name: "Captain Ahab",
            mention_handle: "Ahab",
            archetype: "Monomaniacal captain of the Pequod",
            visual_prompt:
              "A grim, weather-hardened sea captain in his late 50s, stark white lightning-streak scar running down one side of his face into his collar, standing on a carved whalebone ivory leg, fierce burning obsidian eyes, dark wool naval frock coat whipped by sea gale, 85mm prime telephoto, dramatic low-key rim lighting",
            category: "CHARACTER",
          },
        ],
        auto_open_tabs: true,
      };

      const res = await fetch("/api/v1/flow-bridge/chapter/package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Chapter Package sync failed");

      if (data.connected_clients === 0) {
        toast.warning(
          `Package staged (${payload.total_frames} frames), but Scriptoria Flow Companion is offline! Click to connect.`,
          { duration: 6000 }
        );
        setIsCompanionModalOpen(true);
      } else if (!data.flow_connected) {
        toast.info(
          `🚀 Swarm Synced! Extension online. Opening Google Flow tab now to start generation...`,
          { duration: 5000 }
        );
        window.open("https://flow.google.com", "_blank");
      } else {
        toast.success(
          `🚀 Swarm Synced! Dispatched ${payload.total_frames} frames & ${payload.total_words} words to Extension.`
        );
      }
    } catch (err: any) {
      toast.error(`Master Dispatch Error: ${err.message}`);
    } finally {
      setIsDispatchingMaster(false);
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

          {/* Companion Telemetry Badge & Active Cluster Status Pill */}
          <div className="flex flex-wrap items-center gap-2">
            <FlowCompanionBadge
              onOpenSetup={() => setIsCompanionModalOpen(true)}
              onStatusChange={setCompanionStatus}
            />
            <div className="flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-semibold">Kaggle Swarm Online</span>
              <span className="text-zinc-500">|</span>
              <span className="text-[11px] text-zinc-300 font-mono">Acc 2 (27B) + Acc 1 (5M)</span>
            </div>
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

              {/* Flow Modality Switcher */}
              <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
                <button
                  onClick={() => {
                    setMediaType("IMAGE");
                    setFlowModelEngine("NANO_BANANA");
                  }}
                  className={`px-2.5 py-1 rounded font-medium flex items-center gap-1.5 transition ${
                    mediaType === "IMAGE" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Generate 4-Candidate Image Frames via Nano Banana / Imagen 3"
                >
                  <Camera className="h-3 w-3" /> Image (4x)
                </button>
                <button
                  onClick={() => {
                    setMediaType("VIDEO");
                    setFlowModelEngine("VEO_3_1");
                  }}
                  className={`px-2.5 py-1 rounded font-medium flex items-center gap-1.5 transition ${
                    mediaType === "VIDEO" ? "bg-purple-500/20 text-purple-300 border border-purple-500/40" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Generate 5-Second Video Motion Clips via Veo 3.1"
                >
                  <Film className="h-3 w-3" /> Video (Veo)
                </button>
              </div>

              {/* Casting & Lookdev Studio Pre-Flight Button */}
              <button
                onClick={() => setIsCastingModalOpen(true)}
                className={`h-7 px-3 rounded text-xs font-semibold flex items-center gap-1.5 border transition ${
                  preflightStatus?.is_ready_for_storyboard_dispatch
                    ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/60"
                    : "bg-amber-950/60 border-amber-500/40 text-amber-300 hover:bg-amber-900/60"
                }`}
                title="Configure character lookdev turnarounds and sync ingredients to Google Flow before story generation"
              >
                <User className="h-3.5 w-3.5" />
                🎭 Casting Studio
                {preflightStatus && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-zinc-900/80 border border-zinc-700">
                    {preflightStatus.synced_ingredients}/{preflightStatus.total_required_ingredients}
                  </span>
                )}
              </button>

              {/* Master 1-Click Launch Button */}
              <button
                onClick={handleMasterChapterDispatch}
                disabled={isDispatchingMaster}
                className="h-7 px-3.5 rounded bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-zinc-950 text-xs font-bold flex items-center gap-1.5 shadow-md transition disabled:opacity-50"
                title="Synchronize screenplay transcript, 90 frames, and auto-open Google Flow + AI Studio tabs in Chrome"
              >
                {isDispatchingMaster ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Rocket className="h-3.5 w-3.5 text-zinc-950" />}
                🚀 Launch Companion Swarm (Tabs + Context)
              </button>

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
              {(() => {
                const fIdx = activeTheaterFrame?.frame_index || 1;
                const cands = capturedAssets[fIdx] || [];
                const selIdx = selectedCandidates[fIdx] ?? 0;
                const activeMediaUrl = cands[selIdx] || cands[0] || null;
                const isVideo = activeMediaUrl
                  ? activeMediaUrl.toLowerCase().includes(".mp4") || mediaType === "VIDEO"
                  : false;

                return (
                  <div className="relative aspect-video w-full rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col justify-between shadow-2xl">
                    {/* Visual Media or Placeholder */}
                    {activeMediaUrl ? (
                      isVideo ? (
                        <video
                          key={activeMediaUrl}
                          src={activeMediaUrl}
                          autoPlay
                          loop
                          muted
                          playsInline
                          className="absolute inset-0 w-full h-full object-contain bg-zinc-950"
                        />
                      ) : (
                        <img
                          key={activeMediaUrl}
                          src={activeMediaUrl}
                          alt={`Frame #${fIdx}`}
                          className="absolute inset-0 w-full h-full object-contain bg-zinc-950"
                        />
                      )
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
                        <div className="text-center p-6 max-w-lg space-y-3">
                          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 border border-zinc-800 text-amber-400 shadow-inner">
                            {mediaType === "VIDEO" ? <Film className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
                          </div>
                          <div>
                            <div className="text-xs uppercase font-mono text-zinc-400 tracking-wider">
                              {activeTheaterFrame?.shot_type} • {activeTheaterFrame?.lens}
                            </div>
                            <div className="text-sm font-medium text-zinc-200 mt-1 line-clamp-2">
                              {activeTheaterFrame?.compiled_image_prompt}
                            </div>
                            <div className="text-[10px] text-amber-500/80 font-mono mt-2">
                              ⚡ Awaiting Google Flow {mediaType === "VIDEO" ? "Veo 3.1 Video" : "Nano Banana"} Stream
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Top Overlay Badge */}
                    <div className="relative z-10 flex items-center justify-between p-3 bg-gradient-to-b from-black/80 to-transparent">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-black/60 border border-zinc-700 px-2 py-0.5 text-xs font-mono font-semibold text-amber-400">
                          Frame #{String(fIdx).padStart(2, "0")}
                        </span>
                        {/* 4-Candidate Switcher in Theater Mode */}
                        <div className="flex items-center gap-1 bg-black/70 px-2 py-0.5 rounded border border-zinc-700">
                          <span className="text-[10px] font-mono text-zinc-400 mr-0.5">Pick:</span>
                          {[0, 1, 2, 3].map((candIdx) => {
                            const isSel = (selectedCandidates[fIdx] ?? 0) === candIdx;
                            const hasCand = cands.length > candIdx;
                            return (
                              <button
                                key={candIdx}
                                onClick={() => setSelectedCandidates((prev) => ({ ...prev, [fIdx]: candIdx }))}
                                className={`px-1.5 py-0.2 rounded text-[10px] font-mono transition ${
                                  isSel
                                    ? "bg-amber-500 text-zinc-950 font-bold"
                                    : hasCand
                                    ? "bg-emerald-900/60 text-emerald-200 border border-emerald-600/40"
                                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                                }`}
                                title={`Select Flow Candidate #${candIdx + 1}${hasCand ? " (Ready)" : ""}`}
                              >
                                #{candIdx + 1}
                              </button>
                            );
                          })}
                        </div>
                      </div>
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
                );
              })()}

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

                        {/* 4-Candidate Switcher Bar */}
                        <div className="mt-2 flex items-center justify-between rounded bg-zinc-950/70 px-2 py-1 border border-zinc-800/80">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-zinc-500 font-mono">Candidate:</span>
                            {[0, 1, 2, 3].map((candIdx) => {
                              const isSel = (selectedCandidates[sub.frame_index] ?? 0) === candIdx;
                              return (
                                <button
                                  key={candIdx}
                                  onClick={() => setSelectedCandidates((prev) => ({ ...prev, [sub.frame_index]: candIdx }))}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition ${
                                    isSel
                                      ? "bg-amber-500 text-zinc-950 font-bold shadow-sm"
                                      : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                                  }`}
                                  title={`Select Flow Candidate #${candIdx + 1}`}
                                >
                                  #{candIdx + 1}
                                </button>
                              );
                            })}
                          </div>
                          <span className="text-[10px] font-mono text-zinc-500">
                            Active: <span className="text-amber-400 font-bold">#{(selectedCandidates[sub.frame_index] ?? 0) + 1}</span>
                          </span>
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

      {/* CASTING & LOOKDEV STUDIO MODAL */}
      {isCastingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-100">
                    Scriptoria Casting & Lookdev Studio
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Pre-Flight Character & Location Genesis for Google Flow (flow.google.com)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCastingModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-800"
              >
                Close
              </button>
            </div>

            {/* Pre-Flight Gate Status Banner */}
            <div
              className={`rounded-lg p-3.5 border flex items-center justify-between gap-3 text-xs ${
                preflightStatus?.is_ready_for_storyboard_dispatch
                  ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200"
                  : "bg-amber-950/40 border-amber-500/40 text-amber-200"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <span className="font-semibold">
                    {preflightStatus?.is_ready_for_storyboard_dispatch
                      ? "Pre-Flight Gate Passed:"
                      : "Pre-Flight Status Incomplete:"}
                  </span>{" "}
                  {preflightStatus?.is_ready_for_storyboard_dispatch
                    ? "All required character and location ingredients are locked in Google Flow. Visual conditioning active."
                    : `${preflightStatus?.missing_ingredients?.length || 0} required ingredients are not yet locked in Google Flow. Storyboard generation may result in face drift.`}
                </div>
              </div>
              <button
                onClick={handleSyncAllPreflight}
                disabled={isSyncingPreflight}
                className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold shrink-0 flex items-center gap-1.5 transition disabled:opacity-50"
              >
                {isSyncingPreflight ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <Rocket className="h-3 w-3" />
                )}
                🚀 Sync All to Flow
              </button>
            </div>

            {/* Ingredients Grid */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Required Chapter Ingredients & Handles
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(preflightStatus?.ingredients || []).map((item: any, idx: number) => {
                  const isLocked = item.status === "LOCKED";
                  return (
                    <div
                      key={item.ingredient_id || idx}
                      className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-zinc-200">
                            {item.name}
                          </span>
                          <span className="font-mono text-xs text-amber-400">
                            @{item.mention_handle}
                          </span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 ${
                            isLocked
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          }`}
                        >
                          {isLocked ? "LOCKED ✅" : "PENDING SYNC ⏳"}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between text-xs text-zinc-400 gap-2">
                        <span className="flex items-center gap-1">
                          Category: <span className="text-zinc-300">{item.category}</span>
                        </span>
                        {item.tts_voice && (
                          <span className="flex items-center gap-1">
                            Voice: <span className="text-rose-300">{item.tts_voice} (24kHz)</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-zinc-800">
                        {item.category === "CHARACTER" && (
                          <button
                            onClick={() => handleGenerateLookdev(item)}
                            disabled={isGeneratingLookdev}
                            className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs flex items-center gap-1 transition"
                          >
                            <Layers className="h-3 w-3 text-amber-400" />
                            Turnaround Prompts
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected Character Lookdev Turnaround Sheet Preview */}
            {selectedCharacterLookdev && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    Turnaround Master Prompts: @{selectedCharacterLookdev.mention_handle}
                  </h4>
                  <span className="text-[11px] text-zinc-400">
                    Voice Assigned: <span className="text-rose-400 font-medium">{selectedCharacterLookdev.tts_voice_id}</span>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {(selectedCharacterLookdev.lookdev_poses || []).map((pose: any, pIdx: number) => (
                    <div key={pIdx} className="p-2.5 rounded bg-zinc-950 border border-zinc-800 space-y-1">
                      <div className="font-semibold text-zinc-300 uppercase text-[10px]">
                        {pose.pose_name.replace(/_/g, " ")}
                      </div>
                      <p className="text-[11px] text-zinc-400 line-clamp-3 font-mono">
                        {pose.prompt}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-zinc-800 text-xs">
              <span className="text-zinc-500">
                Ingredients are automatically checked in Flow project: <span className="font-mono text-zinc-400">{preflightStatus?.flow_project_id || "ea1ed436"}</span>
              </span>
              <button
                onClick={loadPreflightStatus}
                disabled={isLoadingPreflight}
                className="px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 flex items-center gap-1.5 transition"
              >
                <RefreshCw className={`h-3 w-3 ${isLoadingPreflight ? "animate-spin" : ""}`} />
                Re-check Flow Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scriptoria Flow Companion Setup & Account Connector Modal */}
      <CompanionSetupModal
        isOpen={isCompanionModalOpen}
        onClose={() => setIsCompanionModalOpen(false)}
        status={companionStatus}
      />
    </div>
  );
}
