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
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { DrivePreviewCandidate } from "@/app/api/catalog/scan-drive/route";
import type { CompiledWorkflowResult, WorkflowBuildSpec, WorkflowPipelineKind } from "@/lib/workflow/compiler";
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
  { id: "sdxl_txt2img", label: "SDXL / Illustrious / Turbo Txt2Img", group: "IMAGE" },
  { id: "sdxl_detailer_upscale", label: "Character + FaceDetailer + 4x Upscaler", group: "IMAGE" },
  { id: "flux_gguf", label: "Flux.1 Dev GGUF (16 GB T4)", group: "IMAGE" },
  { id: "qwen_edit", label: "Qwen-Image-Edit 2511 (GGUF)", group: "IMAGE" },
  { id: "audio_kokoro", label: "Kokoro-82M Fast Dialogue TTS", group: "AUDIO" },
  { id: "audio_f5", label: "F5-TTS Zero-Shot Voice Clone", group: "AUDIO" },
  { id: "audio_mmaudio", label: "MMAudio Video-Synced Foley SFX", group: "AUDIO" },
  { id: "audio_stable", label: "Stable Audio Ambient BGM", group: "AUDIO" },
  { id: "video_ltx", label: "LTX-Video 2B FP8 (Image-to-Video)", group: "VIDEO" },
  { id: "video_latentsync", label: "LatentSync Lip-Sync Overlay", group: "VIDEO" },
];

export function SmartWorkflowCreator({ vms }: { vms: PublicVmInstance[] }) {
  const onlineVms = useMemo(
    () => vms.filter((v) => v.status === "ONLINE" || v.status === "BUSY"),
    [vms]
  );

  const [target, setTarget] = useState(onlineVms[0]?.target || "gpu0");
  const [pipeline, setPipeline] = useState<WorkflowPipelineKind>("sdxl_txt2img");
  const [baseModel, setBaseModel] = useState("waiNSFWIllustrious_v110.safetensors");
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

  const [compiled, setCompiled] = useState<CompiledWorkflowResult | null>(null);
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
  const selectedVmOnline = onlineVms.some((v) => v.target === target);
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
    if (pipeline === "flux_gguf") return m.category === "unet" || m.compatibleBase.includes("Flux");
    if (pipeline === "qwen_edit") return m.category === "diffusion_models" || m.compatibleBase.includes("Qwen");
    if (pipeline.startsWith("audio_")) return m.modality === "AUDIO" || m.category === "checkpoints";
    if (pipeline.startsWith("video_")) return m.modality === "VIDEO";
    return m.category === "checkpoints";
  });

  const vaeCandidates = models.filter((m) => m.category === "vae");
  const loraCandidates = models.filter((m) => m.category === "loras");
  const upscalerCandidates = models.filter((m) => m.category === "upscale_models");

  function buildSpec(): WorkflowBuildSpec {
    return {
      pipeline,
      baseModel: baseModel || undefined,
      vaeModel: vaeModel || undefined,
      loras: lora1 ? [{ filename: lora1, strength: lora1Strength }] : [],
      upscalerModel: upscalerModel || undefined,
      enableFaceDetailer,
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
      <div className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/15 text-emerald-300">
            <HardDrive className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white">
              Smart Workflow Creator (VM /tmp + 5 TB Drive + HF/Civitai)
            </div>
            <p className="text-[11px] text-zinc-400">
              Select any model directly with 1 click. Scan your Drive to discover &amp; AI-review unrecognized files before adding them to your selector.
            </p>
          </div>
        </div>

        <Button
          type="button"
          onClick={handleScanDriveWithAi}
          disabled={scanningDrive}
          className="bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          {scanningDrive ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-3.5 w-3.5" />
          )}
          Scan 5 TB Drive &amp; AI Review
        </Button>
      </div>

      {/* Main Builder + Live Resource Inspector */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="glass-panel space-y-4 rounded-2xl p-5 lg:col-span-7">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Pipeline Architecture</Label>
              <select
                value={pipeline}
                onChange={(e) => setPipeline(e.target.value as WorkflowPipelineKind)}
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
              <Label className="text-[11px]">Target GPU Slot</Label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="glass-input w-full rounded-xl px-3 py-2 font-mono text-xs text-zinc-100"
              >
                {(vms.length ? vms : [{ target: "gpu0", status: "OFFLINE", workerProfile: "BASE_COMFY" }]).map(
                  (v) => (
                    <option key={v.target} value={v.target} className="bg-zinc-900">
                      {v.target.toUpperCase()} · {v.status} ({v.workerProfile})
                    </option>
                  )
                )}
              </select>
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

          {(pipeline === "sdxl_txt2img" || pipeline === "sdxl_detailer_upscale") && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[11px]">Optional LoRA (Style / Character)</Label>
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

          {(pipeline === "sdxl_txt2img" || pipeline === "sdxl_detailer_upscale") && (
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

              {pipeline === "sdxl_detailer_upscale" && (
                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs">
                  <span>Enable FaceDetailer (YOLO+SAM)</span>
                  <input
                    type="checkbox"
                    checked={enableFaceDetailer}
                    onChange={(e) => setEnableFaceDetailer(e.target.checked)}
                    className="h-4 w-4"
                  />
                </label>
              )}
            </div>
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
              className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              {busyAction === "compile_and_run" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              Ensure &amp; Run on {target.toUpperCase()}
            </Button>
          </div>
        </div>

        {/* Right: Resource Preflight Inspector + Save Template */}
        <div className="glass-panel flex flex-col justify-between space-y-4 rounded-2xl p-5 lg:col-span-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Cpu className="h-4 w-4 text-cyan-400" />
                <span>T4 16 GB Resource Inspector</span>
              </div>
              {compiled && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    compiled.vramStatus === "OVER_T4_LIMIT"
                      ? "bg-rose-500/20 text-rose-300"
                      : compiled.vramStatus === "TIGHT"
                      ? "bg-amber-500/20 text-amber-200"
                      : "bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  {compiled.vramEstimateGb} / 16.0 GB · {compiled.vramStatus}
                </span>
              )}
            </div>

            {!compiled ? (
              <p className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-zinc-400">
                Click <strong>Compile &amp; Check T4 VRAM</strong> to inspect exact required models, T4 safety guardrails, node dependencies, and ComfyUI JSON.
              </p>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="mb-1 text-[10px] font-semibold uppercase text-zinc-400">
                    Required Models ({compiled.requiredModels.length}) · Profile: {compiled.recommendedProfile}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {compiled.requiredModels.map((rm) => (
                      <span
                        key={`${rm.category}/${rm.filename}`}
                        className="rounded bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-zinc-200"
                      >
                        {rm.category}/{rm.filename}
                      </span>
                    ))}
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

                <pre className="max-h-48 overflow-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-[10px] text-zinc-300">
                  {JSON.stringify(compiled.graph, null, 2)}
                </pre>
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

