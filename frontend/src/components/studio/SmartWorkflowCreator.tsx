"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Wand2,
  HardDrive,
  Sparkles,
  Play,
  BookmarkPlus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Layers,
  DownloadCloud,
  Power,
  Code2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { WorkerProfileId } from "@/lib/catalog/worker-profiles";
import type { DrivePreviewCandidate } from "@/app/api/catalog/scan-drive/route";
import type { CompiledWorkflowResult, WorkflowBuildSpec, WorkflowPipelineKind } from "@/lib/workflow/compiler";
import type { WorkflowStackRecommendation } from "@/lib/workflow/recommender";
import type { StylePresetId } from "@/lib/workflow/modules";
import { WorkflowRecommenderBar } from "@/components/studio/WorkflowRecommenderBar";
import {
  ModularAdaptersDrawer,
  DEFAULT_MODULAR_ADAPTERS,
  DIT_SPLIT_PIPELINES,
  buildAdapterArraysFromState,
  type ModularAdaptersState,
} from "@/components/studio/ModularAdaptersDrawer";
import {
  KaggleVmLauncherDialog,
  bootKaggleAccount,
  formatQuotaHrs,
  useKaggleClusterAccounts,
  type PrewarmModelRef,
} from "@/components/studio/StudioVmLauncher";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface CatalogModelItem {
  id: string;
  slug: string;
  displayName: string;
  modality: string;
  category: string;
  filename: string;
  compatibleBase: string;
  vramEstimateGb: number;
  backupStatus: string;
}

const PIPELINE_OPTIONS: Array<{ id: WorkflowPipelineKind; label: string; group: string }> = [
  { id: "sdxl_txt2img", label: "Illustrious v2.0 / SDXL Standard (16G T4)", group: "IMAGE" },
  { id: "noob_vpred", label: "NoobAI-XL V-Pred 1.0 (ZSNR Dramatic Anime)", group: "IMAGE" },
  { id: "animagine_v4", label: "Animagine XL 4.0 Opt (Clean Studio Cel)", group: "IMAGE" },
  { id: "sdxl_detailer_upscale", label: "SDXL / Character + FaceDetailer + 4x Upscaler", group: "IMAGE" },
  { id: "anima_v1", label: "Anima Turbo v1.0 GGUF + Ref Adapter v2 (16G T4)", group: "IMAGE" },
  { id: "neta_lumina", label: "NetaYume Lumina v4 (Gothic Anime DiT)", group: "IMAGE" },
  { id: "flux3_klein", label: "FLUX 3 Image Klein INT8 ConvRot (Dual-T4 Split 32G)", group: "DUAL-T4" },
  { id: "moss_image", label: "MOSS-Image 5B INT8 + 8-Step DMD2 (Dual-T4 Split 32G)", group: "DUAL-T4" },
  { id: "qwen21_edit", label: "Qwen-Image 2.1 Turbo INT8 ConvRot (Dual-T4 Split 32G)", group: "DUAL-T4" },
  { id: "panorama_360", label: "Qwen 2512 + qwen-360-diffusion (360° Panorama)", group: "DUAL-T4" },
  { id: "flux_gguf", label: "Flux.1 Dev GGUF (16 GB T4)", group: "IMAGE" },
  { id: "qwen_edit", label: "Qwen-Image-Edit 2511 (GGUF 4-Step Edit)", group: "IMAGE" },
  { id: "modular", label: "Custom Modular Pipeline (Auto-Inferred)", group: "IMAGE" },
  { id: "audio_kokoro", label: "Kokoro-82M Fast Dialogue TTS", group: "AUDIO" },
  { id: "audio_f5", label: "F5-TTS Zero-Shot Voice Clone", group: "AUDIO" },
  { id: "audio_mmaudio", label: "MMAudio Video-Synced Foley SFX", group: "AUDIO" },
  { id: "audio_stable", label: "Stable Audio Ambient BGM", group: "AUDIO" },
  { id: "video_ltx", label: "LTX-Video 2B FP8 (Image-to-Video)", group: "VIDEO" },
  { id: "video_latentsync", label: "LatentSync Lip-Sync Overlay", group: "VIDEO" },
];

function inferProfileForPipeline(
  pipeline: WorkflowPipelineKind,
  dualGpuSplit: boolean
): WorkerProfileId {
  if (dualGpuSplit || DIT_SPLIT_PIPELINES.has(pipeline)) return "IMAGE_DIT_DUAL_T4";
  if (pipeline === "flux_gguf" || pipeline === "qwen_edit" || pipeline === "anima_v1") {
    return "IMAGE_GGUF_EDIT";
  }
  if (pipeline.startsWith("audio_") || pipeline === "video_latentsync") return "AUDIO_LIPSYNC";
  if (pipeline === "video_ltx") return "VIDEO_MOTION";
  return "IMAGE_CORE";
}

function defaultVaeForPipeline(pipeline: WorkflowPipelineKind): string {
  if (
    pipeline === "sdxl_txt2img" ||
    pipeline === "sdxl_detailer_upscale" ||
    pipeline === "noob_vpred" ||
    pipeline === "animagine_v4" ||
    pipeline === "modular"
  ) {
    return "sdxl_vae_fp16_fix.safetensors";
  }
  return "";
}

function defaultSamplingForPipeline(pipeline: WorkflowPipelineKind): {
  steps: number;
  cfg: number;
  width: number;
  height: number;
} {
  switch (pipeline) {
    case "noob_vpred":
      return { steps: 28, cfg: 5.0, width: 1024, height: 1024 };
    case "animagine_v4":
      return { steps: 26, cfg: 5.0, width: 1024, height: 1024 };
    case "neta_lumina":
      return { steps: 24, cfg: 4.5, width: 1024, height: 1024 };
    case "anima_v1":
    case "moss_image":
    case "qwen21_edit":
      return { steps: 8, cfg: 1.0, width: 1024, height: 1024 };
    case "flux3_klein":
      return { steps: 12, cfg: 1.0, width: 1024, height: 1024 };
    case "qwen_edit":
      return { steps: 4, cfg: 1.0, width: 1024, height: 1024 };
    case "flux_gguf":
      return { steps: 20, cfg: 1.0, width: 1024, height: 1024 };
    case "panorama_360":
      return { steps: 20, cfg: 3.5, width: 1536, height: 768 };
    default:
      return { steps: 24, cfg: 6.0, width: 1024, height: 1024 };
  }
}

export function SmartWorkflowCreator({ vms }: { vms: PublicVmInstance[] }) {
  const onlineVms = useMemo(
    () => vms.filter((v) => v.status === "ONLINE" || v.status === "BUSY"),
    [vms]
  );
  const { configuredAccounts, bestOfflineAccount, refreshCluster } = useKaggleClusterAccounts(vms);

  const [target, setTarget] = useState(onlineVms[0]?.target || "gpu0");
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [bootingTarget, setBootingTarget] = useState(false);
  const [showAllGpuSlots, setShowAllGpuSlots] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [pipeline, setPipeline] = useState<WorkflowPipelineKind>("sdxl_txt2img");
  const [baseModel, setBaseModel] = useState("Illustrious-XL-v2.0.safetensors");
  const [vaeModel, setVaeModel] = useState("sdxl_vae_fp16_fix.safetensors");
  const [lora1, setLora1] = useState("");
  const [lora1Strength, setLora1Strength] = useState(0.8);
  const [upscalerModel, setUpscalerModel] = useState("");
  const [enableFaceDetailer, setEnableFaceDetailer] = useState(true);
  const [prompt, setPrompt] = useState(
    "masterpiece, best quality, expressive anime hero portrait, golden hour rim lighting"
  );
  const [negativePrompt, setNegativePrompt] = useState(
    "bad quality, blurry, deformed, lowres, extra limbs, watermark"
  );
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [steps, setSteps] = useState(24);
  const [cfg, setCfg] = useState(6.0);
  const [dialogueText, setDialogueText] = useState("");
  const [voice, setVoice] = useState("af_heart");
  const [stylePreset, setStylePreset] = useState<StylePresetId>("anime_vibrant");
  const [adapters, setAdapters] = useState<ModularAdaptersState>(DEFAULT_MODULAR_ADAPTERS);
  const [streamingMissing, setStreamingMissing] = useState(false);

  const [compiled, setCompiled] = useState<CompiledWorkflowResult | null>(null);
  const [architectReasoning, setArchitectReasoning] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");

  // 5 TB Drive AI Preview & Review Modal State
  const [scanningDrive, setScanningDrive] = useState(false);
  const [driveScanModal, setDriveScanModal] = useState<{
    baseFolder: string;
    totalDriveFiles: number;
    linkedCount: number;
    aiProviderUsed: string | null;
    candidates: Array<DrivePreviewCandidate & { selected: boolean }>;
  } | null>(null);
  const [importingDrive, setImportingDrive] = useState(false);

  const { data: catalogData, refetch: refetchCatalog } = useQuery<{
    models: CatalogModelItem[];
  }>({
    queryKey: ["catalog-full"],
    queryFn: async () => {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error("Failed to load catalog");
      return res.json();
    },
    staleTime: 20000,
  });

  // Fetch cached models on currently selected ONLINE VM so picker shows ON GPU badge
  const activeVm = vms.find((v) => v.target === target);
  const selectedVmOnline = activeVm?.status === "ONLINE" || activeVm?.status === "BUSY";
  const selectedVmStarting = activeVm?.status === "STARTING";
  const neededProfile: WorkerProfileId =
    (compiled?.recommendedProfile as WorkerProfileId | undefined) ??
    inferProfileForPipeline(pipeline, adapters.dualGpuSplit);
  const prewarmList: PrewarmModelRef[] = useMemo(
    () =>
      (compiled?.requiredModels ?? []).slice(0, 3).map((m) => ({
        slug: m.slug,
        category: m.category,
        filename: m.filename,
      })),
    [compiled]
  );
  const primaryConfiguredTargets = useMemo(
    () => new Set(configuredAccounts.map((a) => a.primaryTarget)),
    [configuredAccounts]
  );
  const accountByTarget = useMemo(
    () => new Map(configuredAccounts.flatMap((a) => a.targets.map((t) => [t, a] as const))),
    [configuredAccounts]
  );
  const visibleGpuSlots = useMemo(() => {
    const baseList = vms.length
      ? vms
      : ([
          {
            target: "gpu0",
            status: "OFFLINE",
            workerProfile: "IMAGE_CORE",
            accountAlias: "acc1",
            stepProgress: 0,
          },
        ] as PublicVmInstance[]);
    return baseList.filter(
      (v) =>
        showAllGpuSlots ||
        configuredAccounts.length === 0 ||
        v.status === "ONLINE" ||
        v.status === "BUSY" ||
        v.status === "STARTING" ||
        v.target === target ||
        primaryConfiguredTargets.has(v.target)
    );
  }, [vms, showAllGpuSlots, configuredAccounts.length, target, primaryConfiguredTargets]);
  const selectedAccountForTarget =
    accountByTarget.get(target) || bestOfflineAccount || null;

  const { data: vmCatalog } = useQuery<{
    models?: { checkpoints?: string[]; vaes?: string[]; loras?: string[] };
  }>({
    queryKey: ["vm-live-catalog", target],
    enabled: selectedVmOnline,
    queryFn: async () => {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/catalog`);
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 15000,
  });

  const cachedSet = useMemo(() => {
    const set = new Set<string>();
    vmCatalog?.models?.checkpoints?.forEach((c) => set.add(c.toLowerCase()));
    vmCatalog?.models?.vaes?.forEach((c) => set.add(c.toLowerCase()));
    vmCatalog?.models?.loras?.forEach((c) => set.add(c.toLowerCase()));
    return set;
  }, [vmCatalog]);

  const models = catalogData?.models ?? [];

  function modelOriginLabel(m: CatalogModelItem): string {
    if (cachedSet.has(m.filename.toLowerCase())) return "ON GPU";
    if (m.backupStatus === "BACKED_UP") return "5TB DRIVE";
    return "HF · CIVITAI";
  }

  const baseCandidates = models.filter((m) => {
    if (pipeline === "flux3_klein") return m.compatibleBase === "Flux3Klein" && m.category === "diffusion_models";
    if (pipeline === "moss_image") return m.compatibleBase === "MOSSImage" && (m.category === "diffusion_models" || m.category === "unet");
    if (pipeline === "qwen21_edit") return m.compatibleBase === "Qwen21" && m.category === "diffusion_models";
    if (pipeline === "anima_v1") return m.compatibleBase === "Anima" && (m.category === "unet" || m.category === "diffusion_models");
    if (pipeline === "panorama_360") return m.compatibleBase === "Qwen2512" && m.category === "unet";
    if (pipeline === "neta_lumina") return m.compatibleBase === "NetaLumina";
    if (pipeline === "noob_vpred") return m.compatibleBase.includes("Noob") && m.category === "checkpoints";
    if (pipeline === "animagine_v4") return m.compatibleBase === "Animagine";
    if (pipeline === "flux_gguf") return m.category === "unet" || m.compatibleBase.includes("Flux");
    if (pipeline === "qwen_edit") return m.category === "diffusion_models" || m.compatibleBase.includes("QwenEdit");
    if (pipeline.startsWith("audio_")) return m.modality === "AUDIO" || m.category === "checkpoints";
    if (pipeline.startsWith("video_")) return m.modality === "VIDEO";
    return m.category === "checkpoints" || m.category === "diffusion_models" || m.category === "unet";
  });

  const vaeCandidates = models.filter((m) => m.category === "vae");
  const loraCandidates = models.filter((m) => m.category === "loras");
  const upscalerCandidates = models.filter((m) => m.category === "upscale_models");

  function buildSpec(): WorkflowBuildSpec {
    const adapterArrays = buildAdapterArraysFromState(adapters);
    return {
      pipeline,
      stylePreset,
      baseModel: baseModel || undefined,
      vaeModel: vaeModel || undefined,
      loras: lora1 ? [{ filename: lora1, strength: lora1Strength }] : undefined,
      ...adapterArrays,
      relight: adapters.relight,
      relightRefImagePath: adapters.relightRefImage || undefined,
      enableFaceDetailer,
      enableHandDetailer: adapters.enableHandDetailer,
      enable360Preview: adapters.enable360Preview,
      dualGpuSplit: adapters.dualGpuSplit,
      upscalerModel: upscalerModel || undefined,
      prompt,
      negativePrompt,
      width,
      height,
      steps,
      cfg,
      dialogueText: dialogueText || undefined,
      voice,
    };
  }

  function applyRecommendedSpec(spec: WorkflowBuildSpec, tunedPrompt?: { positive: string; negative: string }) {
    const defaults = defaultSamplingForPipeline(spec.pipeline);
    setPipeline(spec.pipeline);
    if (spec.stylePreset) setStylePreset(spec.stylePreset);
    setBaseModel(spec.baseModel || "");
    setVaeModel(spec.vaeModel ?? defaultVaeForPipeline(spec.pipeline));
    setSteps(spec.steps ?? defaults.steps);
    setCfg(spec.cfg ?? defaults.cfg);
    setWidth(spec.width ?? defaults.width);
    setHeight(spec.height ?? defaults.height);
    if (spec.loras?.[0]) {
      setLora1(spec.loras[0].filename);
      setLora1Strength(spec.loras[0].strength ?? 0.85);
    } else {
      setLora1("");
    }
    setEnableFaceDetailer(Boolean(spec.enableFaceDetailer));
    setUpscalerModel(spec.upscalerModel || "");
    if (spec.prompt) setPrompt(spec.prompt);
    else if (tunedPrompt?.positive) setPrompt(tunedPrompt.positive);
    if (spec.negativePrompt !== undefined) setNegativePrompt(spec.negativePrompt);
    else if (tunedPrompt?.negative !== undefined) setNegativePrompt(tunedPrompt.negative);

    setAdapters((prev) => ({
      ...prev,
      ipMode: spec.ipConnectors?.[0]?.mode || "none",
      ipWeight: spec.ipConnectors?.[0]?.weight ?? prev.ipWeight,
      cnMode: spec.controlNets?.[0]?.mode || "none",
      cnStrength: spec.controlNets?.[0]?.strength ?? prev.cnStrength,
      characters: spec.characters ? [...spec.characters] : [],
      relight: spec.relight || "none",
      relightRefImage: spec.relightRefImagePath || "",
      enableHandDetailer: Boolean(spec.enableHandDetailer),
      dualGpuSplit: Boolean(spec.dualGpuSplit || DIT_SPLIT_PIPELINES.has(spec.pipeline)),
      enable360Preview: Boolean(spec.enable360Preview || spec.pipeline === "panorama_360"),
    }));
  }

  function handlePipelineChange(nextPipeline: WorkflowPipelineKind) {
    const isDiT = DIT_SPLIT_PIPELINES.has(nextPipeline);
    const defaults = defaultSamplingForPipeline(nextPipeline);
    setPipeline(nextPipeline);
    setBaseModel("");
    setLora1("");
    setVaeModel(defaultVaeForPipeline(nextPipeline));
    setSteps(defaults.steps);
    setCfg(defaults.cfg);
    setWidth(defaults.width);
    setHeight(defaults.height);
    setArchitectReasoning(null);
    setAdapters((prev) => ({
      ...prev,
      dualGpuSplit: isDiT,
      enable360Preview: nextPipeline === "panorama_360",
    }));
  }

  function handleApplyRecommendation(rec: WorkflowStackRecommendation) {
    applyRecommendedSpec(rec.recommendedSpec, rec.tunedPromptSample);
    setArchitectReasoning(rec.whyRecommended?.join(" ") || null);
    const matchingVm = onlineVms.find((v) => v.workerProfile === rec.targetProfile);
    if (matchingVm) setTarget(matchingVm.target);
    toast.success(`Loaded '${rec.title}' into Architect (${rec.t4ExecutionMode})`);
  }

  async function handleArchitectDesign(
    goalText: string,
    opts: { task: string; stylePreset: StylePresetId; speedPriority: string }
  ) {
    setBusyAction("architect");
    try {
      const res = await fetch("/api/workflow/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "architect",
          goal: goalText,
          target,
          architectInput: {
            task: opts.task,
            stylePreset: opts.stylePreset,
            speedPriority: opts.speedPriority,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "AI Architect design failed");
        return;
      }
      if (data.designedSpec) {
        applyRecommendedSpec(data.designedSpec, {
          positive: data.designedSpec.prompt || data.topRecommendation?.tunedPromptSample?.positive || "",
          negative:
            data.designedSpec.negativePrompt ?? data.topRecommendation?.tunedPromptSample?.negative ?? "",
        });
      }
      setArchitectReasoning(data.reasoning || null);
      if (data.compiled) setCompiled(data.compiled);
      toast.success(data.reasoning || "Designed & compiled modular ComfyUI workflow!");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStreamMissingModels() {
    if (!compiled || !selectedVmOnline) return;
    setStreamingMissing(true);
    let startedCount = 0;
    try {
      for (const rm of compiled.requiredModels) {
        if (cachedSet.has(rm.filename.toLowerCase())) continue;
        const res = await fetch("/api/catalog/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            slug: rm.slug,
            filename: rm.filename,
            category: rm.category,
          }),
        });
        const data = await res.json();
        if (res.ok && data.status === "started") startedCount += 1;
      }
      toast.success(
        startedCount > 0
          ? `Started streaming ${startedCount} missing model(s) onto ${target.toUpperCase()}!`
          : `All required models are already present on ${target.toUpperCase()}.`
      );
    } finally {
      setStreamingMissing(false);
    }
  }

  async function runCreatorAction(
    action: "compile" | "optimize_with_ai" | "save_template" | "compile_and_run"
  ) {
    setBusyAction(action);
    try {
      const res = await fetch("/api/workflow/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          spec: buildSpec(),
          target,
          templateName: templateName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Workflow ${action} failed`);
        return;
      }

      if (data.compiled) setCompiled(data.compiled);
      if (action === "compile") setArchitectReasoning(null);
      if (data.reasoning) setArchitectReasoning(data.reasoning);
      if (action === "optimize_with_ai" && data.optimizedSpec) {
        if (data.optimizedSpec.steps) setSteps(data.optimizedSpec.steps);
        if (data.optimizedSpec.cfg) setCfg(data.optimizedSpec.cfg);
        if (data.optimizedSpec.width) setWidth(data.optimizedSpec.width);
        if (data.optimizedSpec.height) setHeight(data.optimizedSpec.height);
        if (data.optimizedSpec.vaeModel) setVaeModel(data.optimizedSpec.vaeModel);
        toast.success(`AI Optimized: ${data.reasoning || "Tuned for 16GB T4"}`);
      } else if (action === "save_template") {
        toast.success("Saved custom workflow into Workflow Gallery!");
        refetchCatalog();
      } else if (action === "compile_and_run") {
        toast.success(
          data.status === "TRANSFERRING_MODELS"
            ? data.message
            : `Dispatched job ${data.jobId} to ${target.toUpperCase()}!`
        );
      } else {
        toast.success("Compiled resource-aware ComfyUI graph");
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleScanDriveWithAi() {
    setScanningDrive(true);
    try {
      const res = await fetch("/api/catalog/scan-drive?ai=true");
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to scan Google Drive");
        return;
      }
      refetchCatalog();
      const candidates = (data.previewCandidates || []).map((c: DrivePreviewCandidate) => ({
        ...c,
        selected: true,
      }));
      setDriveScanModal({
        baseFolder: data.baseFolder,
        totalDriveFiles: data.totalDriveFiles,
        linkedCount: data.linkedCount,
        aiProviderUsed: data.aiProviderUsed,
        candidates,
      });
      toast.success(
        `Scanned ${data.totalDriveFiles} Drive files (${data.linkedCount} linked, ${candidates.length} new for review)`
      );
    } finally {
      setScanningDrive(false);
    }
  }

  async function handleApproveDriveImport() {
    if (!driveScanModal) return;
    const chosen = driveScanModal.candidates.filter((c) => c.selected);
    if (!chosen.length) return;
    setImportingDrive(true);
    try {
      const res = await fetch("/api/catalog/scan-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseFolder: driveScanModal.baseFolder,
          items: chosen,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Import failed");
        return;
      }
      toast.success(`Imported ${data.imported} Drive model(s) into Master Catalog!`);
      setDriveScanModal(null);
      refetchCatalog();
    } finally {
      setImportingDrive(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* 5 TB Drive Sync & AI Preview Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-[#111114] px-4 py-3">
        <div className="flex items-center gap-3">
          <HardDrive className="h-4 w-4 shrink-0 text-zinc-400" />
          <div>
            <div className="text-xs font-medium text-white">
              Smart Workflow Creator (VM /tmp + 5 TB Drive + HF/Civitai)
            </div>
            <p className="text-[11px] text-zinc-500">
              Select any model in 1 click or scan Drive to AI-review unrecognized files before import.
            </p>
          </div>
        </div>

        <Button
          type="button"
          onClick={handleScanDriveWithAi}
          disabled={scanningDrive}
          className="h-8 bg-zinc-800 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
        >
          {scanningDrive ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5 text-indigo-400" />
          )}
          Scan 5 TB Drive
        </Button>
      </div>

      {/* Multi-Axis Style & Workflow Recommender + AI Architect */}
      <WorkflowRecommenderBar
        onApplyRecommendation={handleApplyRecommendation}
        onArchitectDesign={handleArchitectDesign}
        architectBusy={busyAction === "architect"}
      />

      {/* Main Builder + Live Resource Inspector */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-3.5 rounded-lg border border-zinc-800 bg-[#111114] p-4 lg:col-span-7">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Pipeline Architecture</Label>
              <select
                value={pipeline}
                onChange={(e) => handlePipelineChange(e.target.value as WorkflowPipelineKind)}
                className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
              >
                {PIPELINE_OPTIONS.map((op) => (
                  <option key={op.id} value={op.id} className="bg-zinc-900">
                    [{op.group}] {op.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-[11px]">Target GPU Slot</Label>
                <button
                  type="button"
                  onClick={() => setLauncherOpen(true)}
                  className="font-mono text-[10px] text-amber-300 hover:text-amber-200 hover:underline"
                >
                  Manage Kaggle ({configuredAccounts.length})
                </button>
              </div>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="glass-input w-full rounded-xl px-3 py-2 font-mono text-xs text-zinc-100"
              >
                {visibleGpuSlots.map((v) => {
                  const acc = accountByTarget.get(v.target);
                  const quotaLabel = acc ? ` · ${formatQuotaHrs(acc.remainingSeconds)}` : "";
                  const stepSuffix = v.status === "STARTING" ? ` ${v.stepProgress || 1}/5` : "";
                  return (
                    <option key={v.target} value={v.target} className="bg-zinc-900">
                      {v.target.toUpperCase()} ·{" "}
                      {acc ? `${acc.alias}${acc.username ? ` (${acc.username})` : ""}` : v.accountAlias || "unlinked"}
                      {quotaLabel} · {v.status}
                      {stepSuffix} · {v.workerProfile}
                    </option>
                  );
                })}
              </select>
              {(vms.length > visibleGpuSlots.length || showAllGpuSlots) && (
                <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={showAllGpuSlots}
                    onChange={(e) => setShowAllGpuSlots(e.target.checked)}
                    className="h-3 w-3"
                  />
                  Show all {vms.length} cluster slots (secondary :8189, Colab, TPU)
                </label>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Base Model (1-Click Drive / GPU / HF)</Label>
              <select
                value={baseModel}
                onChange={(e) => setBaseModel(e.target.value)}
                className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
              >
                <option value="" className="bg-zinc-900">
                  Use pipeline default
                </option>
                {baseCandidates.map((m) => (
                  <option key={m.slug} value={m.filename} className="bg-zinc-900">
                    [{modelOriginLabel(m)}] {m.displayName} ({m.compatibleBase})
                  </option>
                ))}
              </select>
            </div>

            {!pipeline.startsWith("audio_") && (
              <div className="space-y-1">
                <Label className="text-[11px]">VAE (Auto T4 Fix)</Label>
                <select
                  value={vaeModel}
                  onChange={(e) => setVaeModel(e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
                >
                  <option value="" className="bg-zinc-900">
                    Checkpoint built-in / Auto-guard
                  </option>
                  {vaeCandidates.map((m) => (
                    <option key={m.slug} value={m.filename} className="bg-zinc-900">
                      [{modelOriginLabel(m)}] {m.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {!pipeline.startsWith("audio_") && !pipeline.startsWith("video_") && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[11px]">Optional LoRA (Style / DMD2 / Turnaround / 360)</Label>
                <select
                  value={lora1}
                  onChange={(e) => setLora1(e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
                >
                  <option value="" className="bg-zinc-900">
                    None
                  </option>
                  {loraCandidates.map((m) => (
                    <option key={m.slug} value={m.filename} className="bg-zinc-900">
                      [{modelOriginLabel(m)}] {m.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">LoRA Strength</Label>
                <Input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1.5}
                  value={lora1Strength}
                  onChange={(e) => setLora1Strength(Number(e.target.value) || 0.8)}
                />
              </div>
            </div>
          )}

          {!pipeline.startsWith("audio_") && !pipeline.startsWith("video_") && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Optional 4x Upscaler</Label>
                <select
                  value={upscalerModel}
                  onChange={(e) => setUpscalerModel(e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
                >
                  <option value="" className="bg-zinc-900">
                    None (1x output)
                  </option>
                  {upscalerCandidates.map((m) => (
                    <option key={m.slug} value={m.filename} className="bg-zinc-900">
                      [{modelOriginLabel(m)}] {m.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs">
                <span>Enable FaceDetailer (YOLOv8m + SAM)</span>
                <input
                  type="checkbox"
                  checked={enableFaceDetailer}
                  onChange={(e) => setEnableFaceDetailer(e.target.checked)}
                  className="h-4 w-4"
                />
              </label>
            </div>
          )}

          {!pipeline.startsWith("audio_") && !pipeline.startsWith("video_") && (
            <ModularAdaptersDrawer
              value={adapters}
              onChange={setAdapters}
              target={target}
              isVmOnline={selectedVmOnline}
              pipeline={pipeline}
            />
          )}

          {pipeline.startsWith("audio_") ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-[11px]">Dialogue / SFX / BGM Prompt</Label>
                <textarea
                  rows={3}
                  value={dialogueText || prompt}
                  onChange={(e) => {
                    setDialogueText(e.target.value);
                    setPrompt(e.target.value);
                  }}
                  className="w-full rounded-xl border border-white/10 bg-black/35 p-3 text-xs text-zinc-100"
                />
              </div>
              {pipeline === "audio_kokoro" && (
                <div className="space-y-1">
                  <Label className="text-[11px]">Kokoro Voice Preset</Label>
                  <select
                    value={voice}
                    onChange={(e) => setVoice(e.target.value)}
                    className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
                  >
                    <option value="af_heart" className="bg-zinc-900">af_heart (Warm Female)</option>
                    <option value="af_bella" className="bg-zinc-900">af_bella (Expressive Female)</option>
                    <option value="am_adam" className="bg-zinc-900">am_adam (Deep Male)</option>
                    <option value="bf_emma" className="bg-zinc-900">bf_emma (British Narrator)</option>
                  </select>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-[11px]">Positive Prompt</Label>
                <textarea
                  rows={2}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/35 p-2.5 text-xs text-zinc-100"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Negative Prompt</Label>
                <Input
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  className="text-xs"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px]">Width</Label>
                  <Input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Height</Label>
                  <Input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Steps</Label>
                  <Input type="number" value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">CFG</Label>
                  <Input type="number" step={0.5} value={cfg} onChange={(e) => setCfg(Number(e.target.value))} />
                </div>
              </div>
            </>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => runCreatorAction("compile")}
              className="glass-pill text-xs text-white hover:bg-white/10"
            >
              {busyAction === "compile" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Layers className="mr-1.5 h-3.5 w-3.5 text-cyan-300" />
              )}
              Compile &amp; Check T4 VRAM
            </Button>

            <Button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => runCreatorAction("optimize_with_ai")}
              className="border border-violet-400/35 bg-violet-600/80 text-xs text-white hover:bg-violet-500"
            >
              {busyAction === "optimize_with_ai" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Ask AI to Optimize
            </Button>

            <Button
              type="button"
              disabled={Boolean(busyAction) || !selectedVmOnline}
              onClick={() => runCreatorAction("compile_and_run")}
              className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-45"
            >
              {busyAction === "compile_and_run" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              Ensure &amp; Run on {target.toUpperCase()}
            </Button>

            {selectedVmStarting ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setLauncherOpen(true)}
                className="border-amber-500/40 bg-amber-500/15 text-xs text-amber-200 hover:bg-amber-500/25"
              >
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-amber-300" />
                Booting {target.toUpperCase()} · {activeVm?.stepProgress || 1}/5
              </Button>
            ) : !selectedVmOnline && selectedAccountForTarget ? (
              <Button
                type="button"
                disabled={bootingTarget}
                onClick={async () => {
                  setBootingTarget(true);
                  try {
                    const ok = await bootKaggleAccount({
                      primaryTarget: selectedAccountForTarget.primaryTarget,
                      alias: selectedAccountForTarget.alias,
                      workerProfile: neededProfile,
                      currentProfile: selectedAccountForTarget.vms[0]?.workerProfile,
                      prewarmModels: prewarmList,
                    });
                    if (ok) {
                      setTarget(selectedAccountForTarget.primaryTarget);
                      await refreshCluster();
                    }
                  } finally {
                    setBootingTarget(false);
                  }
                }}
                className="bg-amber-500 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
              >
                {bootingTarget ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Power className="mr-1.5 h-3.5 w-3.5" />
                )}
                Boot {selectedAccountForTarget.alias.toUpperCase()} ({neededProfile})
              </Button>
            ) : null}

            <Button
              type="button"
              variant="outline"
              onClick={() => setLauncherOpen(true)}
              className="border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              <Power className="mr-1.5 h-3.5 w-3.5 text-amber-300" />
              {selectedVmOnline ? "Kaggle VMs" : "Choose Account"}
            </Button>
          </div>
          {selectedVmOnline && activeVm?.workerProfile && activeVm.workerProfile !== neededProfile && (
            <p className="text-[11px] text-amber-300/90">
              Note: {target.toUpperCase()} is currently running <strong>{activeVm.workerProfile}</strong>, while this pipeline recommends{" "}
              <strong>{neededProfile}</strong>. Click <strong>Kaggle VMs</strong> to boot another account with {neededProfile}.
            </p>
          )}
        </div>

        {/* Right: Resource Preflight Inspector + Save Template */}
        <div className="flex flex-col justify-between space-y-4 rounded-lg border border-zinc-800 bg-[#111114] p-4 lg:col-span-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Cpu className="h-3.5 w-3.5 text-zinc-400" />
                <span>T4 Resource Inspector</span>
              </div>
              {compiled && (
                <span
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                    compiled.vramStatus === "OVER_T4_LIMIT"
                      ? "bg-rose-500/15 text-rose-300"
                      : compiled.vramStatus === "TIGHT"
                      ? "bg-amber-500/15 text-amber-200"
                      : "bg-emerald-500/15 text-emerald-300"
                  }`}
                >
                  {compiled.vramEstimateGb} /{" "}
                  {compiled.recommendedProfile === "IMAGE_DIT_DUAL_T4" ? "32G Dual-T4" : "16G T4"} ·{" "}
                  {compiled.vramStatus}
                </span>
              )}
            </div>

            {architectReasoning && (
              <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-2.5 text-[11px] text-violet-200">
                <strong className="text-violet-100">Architect Reasoning:</strong> {architectReasoning}
              </div>
            )}

            {!compiled ? (
              <p className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">
                Click <strong>Compile &amp; Check T4 VRAM</strong> or <strong>AI Architect</strong> to inspect required models, safety guardrails, and ComfyUI graph.
              </p>
            ) : (
              <div className="space-y-2.5 text-xs">
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium uppercase text-zinc-500">
                      Required Models ({compiled.requiredModels.length}) · {compiled.recommendedProfile}
                    </span>
                    {selectedVmOnline && compiled.requiredModels.length > 0 && (
                      <button
                        type="button"
                        disabled={streamingMissing}
                        onClick={handleStreamMissingModels}
                        className="inline-flex items-center gap-1 rounded border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-200 hover:bg-cyan-500/20"
                      >
                        {streamingMissing ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <DownloadCloud className="h-2.5 w-2.5" />
                        )}
                        Stream Missing to {target.toUpperCase()}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {compiled.requiredModels.map((rm) => {
                      const onGpu = cachedSet.has(rm.filename.toLowerCase());
                      return (
                        <span
                          key={`${rm.category}/${rm.filename}`}
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                            onGpu
                              ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                              : "border-zinc-800 bg-zinc-900 text-zinc-300"
                          }`}
                        >
                          {rm.category}/{rm.filename}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {compiled.t4GuardrailsApplied.map((g, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-2.5 text-[11px] text-emerald-200"
                  >
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{g}</span>
                  </div>
                ))}

                {compiled.warnings.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}

                <div className="rounded-lg border border-zinc-800 bg-zinc-950">
                  <button
                    type="button"
                    onClick={() => setShowRawJson((p) => !p)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-medium text-zinc-300 hover:text-white"
                  >
                    <span className="flex items-center gap-1.5">
                      <Code2 className="h-3.5 w-3.5 text-zinc-400" />
                      <span>
                        {showRawJson ? "Hide" : "Show"} API Graph JSON ({Object.keys(compiled.graph).length} nodes)
                      </span>
                    </span>
                    {showRawJson ? (
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
                    )}
                  </button>
                  {showRawJson && (
                    <pre className="max-h-56 overflow-auto border-t border-zinc-800 bg-black/60 p-3 font-mono text-[10px] text-zinc-300">
                      {JSON.stringify(compiled.graph, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-white/10 pt-3">
            <Input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Custom template name..."
              className="text-xs"
            />
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busyAction)}
              onClick={() => runCreatorAction("save_template")}
              className="shrink-0 border-white/15 bg-white/[0.05] text-xs text-zinc-100 hover:bg-white/10"
            >
              <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
              Save Template
            </Button>
          </div>
        </div>
      </div>

      <KaggleVmLauncherDialog
        open={launcherOpen}
        onOpenChange={setLauncherOpen}
        vms={vms}
        desiredProfile={neededProfile}
        prewarmModels={prewarmList}
        onTargetSelected={(t) => setTarget(t)}
      />

      {/* AI-Assisted 5 TB Drive Preview & Review Modal */}
      <Dialog open={Boolean(driveScanModal)} onOpenChange={(o) => !o && setDriveScanModal(null)}>
        <DialogContent className="glass-popover max-w-3xl border-white/15 text-zinc-100">
          <DialogHeader>
            <DialogTitle>5 TB Google Drive Model Discovery — AI Preview &amp; Review</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Folder: <code>{driveScanModal?.baseFolder}/models/</code> · Linked{" "}
              {driveScanModal?.linkedCount || 0} known files · Found{" "}
              {driveScanModal?.candidates.length || 0} unrecognized files{" "}
              {driveScanModal?.aiProviderUsed ? `(AI reviewed via ${driveScanModal.aiProviderUsed})` : "(heuristic preview)"}
            </DialogDescription>
          </DialogHeader>

          {driveScanModal && driveScanModal.candidates.length === 0 ? (
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-4 text-xs text-emerald-200">
              All {driveScanModal.totalDriveFiles} files inside your Drive `models/` directory are already linked in your Master Catalog!
            </div>
          ) : (
            <div className="space-y-3">
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {driveScanModal?.candidates.map((item, idx) => (
                  <div
                    key={item.gdriveFileId}
                    className="space-y-2 rounded-xl border border-white/10 bg-black/35 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 font-semibold text-white">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={(e) => {
                            const next = [...driveScanModal.candidates];
                            next[idx] = { ...next[idx], selected: e.target.checked };
                            setDriveScanModal({ ...driveScanModal, candidates: next });
                          }}
                        />
                        <span className="font-mono text-[11px] text-cyan-300">
                          {item.relativePath}
                        </span>
                      </label>
                      {item.aiReviewed && (
                        <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] text-violet-200">
                          AI Classified
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                      <Input
                        value={item.displayName}
                        onChange={(e) => {
                          const next = [...driveScanModal.candidates];
                          next[idx] = { ...next[idx], displayName: e.target.value };
                          setDriveScanModal({ ...driveScanModal, candidates: next });
                        }}
                        placeholder="Display Name"
                        className="text-[11px] sm:col-span-2"
                      />
                      <select
                        value={item.modality}
                        onChange={(e) => {
                          const next = [...driveScanModal.candidates];
                          next[idx] = {
                            ...next[idx],
                            modality: e.target.value as DrivePreviewCandidate["modality"],
                          };
                          setDriveScanModal({ ...driveScanModal, candidates: next });
                        }}
                        className="glass-input rounded-xl px-2 py-1 text-[11px]"
                      >
                        <option value="IMAGE" className="bg-zinc-900">IMAGE</option>
                        <option value="AUDIO" className="bg-zinc-900">AUDIO</option>
                        <option value="VIDEO" className="bg-zinc-900">VIDEO</option>
                        <option value="SHARED" className="bg-zinc-900">SHARED</option>
                      </select>
                      <Input
                        value={item.compatibleBase}
                        onChange={(e) => {
                          const next = [...driveScanModal.candidates];
                          next[idx] = { ...next[idx], compatibleBase: e.target.value };
                          setDriveScanModal({ ...driveScanModal, candidates: next });
                        }}
                        placeholder="Base (SDXL/Flux)"
                        className="text-[11px]"
                      />
                    </div>
                    {item.notes && <p className="text-[11px] text-zinc-400">{item.notes}</p>}
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDriveScanModal(null)}
                  className="border-white/15 bg-white/[0.04] text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={importingDrive}
                  onClick={handleApproveDriveImport}
                  className="bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  {importingDrive ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                  )}
                  Approve &amp; Import Selected into Catalog
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

