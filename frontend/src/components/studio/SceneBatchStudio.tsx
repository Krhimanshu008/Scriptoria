"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Film,
  Plus,
  Play,
  Pause,
  RotateCcw,
  Loader2,
  Cpu,
  RefreshCw,
  Trash2,
  Sparkles,
  FileCode2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Upload,
  Grid2x2,
  ListChecks,
  UserCheck,
  Images,
  Download,
  ChevronDown,
  ChevronRight,
  Zap,
  X,
} from "lucide-react";
import { useClusterStore } from "@/store/cluster-store";
import type { WorkflowBuildSpec } from "@/lib/workflow/compiler";
import type { BatchExecutionMode } from "@/lib/batch/ingestion-spec";
import type { IpConnectorMode } from "@/lib/workflow/modules/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface ProjectScene {
  id: string;
  title: string;
  narration: string;
  tracks: {
    visual?: { prompt?: string; width?: number; height?: number };
    audio_tts?: { text?: string; voice?: string };
    audio_sfx?: { prompt?: string };
    audio_bgm?: { mood?: string };
    video_i2v?: { motionPrompt?: string };
  };
}

interface ProjectRecord {
  id: string;
  title: string;
  stylePreset: string;
  characters: Array<{
    id: string;
    name: string;
    triggerWords: string;
    voicePreset: string;
  }>;
  scenes: ProjectScene[];
}

interface BatchOutputFile {
  filename?: string;
  previewUrl?: string;
  gdrivePath?: string;
  gdriveFileId?: string;
}

interface BatchTaskRecord {
  id: string;
  sequenceIndex?: number;
  stageIndex?: number;
  sceneKey: string;
  trackType: string;
  workerProfile: string;
  baseCheckpoint: string;
  assignedTarget: string | null;
  status: string;
  durationMs?: number | null;
  outputs?: BatchOutputFile[];
  errorMessage?: string | null;
}

interface BatchRecord {
  id: string;
  title: string;
  sourceApp: string;
  executionMode?: string;
  status: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  strategy?: {
    estimatedSavingsNote?: string;
    coalescedGroups?: Array<{ workerProfile: string; baseCheckpoint: string; taskCount: number }>;
  };
  tasks: BatchTaskRecord[];
}

type BatchGeneratorMode = "prompt_list" | "matrix" | "character_ip_set" | "folder_i2i";

const DEFAULT_BASE_SPEC: WorkflowBuildSpec = {
  pipeline: "sdxl_txt2img",
  baseModel: "Illustrious-XL-v2.0.safetensors",
  vaeModel: "sdxl_vae_fp16_fix.safetensors",
  prompt: "masterpiece, best quality, anime character illustration",
  negativePrompt: "lowres, bad quality, blurry, deformed, watermark",
  width: 1024,
  height: 1024,
  steps: 24,
  cfg: 6.0,
  enableFaceDetailer: true,
};

const SAMPLE_PROMPTS_LIST = [
  "masterpiece, silver-haired swordsman standing on rain-soaked rooftop under neon moons | lowres, blurry",
  "masterpiece, crimson coat mage casting lightning rune circle in ancient stone citadel",
  "masterpiece, wide shot floating obsidian bridge over glowing abyssal clouds, cinematic rim light",
  "masterpiece, quiet tea house interior at sunset, warm volumetric sunbeams through shoji screen",
].join("\n");

const SAMPLE_EXTERNAL_PAYLOAD = `{
  "sourceApp": "external-tool",
  "title": "Scene Pack · Dual-T4 Render",
  "scenes": [
    {
      "sceneKey": "sc-1",
      "tracks": {
        "visual": { "prompt": "wide shot floating stone bridge in storm clouds, epic lighting", "width": 1344, "height": 768 }
      }
    }
  ]
}`;

export function SceneBatchStudio({ subView }: { subView: "scenes" | "batch" }) {
  const queryClient = useQueryClient();
  const [initialDraft] = useState(() => useClusterStore.getState().batchDraft);
  const setBatchDraft = useClusterStore((s) => s.setBatchDraft);

  // Batch Studio State (initialized lazily from cross-tab batchDraft if present)
  const [genMode, setGenMode] = useState<BatchGeneratorMode>(
    () => initialDraft?.suggestedMode || "prompt_list"
  );
  const [batchTitle, setBatchTitle] = useState(
    () => initialDraft?.title || "Dual-T4 Batch Run"
  );
  const [executionMode, setExecutionMode] = useState<BatchExecutionMode>(() => {
    const bs = initialDraft?.baseSpec;
    if (bs?.dualGpuSplit) return "dual_split";
    return "dual_parallel";
  });
  const [activeBaseSpec, setActiveBaseSpec] = useState<WorkflowBuildSpec>(
    () => initialDraft?.baseSpec || DEFAULT_BASE_SPEC
  );

  // Mode 1: Prompt List / CSV
  const [promptLines, setPromptLines] = useState(SAMPLE_PROMPTS_LIST);

  // Mode 2: Combinatorial Matrix
  const [matrixPrompts, setMatrixPrompts] = useState(
    "cyberpunk neon alley detective in rain\nancient temple shrine maiden with lantern"
  );
  const [matrixModelsText, setMatrixModelsText] = useState(
    () => initialDraft?.baseSpec?.baseModel || "Illustrious-XL-v2.0.safetensors"
  );
  const [matrixCfgs, setMatrixCfgs] = useState("5.0, 6.5");
  const [matrixSteps, setMatrixSteps] = useState("20, 28");
  const [matrixSeedCount, setMatrixSeedCount] = useState(1);

  // Mode 3: Character IP Pose Sheet
  const [ipRefImage, setIpRefImage] = useState(
    () => initialDraft?.baseSpec?.ipConnectors?.[0]?.refImagePath || ""
  );
  const [ipConnectorMode, setIpConnectorMode] = useState<IpConnectorMode>(
    () => initialDraft?.baseSpec?.ipConnectors?.[0]?.mode || "noob_ipa_mk1"
  );
  const [ipWeight, setIpWeight] = useState(
    () => initialDraft?.baseSpec?.ipConnectors?.[0]?.weight ?? 0.72
  );
  const [ipPoses, setIpPoses] = useState(
    [
      "front bust portrait looking at viewer, neutral studio light",
      "three-quarter dynamic action stance holding weapon, wind blowing cloak",
      "full body standing turnaround sheet, clean background details",
      "dramatic backlit rain closeup, intense expression",
    ].join("\n")
  );

  // Mode 4: Folder I2I / External JSON
  const [folderItemsText, setFolderItemsText] = useState("");
  const [showExternalJson, setShowExternalJson] = useState(false);
  const [ingestPayload, setIngestPayload] = useState(SAMPLE_EXTERNAL_PAYLOAD);

  const [dryRunResult, setDryRunResult] = useState<{
    sceneCount?: number;
    normalizedBy?: string;
    adapterNotes?: string;
    coalesceSummary?: {
      estimatedSavingsNote?: string;
      coalescedGroups?: Array<{ workerProfile: string; baseCheckpoint: string; taskCount: number }>;
    };
    plannedTasks?: Array<{
      sceneKey: string;
      trackType: string;
      workerProfile: string;
      baseCheckpoint: string;
      dependsOn: string[];
    }>;
  } | null>(null);
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [controllingBatchId, setControllingBatchId] = useState<string | null>(null);
  const [lightboxItem, setLightboxItem] = useState<{
    url: string;
    filename: string;
    sceneKey: string;
    target?: string | null;
  } | null>(null);

  // Scene Studio State (5-Track Story Pipeline)
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [charName, setCharName] = useState("");
  const [charTriggers, setCharTriggers] = useState("");
  const [charVoice, setCharVoice] = useState("af_heart");
  const [creatingProj, setCreatingProj] = useState(false);

  // Clear consumed cross-tab batchDraft on mount cleanly
  useEffect(() => {
    if (initialDraft) {
      setBatchDraft(null);
    }
  }, [initialDraft, setBatchDraft]);

  const { data: catalogData } = useQuery<{
    models: Array<{ slug: string; displayName: string; filename: string; category: string }>;
  }>({
    queryKey: ["catalog-full"],
    queryFn: async () => {
      const res = await fetch("/api/catalog");
      if (!res.ok) return { models: [] };
      return res.json();
    },
    staleTime: 20000,
  });

  const { data: projectData, refetch: refetchProjects } = useQuery<{ projects: ProjectRecord[] }>({
    queryKey: ["studio-projects"],
    enabled: subView === "scenes",
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: batchData, refetch: refetchBatches } = useQuery<{ batches: BatchRecord[] }>({
    queryKey: ["batch-jobs"],
    queryFn: async () => {
      const res = await fetch("/api/v1/batch");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: (q) => {
      const list = q.state.data?.batches ?? [];
      return list.some((b) => b.status === "QUEUED" || b.status === "RUNNING") ? 3000 : 8000;
    },
  });

  const projects = projectData?.projects ?? [];
  const activeProject =
    projects.find((p) => p.id === selectedProjectId) || projects[0] || null;
  const batches = batchData?.batches ?? [];
  const checkpointModels = useMemo(
    () =>
      (catalogData?.models ?? []).filter((m) =>
        ["checkpoints", "diffusion_models", "unet"].includes(m.category)
      ),
    [catalogData?.models]
  );

  // Matrix preview combo count
  const matrixComboCount = useMemo(() => {
    const p = matrixPrompts.split("\n").filter((l) => l.trim()).length || 1;
    const m = matrixModelsText.split(/[\n,]/).filter((l) => l.trim()).length || 1;
    const c = matrixCfgs.split(",").filter((l) => l.trim()).length || 1;
    const s = matrixSteps.split(",").filter((l) => l.trim()).length || 1;
    return p * m * c * s * Math.max(1, matrixSeedCount);
  }, [matrixPrompts, matrixModelsText, matrixCfgs, matrixSteps, matrixSeedCount]);

  function handleCsvFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const txt = String(reader.result || "").trim();
      if (!txt) return;
      if (file.name.endsWith(".jsonl") || txt.startsWith("{")) {
        const lines = txt
          .split("\n")
          .map((l) => {
            try {
              const obj = JSON.parse(l) as { prompt?: string; negativePrompt?: string; seed?: number; title?: string };
              if (!obj.prompt) return "";
              return [obj.prompt, obj.negativePrompt || "", obj.seed ?? "", obj.title || ""].join(" | ");
            } catch {
              return l;
            }
          })
          .filter(Boolean);
        setPromptLines(lines.join("\n"));
      } else {
        setPromptLines(txt);
      }
      toast.success(`Loaded ${file.name} into Prompt List`);
    };
    reader.readAsText(file);
  }

  function handleFolderImagesUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(0, 24);
    if (!files.length) return;
    Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(`${file.name} | ${String(reader.result || "")}`);
            reader.readAsDataURL(file);
          })
      )
    ).then((rows) => {
      setFolderItemsText((prev) => [prev, ...rows].filter(Boolean).join("\n"));
      toast.success(`Staged ${rows.length} image(s) for Batch Img2Img / Upscale`);
    });
  }

  async function handleExpandBatch(dryRun: boolean) {
    setSubmittingBatch(true);
    try {
      let body: Record<string, unknown> = {
        mode: genMode,
        title: batchTitle.trim() || "Studio Batch",
        executionMode,
        dryRun,
        baseSpec: activeBaseSpec,
      };

      if (genMode === "prompt_list") {
        const items = promptLines
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line, i) => {
            if (line.startsWith("{")) {
              try {
                const obj = JSON.parse(line) as Record<string, unknown>;
                if (typeof obj.prompt === "string" && obj.prompt.trim()) {
                  return obj;
                }
              } catch {
                // Fall back to pipe-delimited parsing
              }
            }
            const parts = line.split("|").map((s) => s.trim());
            const parsedSeed = parts[2] ? Number(parts[2]) : undefined;
            return {
              prompt: parts[0],
              negativePrompt: parts[1] || undefined,
              seed: parsedSeed !== undefined && Number.isFinite(parsedSeed) ? parsedSeed : undefined,
              title: parts[3] || `Shot ${i + 1}`,
            };
          });
        body = { ...body, items };
      } else if (genMode === "matrix") {
        body = {
          ...body,
          matrix: {
            prompts: matrixPrompts.split("\n").map((s) => s.trim()).filter(Boolean),
            baseModels: matrixModelsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
            cfgValues: matrixCfgs.split(",").map((s) => Number(s.trim())).filter(Number.isFinite),
            stepsValues: matrixSteps.split(",").map((s) => Number(s.trim())).filter(Number.isFinite),
            seedCount: matrixSeedCount,
          },
        };
      } else if (genMode === "character_ip_set") {
        body = {
          ...body,
          referenceImage: ipRefImage.trim(),
          ipConnectorMode,
          ipWeight,
          poses: ipPoses.split("\n").map((s) => s.trim()).filter(Boolean),
        };
      } else if (genMode === "folder_i2i") {
        const items = folderItemsText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l, idx) => {
            const sepIdx = l.indexOf("|");
            if (sepIdx > 0) {
              return {
                label: l.slice(0, sepIdx).trim(),
                imagePath: l.slice(sepIdx + 1).trim(),
              };
            }
            return { label: `Img ${idx + 1}`, imagePath: l };
          });
        body = { ...body, items };
      }

      const res = await fetch("/api/v1/batch/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Batch expansion failed");
        return;
      }

      if (dryRun) {
        setDryRunResult(data);
        toast.success(`Dry-run ready: ${data.plannedTasks?.length || 0} task(s) across ${executionMode}`);
      } else {
        setDryRunResult(null);
        toast.success(
          `Enqueued Batch "${batchTitle}" (${data.plannedTasks?.length || data.sceneCount} tasks)!`
        );
        refetchBatches();
      }
    } finally {
      setSubmittingBatch(false);
    }
  }

  async function handleIngestExternal(dryRun: boolean) {
    setSubmittingBatch(true);
    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(ingestPayload);
      } catch {
        parsed = { sourceApp: "studio-raw", title: "Story Batch", rawText: ingestPayload };
      }
      const res = await fetch(`/api/v1/ingest${dryRun ? "?dryRun=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...parsed, executionMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Ingestion failed");
        return;
      }
      if (dryRun) {
        setDryRunResult(data);
        toast.success(`Dry-Run compiled ${data.plannedTasks?.length || 0} task(s)`);
      } else {
        setDryRunResult(null);
        toast.success(`Queued batch (${data.batchId})`);
        refetchBatches();
      }
    } finally {
      setSubmittingBatch(false);
    }
  }

  async function handleBatchControl(batchId: string, action: "pause" | "resume" | "retry_failed") {
    setControllingBatchId(batchId);
    try {
      const res = await fetch(`/api/v1/batch/${batchId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Failed to ${action}`);
        return;
      }
      toast.success(
        action === "retry_failed"
          ? `Re-queued ${data.requeuedCount} failed task(s)`
          : `Batch ${action}d`
      );
      refetchBatches();
    } finally {
      setControllingBatchId(null);
    }
  }

  async function handleTickBatch(batchId: string) {
    const res = await fetch(`/api/v1/batch/${batchId}`);
    const data = await res.json();
    if (res.ok) {
      toast.success(`Scheduler tick complete · Dispatched: ${data.dispatched?.length ?? 0}`);
      refetchBatches();
    }
  }

  async function handleDeleteBatch(batchId: string) {
    await fetch(`/api/v1/batch?id=${batchId}`, { method: "DELETE" });
    refetchBatches();
    queryClient.invalidateQueries({ queryKey: ["batch-jobs"] });
  }

  // Scene helpers (for subView === "scenes")
  async function renameProject() {
    if (!activeProject) return;
    const title = window.prompt("Project name", activeProject.title)?.trim();
    if (!title || title === activeProject.title) return;
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename_project", projectId: activeProject.id, title }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Rename failed");
      await refetchProjects();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rename failed");
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProjectTitle.trim()) return;
    setCreatingProj(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_project", title: newProjectTitle }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create project");
        return;
      }
      setNewProjectTitle("");
      setSelectedProjectId(data.project.id);
      toast.success("Created 5-Track Scene Project");
      refetchProjects();
    } finally {
      setCreatingProj(false);
    }
  }

  async function handleAddCharacter(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProject || !charName.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_character",
        projectId: activeProject.id,
        name: charName,
        triggerWords: charTriggers,
        voicePreset: charVoice,
      }),
    });
    if (res.ok) {
      setCharName("");
      setCharTriggers("");
      toast.success("Saved character profile");
      refetchProjects();
    }
  }

  async function handleAddBlankScene() {
    if (!activeProject) return;
    const idx = activeProject.scenes.length + 1;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_scene",
        projectId: activeProject.id,
        title: `Scene ${idx}`,
        orderIndex: idx,
        tracks: {
          visual: { prompt: "masterpiece, atmospheric anime scene keyframe", width: 1024, height: 1024 },
          audio_tts: { text: "", voice: "af_heart" },
          audio_sfx: { prompt: "" },
          audio_bgm: { mood: "" },
          video_i2v: { motionPrompt: "subtle camera zoom, wind in clothes" },
        },
      }),
    });
    if (res.ok) refetchProjects();
  }

  async function handleSaveSceneTracks(scene: ProjectScene, tracks: ProjectScene["tracks"]) {
    if (!activeProject) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_scene",
        projectId: activeProject.id,
        sceneId: scene.id,
        title: scene.title,
        tracks,
      }),
    });
    if (res.ok) {
      toast.success(`Saved ${scene.title}`);
      refetchProjects();
    }
  }

  async function handleDispatchProjectBatch() {
    if (!activeProject) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "compile_project_batch", projectId: activeProject.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to dispatch");
      return;
    }
    toast.success(`Dispatched 5-Track Batch (${data.batchId})`);
    refetchBatches();
  }

  if (subView === "scenes") {
    return (
      <div className="space-y-4">
        <div className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
          <div className="flex items-center gap-2.5">
            <Film className="h-4 w-4 text-emerald-400" />
            <div>
              <h2 className="text-sm font-bold text-white">5-Track Storyboard Scene Studio</h2>
              <p className="text-[11px] text-zinc-400">
                Optional project/character tracker for multi-track storyboards (Visual, Video I2V, TTS, SFX, BGM).
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateProject} className="flex items-center gap-2">
            <Input
              value={newProjectTitle}
              onChange={(e) => setNewProjectTitle(e.target.value)}
              placeholder="New Project title..."
              className="w-52 text-xs"
            />
            <Button type="submit" disabled={creatingProj} className="bg-emerald-600 text-xs text-white">
              <Plus className="mr-1 h-3.5 w-3.5" /> Create
            </Button>
          </form>
        </div>

        {activeProject ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="glass-panel space-y-4 rounded-2xl p-4 lg:col-span-4">
              <div className="space-y-1">
                <Label className="text-[11px]">Active Project</Label>
                <div className="flex gap-1.5">
                  <select
                    value={activeProject.id}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    className="glass-input flex-1 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id} className="bg-zinc-900">
                        {p.title} ({p.scenes.length} scenes)
                      </option>
                    ))}
                  </select>
                  <Button type="button" size="sm" variant="outline" onClick={renameProject} className="h-9 px-2.5 text-[11px] border-white/10 bg-black/30 text-zinc-300">
                    Rename
                  </Button>
                </div>
              </div>

              <form onSubmit={handleAddCharacter} className="space-y-2 border-t border-white/10 pt-3">
                <div className="text-xs font-semibold text-white">Character Consistency Profiles</div>
                <Input value={charName} onChange={(e) => setCharName(e.target.value)} placeholder="Name" className="text-xs" />
                <Input value={charTriggers} onChange={(e) => setCharTriggers(e.target.value)} placeholder="Trigger words" className="text-xs" />
                <div className="flex gap-2">
                  <select
                    value={charVoice}
                    onChange={(e) => setCharVoice(e.target.value)}
                    className="glass-input flex-1 rounded-xl px-2 py-1.5 text-xs text-white"
                  >
                    <option value="af_heart" className="bg-zinc-900">af_heart</option>
                    <option value="af_bella" className="bg-zinc-900">af_bella</option>
                    <option value="am_adam" className="bg-zinc-900">am_adam</option>
                  </select>
                  <Button type="submit" size="sm" className="glass-pill text-xs text-cyan-200">Add</Button>
                </div>
              </form>

              <Button type="button" onClick={handleDispatchProjectBatch} className="w-full bg-indigo-600 text-xs font-semibold text-white">
                <Play className="mr-1.5 h-3.5 w-3.5" /> Compile &amp; Dispatch All 5 Tracks
              </Button>
            </div>

            <div className="space-y-3 lg:col-span-8">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-300">Scenes ({activeProject.scenes.length})</span>
                <Button type="button" size="sm" onClick={handleAddBlankScene} className="glass-pill text-xs text-white">
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add Scene Row
                </Button>
              </div>
              {activeProject.scenes.map((scene) => (
                <SceneTrackCard key={scene.id} scene={scene} onSave={(t) => handleSaveSceneTracks(scene, t)} />
              ))}
            </div>
          </div>
        ) : (
          <div className="glass-card rounded-2xl p-6 text-center text-xs text-zinc-400">
            Create a project above to organize multi-track scenes.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Inherited Workflow Blueprint & Dual-T4 Execution Strategy */}
      <div className="space-y-4 rounded-xl border border-zinc-800 bg-[#111114] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <Cpu className="h-4 w-4 text-cyan-400" />
              Standalone Dual-T4 Batch Studio
            </h2>
            <p className="text-[11px] text-zinc-400">
              Runs full modular Architect graphs (IP-Adapters, ControlNets, Multi-Char Boxes, Detailers, LBM Relight, Upscalers) across GPU0 + GPU1 with checkpoint coalescing.
            </p>
          </div>

          {/* 4 Generator Mode Pills */}
          <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1 text-[11px]">
            {(
              [
                { id: "prompt_list", label: "Prompt List / CSV", icon: ListChecks },
                { id: "matrix", label: "Combinatorial Matrix", icon: Grid2x2 },
                { id: "character_ip_set", label: "Character IP Sheet", icon: UserCheck },
                { id: "folder_i2i", label: "Bulk Img2Img / Upscale", icon: Images },
              ] as const
            ).map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setGenMode(m.id);
                    setDryRunResult(null);
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${
                    genMode === m.id ? "bg-indigo-600/85 text-white" : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Base Workflow Summary Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800/90 bg-zinc-950 px-3 py-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-300">Inherited Graph:</span>
            <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-[10px] text-indigo-200">
              {activeBaseSpec.pipeline}
            </span>
            {activeBaseSpec.baseModel && (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                {activeBaseSpec.baseModel}
              </span>
            )}
            {activeBaseSpec.enableFaceDetailer && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                +FaceDetailer
              </span>
            )}
            {activeBaseSpec.enableHandDetailer && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                +HandDetailer
              </span>
            )}
            {activeBaseSpec.upscalerModel && (
              <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] text-violet-300">
                +{activeBaseSpec.upscalerModel}
              </span>
            )}
            {activeBaseSpec.relight && activeBaseSpec.relight !== "none" && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                +{activeBaseSpec.relight}
              </span>
            )}
            {activeBaseSpec.ipConnectors?.length ? (
              <span className="rounded bg-pink-500/15 px-1.5 py-0.5 font-mono text-[10px] text-pink-200">
                +IP ({activeBaseSpec.ipConnectors[0].mode})
              </span>
            ) : null}
            {activeBaseSpec.controlNets?.length ? (
              <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] text-cyan-200">
                +CN ({activeBaseSpec.controlNets[0].mode})
              </span>
            ) : null}
            {activeBaseSpec.characters?.length ? (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-200">
                +{activeBaseSpec.characters.length} Spatial Boxes
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setActiveBaseSpec(DEFAULT_BASE_SPEC)}
            className="text-[10px] text-zinc-500 hover:text-zinc-200"
          >
            Reset Base Spec
          </button>
        </div>

        {/* Batch Title + Dual-T4 Execution Mode */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="space-y-1 md:col-span-5">
            <Label className="text-[11px] text-zinc-300">Batch Name</Label>
            <Input
              value={batchTitle}
              onChange={(e) => setBatchTitle(e.target.value)}
              placeholder="e.g. Chapter Characters · 2x T4"
              className="h-9 text-xs"
            />
          </div>

          <div className="space-y-1 md:col-span-7">
            <Label className="flex items-center gap-1 text-[11px] text-zinc-300">
              <Zap className="h-3 w-3 text-amber-400" />
              Dual-T4 Execution Strategy (on 1 Kaggle Account)
            </Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {(
                [
                  { id: "dual_parallel", title: "Dual Parallel", sub: "2× throughput (GPU0+1)" },
                  { id: "dual_pipeline", title: "2-Stage Pipe", sub: "GPU0 Base → GPU1 Refine" },
                  { id: "dual_split", title: "32G DiT Split", sub: "FLUX3 / MOSS / Qwen2.1" },
                  { id: "single", title: "Single GPU", sub: "Sequential on 1 slot" },
                ] as const
              ).map((strat) => (
                <button
                  key={strat.id}
                  type="button"
                  onClick={() => setExecutionMode(strat.id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left transition ${
                    executionMode === strat.id
                      ? "border-amber-400/50 bg-amber-500/15 text-amber-100"
                      : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <div className="text-[11px] font-semibold">{strat.title}</div>
                  <div className="truncate text-[9.5px] opacity-80">{strat.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Mode-Specific Controls */}
        {genMode === "prompt_list" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-[11px] text-zinc-300">
                Prompts (1 per line, <code className="text-cyan-300">prompt | negative | seed | title</code>, or JSONL)
              </Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { key: "abAnchor5" as const, label: "LOTM Ch.214: A/B Anchor #5", title: "LOTM Ch.214 A/B Anchor #5 (Qwen 2.1 vs Qwen Edit)" },
                  { key: "anchors8Qwen21" as const, label: "Ch.214: 8 Anchors (Qwen 2.1)", title: "LOTM Ch.214 Wave 1 (8 Anchors · Qwen 2.1 Dual-T4)" },
                  { key: "pilot10Qwen21AnchorsPlusEditCov" as const, label: "Ch.214: 10-Shot Pilot DAG", title: "LOTM Ch.214 Pilot (8 Anchors + 2 Qwen-Edit Coverage DAG)" },
                ].map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/test-kits/ch214");
                        if (!res.ok) throw new Error("Failed to load Ch.214 kit");
                        const kit = (await res.json()) as {
                          studioBatchPresets: Record<string, Array<Record<string, unknown>>>;
                        };
                        const rows = kit.studioBatchPresets[preset.key] || [];
                        if (rows.length === 0) return;
                        setExecutionMode("dual_split");
                        setBatchTitle(preset.title);
                        setActiveBaseSpec((prev) => ({
                          ...prev,
                          pipeline: "qwen21_edit",
                          architecture: "qwen21",
                          baseModel: "qwen_image_2.1_turbo_int8_convrot.safetensors",
                          dualGpuSplit: true,
                          width: 1344,
                          height: 768,
                        }));
                        setPromptLines(rows.map((r) => JSON.stringify(r)).join("\n"));
                        toast.success(`Loaded ${preset.label} (${rows.length} jobs for Acc1 dual_split)`);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Failed to load preset");
                      }
                    }}
                    className="rounded-md border border-violet-500/40 bg-violet-950/30 px-2 py-1 text-[10.5px] font-medium text-violet-200 hover:bg-violet-900/40"
                  >
                    {preset.label}
                  </button>
                ))}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800">
                  <Upload className="h-3 w-3 text-cyan-300" />
                  Import .TXT / .CSV / .JSONL
                  <input type="file" accept=".txt,.csv,.jsonl" className="hidden" onChange={handleCsvFileUpload} />
                </label>
              </div>
            </div>
            <textarea
              rows={6}
              value={promptLines}
              onChange={(e) => setPromptLines(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-black/50 p-3 font-mono text-xs text-zinc-100"
            />
          </div>
        )}

        {genMode === "matrix" && (
          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-zinc-300">Prompts (1 per line)</Label>
                <textarea
                  rows={4}
                  value={matrixPrompts}
                  onChange={(e) => setMatrixPrompts(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-black/40 p-2 font-mono text-xs text-zinc-100"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-zinc-300">Checkpoints (1 per line or click to toggle)</Label>
                <textarea
                  rows={2}
                  value={matrixModelsText}
                  onChange={(e) => setMatrixModelsText(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-black/40 p-2 font-mono text-xs text-zinc-100"
                />
                <div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto pt-1">
                  {checkpointModels.slice(0, 10).map((m) => {
                    const active = matrixModelsText.includes(m.filename);
                    return (
                      <button
                        key={m.slug}
                        type="button"
                        onClick={() => {
                          const list = matrixModelsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
                          const next = active ? list.filter((x) => x !== m.filename) : [...list, m.filename];
                          setMatrixModelsText(next.join("\n"));
                        }}
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] ${
                          active
                            ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-200"
                            : "border-zinc-800 bg-zinc-900 text-zinc-400"
                        }`}
                      >
                        {m.filename}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-[10px] text-zinc-400">CFG Values (comma-sep)</Label>
                <Input value={matrixCfgs} onChange={(e) => setMatrixCfgs(e.target.value)} className="h-8 font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-zinc-400">Step Values (comma-sep)</Label>
                <Input value={matrixSteps} onChange={(e) => setMatrixSteps(e.target.value)} className="h-8 font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-zinc-400">Seeds / Variant</Label>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={matrixSeedCount}
                  onChange={(e) => setMatrixSeedCount(Number(e.target.value) || 1)}
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="flex items-end">
                <div className="w-full rounded-md border border-indigo-500/35 bg-indigo-500/10 px-2.5 py-1.5 text-center font-mono text-xs text-indigo-200">
                  {matrixComboCount} combinations (auto-coalesced)
                </div>
              </div>
            </div>
          </div>
        )}

        {genMode === "character_ip_set" && (
          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[11px] text-zinc-300">Character Reference Image (URL / Path / Upload)</Label>
                <div className="flex gap-1.5">
                  <Input
                    value={ipRefImage}
                    onChange={(e) => setIpRefImage(e.target.value)}
                    placeholder="character_ref.png or https://..."
                    className="h-8 text-xs"
                  />
                  <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[11px] text-zinc-200">
                    <Upload className="h-3 w-3" /> Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const r = new FileReader();
                        r.onload = () => setIpRefImage(String(r.result || ""));
                        r.readAsDataURL(f);
                      }}
                    />
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-zinc-300">IP Engine</Label>
                  <select
                    value={ipConnectorMode}
                    onChange={(e) => setIpConnectorMode(e.target.value as IpConnectorMode)}
                    className="glass-input h-8 w-full rounded-md px-2 text-xs text-zinc-100"
                  >
                    <option value="noob_ipa_mk1" className="bg-zinc-900">IPAdapter Plus</option>
                    <option value="sdxl_ipa_photoreal" className="bg-zinc-900">SDXL FaceID</option>
                    <option value="style_aligned" className="bg-zinc-900">StyleAligned</option>
                    <option value="anima_ref_v2" className="bg-zinc-900">Anima Ref</option>
                    <option value="flux3_ref_latent" className="bg-zinc-900">FLUX3 RefLatent</option>
                    <option value="qwen21_ref_strength" className="bg-zinc-900">Qwen2.1 Ref</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-zinc-300">Weight</Label>
                  <Input
                    type="number"
                    step={0.05}
                    min={0.1}
                    max={1.2}
                    value={ipWeight}
                    onChange={(e) => setIpWeight(Number(e.target.value) || 0.72)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-zinc-300">Pose / Angle / Expression Variations (1 per line)</Label>
              <textarea
                rows={4}
                value={ipPoses}
                onChange={(e) => setIpPoses(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-black/40 p-2 font-mono text-xs text-zinc-100"
              />
            </div>
          </div>
        )}

        {genMode === "folder_i2i" && (
          <div className="space-y-2.5 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-[11px] text-zinc-300">
                Batch Image Paths or Uploaded Frames (1 per line: <code className="text-cyan-300">label | pathOrDataUri</code>)
              </Label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800">
                <Upload className="h-3 w-3 text-emerald-300" />
                Select Local Images
                <input type="file" multiple accept="image/*" className="hidden" onChange={handleFolderImagesUpload} />
              </label>
            </div>
            <textarea
              rows={4}
              value={folderItemsText}
              onChange={(e) => setFolderItemsText(e.target.value)}
              placeholder="Upload images above or paste URLs / Drive paths (one per line)..."
              className="w-full rounded-lg border border-zinc-800 bg-black/40 p-2 font-mono text-xs text-zinc-100"
            />

            <button
              type="button"
              onClick={() => setShowExternalJson((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              {showExternalJson ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <FileCode2 className="h-3 w-3 text-cyan-300" />
              External JSON / Book Visualiser Ingestion Adapter
            </button>

            {showExternalJson && (
              <div className="space-y-2 pt-1">
                <textarea
                  rows={5}
                  value={ingestPayload}
                  onChange={(e) => setIngestPayload(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-black/50 p-2 font-mono text-[11px] text-cyan-100"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={submittingBatch}
                    onClick={() => handleIngestExternal(true)}
                    variant="outline"
                    className="h-7 border-zinc-700 text-[11px]"
                  >
                    Dry-Run JSON Adapter
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={submittingBatch}
                    onClick={() => handleIngestExternal(false)}
                    className="h-7 bg-cyan-600 text-[11px] text-white hover:bg-cyan-500"
                  >
                    Queue JSON Spec
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Dry-Run & Enqueue Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            disabled={submittingBatch}
            onClick={() => handleExpandBatch(true)}
            className="glass-pill text-xs text-white hover:bg-white/10"
          >
            {submittingBatch ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5 text-amber-300" />}
            Dry-Run &amp; Preview Coalesced Plan
          </Button>
          <Button
            type="button"
            disabled={submittingBatch}
            onClick={() => handleExpandBatch(false)}
            className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            {submittingBatch ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
            Enqueue &amp; Run on Dual-T4 ({executionMode})
          </Button>
        </div>

        {dryRunResult && (
          <div className="space-y-2 rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-cyan-200">
                Dry-Run Plan: {dryRunResult.plannedTasks?.length || 0} task(s)
              </span>
              <span className="font-mono text-[10px] text-zinc-400">
                {dryRunResult.coalesceSummary?.estimatedSavingsNote}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {dryRunResult.coalesceSummary?.coalescedGroups?.map((g, i) => (
                <span key={i} className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-zinc-200">
                  {g.workerProfile} · {g.baseCheckpoint} ({g.taskCount}×)
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Live Multi-GPU Execution Monitor + GPU Lanes + Contact Sheet */}
      <div className="space-y-3 rounded-xl border border-zinc-800 bg-[#111114] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <Cpu className="h-4 w-4 text-emerald-400" />
            Live Dual-T4 Batch Queue &amp; Contact Sheet ({batches.length})
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => refetchBatches()}
            className="h-7 border-zinc-700 bg-zinc-900 text-[11px] text-zinc-200"
          >
            <RefreshCw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </div>

        {batches.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No batch jobs queued yet. Add prompts, sweep a matrix, or send a workflow from Architect above.
          </p>
        ) : (
          <div className="space-y-4">
            {batches.map((b) => {
              const pct = b.totalTasks > 0 ? Math.round((b.completedTasks / b.totalTasks) * 100) : 0;
              const isPaused = b.status === "PAUSED";
              const completedImages = b.tasks.flatMap((t) =>
                (t.outputs || [])
                  .filter((o) => Boolean(o?.previewUrl))
                  .map((o) => ({
                    url: o.previewUrl!,
                    filename: o.filename || `${t.sceneKey}.png`,
                    sceneKey: t.sceneKey,
                    target: t.assignedTarget,
                    durationMs: t.durationMs,
                  }))
              );

              return (
                <div
                  key={b.id}
                  className="space-y-3 rounded-xl border border-zinc-800 bg-black/35 p-3.5 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">{b.title}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                          b.status === "COMPLETED"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : b.status === "PAUSED"
                            ? "bg-amber-500/20 text-amber-200"
                            : b.status === "FAILED" || b.status === "PARTIAL"
                            ? "bg-rose-500/20 text-rose-300"
                            : "bg-indigo-500/20 text-indigo-200"
                        }`}
                      >
                        {b.status}
                      </span>
                      {b.executionMode && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                          {b.executionMode}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px] text-zinc-300">
                        {b.completedTasks}/{b.totalTasks} ({pct}%)
                        {b.failedTasks > 0 ? ` · ${b.failedTasks} failed` : ""}
                      </span>

                      {(b.status === "QUEUED" || b.status === "RUNNING") && (
                        <button
                          type="button"
                          disabled={controllingBatchId === b.id}
                          onClick={() => handleBatchControl(b.id, "pause")}
                          className="inline-flex items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200 hover:bg-amber-500/20"
                        >
                          <Pause className="h-3 w-3" /> Pause
                        </button>
                      )}

                      {isPaused && (
                        <button
                          type="button"
                          disabled={controllingBatchId === b.id}
                          onClick={() => handleBatchControl(b.id, "resume")}
                          className="inline-flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/25"
                        >
                          <Play className="h-3 w-3" /> Resume
                        </button>
                      )}

                      {b.failedTasks > 0 && (
                        <button
                          type="button"
                          disabled={controllingBatchId === b.id}
                          onClick={() => handleBatchControl(b.id, "retry_failed")}
                          className="inline-flex items-center gap-1 rounded border border-rose-500/35 bg-rose-500/15 px-2 py-1 text-[10px] text-rose-200 hover:bg-rose-500/25"
                        >
                          <RotateCcw className="h-3 w-3" /> Retry Failed
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleTickBatch(b.id)}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-200 hover:bg-zinc-800"
                      >
                        Tick
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteBatch(b.id)}
                        className="p-1 text-zinc-500 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                    <div
                      className={`h-full transition-all duration-300 ${
                        b.status === "FAILED" ? "bg-rose-500" : isPaused ? "bg-amber-400" : "bg-emerald-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Contact Sheet Image Grid */}
                  {completedImages.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4 md:grid-cols-6">
                      {completedImages.map((img, i) => (
                        <button
                          key={`${img.sceneKey}-${i}`}
                          type="button"
                          onClick={() => setLightboxItem(img)}
                          className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-800 bg-black/50 text-left"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt={img.filename} className="h-full w-full object-cover transition group-hover:scale-105" />
                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/75 px-1.5 py-0.5 font-mono text-[9px] text-zinc-200">
                            <span className="truncate">{img.sceneKey}</span>
                            {img.target && <span className="text-emerald-300">{img.target.toUpperCase()}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Task Execution Lanes */}
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {b.tasks.map((t) => (
                      <div
                        key={t.id}
                        title={t.errorMessage || t.baseCheckpoint}
                        className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-white/[0.02] px-2.5 py-1.5 font-mono text-[10px]"
                      >
                        <span className="truncate text-zinc-200">
                          {t.stageIndex && t.stageIndex > 1 ? `S${t.stageIndex}·` : ""}
                          {t.sceneKey}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {t.durationMs != null && (
                            <span className="text-zinc-500">{(t.durationMs / 1000).toFixed(1)}s</span>
                          )}
                          {t.assignedTarget && (
                            <span className="rounded bg-indigo-500/20 px-1 text-indigo-200">
                              {t.assignedTarget.toUpperCase()}
                            </span>
                          )}
                          {t.status === "COMPLETED" ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          ) : t.status === "FAILED" || t.status === "BLOCKED" ? (
                            <AlertCircle className="h-3 w-3 text-rose-400" />
                          ) : t.status === "PROCESSING" ? (
                            <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />
                          ) : (
                            <Clock className="h-3 w-3 text-amber-300" />
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Contact Sheet Lightbox Modal */}
      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightboxItem(null)}
        >
          <div
            className="max-w-3xl space-y-3 rounded-xl border border-zinc-700 bg-[#111114] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-xs text-zinc-200">
              <span className="font-mono font-semibold">
                {lightboxItem.sceneKey} {lightboxItem.target ? `· ${lightboxItem.target.toUpperCase()}` : ""}
              </span>
              <div className="flex items-center gap-3">
                <a
                  href={lightboxItem.url}
                  download={lightboxItem.filename}
                  className="inline-flex items-center gap-1 text-cyan-300 hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
                <button type="button" onClick={() => setLightboxItem(null)} className="text-zinc-400 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightboxItem.url} alt={lightboxItem.filename} className="max-h-[75vh] w-full rounded-lg object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}

function SceneTrackCard({
  scene,
  onSave,
}: {
  scene: ProjectScene;
  onSave: (tracks: ProjectScene["tracks"]) => Promise<void>;
}) {
  const [tracks, setTracks] = useState(scene.tracks);
  const [saving, setSaving] = useState(false);

  return (
    <div className="glass-panel space-y-3 rounded-2xl p-4 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white">{scene.title}</span>
        <Button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(tracks);
            } finally {
              setSaving(false);
            }
          }}
          className="glass-pill h-7 text-[11px] text-emerald-200"
        >
          {saving ? "Saving..." : "Save Tracks"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-cyan-300">Track 1 · Visual Keyframe Prompt</Label>
          <textarea
            rows={2}
            value={tracks.visual?.prompt || ""}
            onChange={(e) =>
              setTracks({ ...tracks, visual: { ...tracks.visual, prompt: e.target.value } })
            }
            placeholder="Describe scene keyframe..."
            className="w-full rounded-xl border border-white/10 bg-black/35 p-2 text-[11px] text-zinc-100"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-amber-300">Track 2 · Video Motion Prompt (I2V)</Label>
          <textarea
            rows={2}
            value={tracks.video_i2v?.motionPrompt || ""}
            onChange={(e) =>
              setTracks({
                ...tracks,
                video_i2v: { ...tracks.video_i2v, motionPrompt: e.target.value },
              })
            }
            placeholder="Camera motion / subtle wind..."
            className="w-full rounded-xl border border-white/10 bg-black/35 p-2 text-[11px] text-zinc-100"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-emerald-300">Track 3 · Dialogue TTS Line</Label>
          <Input
            value={tracks.audio_tts?.text || ""}
            onChange={(e) =>
              setTracks({ ...tracks, audio_tts: { ...tracks.audio_tts, text: e.target.value } })
            }
            placeholder="Spoken line..."
            className="text-[11px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-violet-300">Track 4 · Foley SFX</Label>
            <Input
              value={tracks.audio_sfx?.prompt || ""}
              onChange={(e) =>
                setTracks({ ...tracks, audio_sfx: { ...tracks.audio_sfx, prompt: e.target.value } })
              }
              placeholder="Rain, sword..."
              className="text-[11px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-rose-300">Track 5 · Ambient BGM</Label>
            <Input
              value={tracks.audio_bgm?.mood || ""}
              onChange={(e) =>
                setTracks({ ...tracks, audio_bgm: { ...tracks.audio_bgm, mood: e.target.value } })
              }
              placeholder="Tense strings..."
              className="text-[11px]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
