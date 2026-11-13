"use client";

import React, { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Sparkles,
  RefreshCw,
  Loader2,
  Image as ImageIcon,
  Download,
  Wand2,
  UploadCloud,
  Code2,
  HardDriveDownload,
  ExternalLink,
  Terminal,
  FileJson,
  HardDrive,
  Shuffle,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { VmStoredModelItem } from "@/lib/orchestrator/rclone-client";
import { WORKFLOW_PRESETS, type WorkflowPreset } from "@/lib/orchestrator/workflow-presets";
import { isLlmWorkerProfile } from "@/lib/catalog/worker-profiles";
import { useClusterStore } from "@/store/cluster-store";
import { VmLogsDialog } from "@/components/gpu/VmLogsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const SAMPLERS = ["euler_ancestral", "euler", "dpmpp_2m", "dpmpp_sde", "dpmpp_2m_sde", "uni_pc"];
const SCHEDULERS = ["normal", "karras", "exponential", "sgm_uniform", "simple"];
const ASPECT_RATIOS = [
  { label: "1:1", width: 1024, height: 1024 },
  { label: "16:9", width: 1344, height: 768 },
  { label: "9:16", width: 768, height: 1344 },
  { label: "4:3", width: 1152, height: 896 },
];

export function StudioWorkspace() {
  const target = useClusterStore((s) => s.selectedTarget);
  const setSelectedTarget = useClusterStore((s) => s.setSelectedTarget);
  const activeStream = useClusterStore((s) => s.activeStream);
  const startStream = useClusterStore((s) => s.startStream);

  const studio = useClusterStore((s) => s.studio);
  const updateStudio = useClusterStore((s) => s.updateStudio);
  const applyStudioPreset = useClusterStore((s) => s.applyStudioPreset);

  const [pushingPreset, setPushingPreset] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);
  const [startingStream, setStartingStream] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [multiGpuMode, setMultiGpuMode] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);

  const { data: vmData } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 4000,
  });

  const vms = vmData?.vms ?? [];
  const activeVm = vms.find((v) => v.target === target);
  const isTargetOnline = activeVm?.status === "ONLINE";

  const {
    data: catalogData,
    isFetching: loadingCatalog,
    refetch: refetchCatalog,
  } = useQuery<{ models?: { checkpoints?: string[]; loras?: string[] } }>({
    queryKey: ["vm-catalog", target],
    enabled: Boolean(isTargetOnline),
    queryFn: async () => {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/catalog`);
      if (!res.ok) return { models: { checkpoints: [], loras: [] } };
      return res.json();
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });

  const {
    data: storageData,
    isFetching: loadingStorage,
    refetch: refetchStorage,
  } = useQuery<{
    disk: { totalGb: number; usedGb: number; freeGb: number } | null;
    files: VmStoredModelItem[];
  }>({
    queryKey: ["vm-storage", target],
    enabled: Boolean(isTargetOnline),
    queryFn: async () => {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/storage`);
      if (!res.ok) return { disk: null, files: [] };
      return res.json();
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });

  const checkpoints = catalogData?.models?.checkpoints ?? [];
  const loras = catalogData?.models?.loras ?? [];
  const storedFiles = storageData?.files ?? [];

  const checkpoint =
    studio.selectedCheckpoint && checkpoints.includes(studio.selectedCheckpoint)
      ? studio.selectedCheckpoint
      : checkpoints[0] ?? "";

  function handleSelectPreset(preset: WorkflowPreset) {
    applyStudioPreset(preset, checkpoints);
    toast.success(`Loaded preset: ${preset.name}`);
  }

  function buildPayload() {
    let customWorkflowJson: Record<string, unknown> | undefined;
    if (studio.customJsonMode) {
      customWorkflowJson = JSON.parse(studio.customJsonText) as Record<string, unknown>;
    }
    return {
      target,
      presetId: studio.customJsonMode ? undefined : studio.activePresetId,
      checkpoint: checkpoint || undefined,
      loraName: studio.selectedLora || undefined,
      loraStrength: studio.loraStrength,
      prompt: studio.prompt,
      negativePrompt: studio.negativePrompt,
      width: studio.width,
      height: studio.height,
      steps: studio.steps,
      cfg: studio.cfg,
      samplerName: studio.samplerName,
      scheduler: studio.scheduler,
      hiresPass: studio.hiresPass,
      batchSize: studio.batchSize,
      seed: studio.seed ? Number(studio.seed) : undefined,
      customWorkflowJson,
    };
  }

  async function handlePushPresetToWebUi() {
    setPushingPreset(true);
    try {
      let payload;
      try {
        payload = buildPayload();
      } catch {
        toast.error("Invalid custom ComfyUI API JSON");
        return;
      }

      const res = await fetch("/api/workflow/push-preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, mode: "push" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to push workflow to GPU");
        return;
      }
      toast.success(
        `Saved ${data.savedPath} onto ${target.toUpperCase()} (${data.method}). Click "Open ComfyUI" to open it.`
      );
    } finally {
      setPushingPreset(false);
    }
  }

  async function handleExportWorkflowJson() {
    setExportingJson(true);
    try {
      let payload;
      try {
        payload = buildPayload();
      } catch {
        toast.error("Invalid custom ComfyUI API JSON");
        return;
      }

      const res = await fetch("/api/workflow/push-preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, mode: "export" }),
      });
      const data = await res.json();
      if (!res.ok || !data.workflowUiJson) {
        toast.error(data.error || "Failed to generate workflow JSON");
        return;
      }

      const blob = new Blob([JSON.stringify(data.workflowUiJson, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename || "scriptoria-workflow.json";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.filename} — drop directly into ComfyUI WebUI.`);
    } finally {
      setExportingJson(false);
    }
  }

  async function handleStreamRecommendedCheckpoint() {
    const activePreset = WORKFLOW_PRESETS.find((p) => p.id === studio.activePresetId);
    if (!activePreset) return;
    setStartingStream(true);
    try {
      const res = await fetch("/api/models/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          category: "checkpoints",
          name: activePreset.recommendedCheckpoint,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to stream recommended checkpoint");
        return;
      }

      if (body.status === "skipped") {
        toast.success(
          `${activePreset.recommendedCheckpoint} is already cached on ${target.toUpperCase()} — refreshing catalog...`
        );
        refetchCatalog();
        refetchStorage();
        return;
      }

      toast.success(
        body.status === "already_transferring"
          ? `Attached to active download: ${activePreset.recommendedCheckpoint}`
          : `Streaming ${activePreset.recommendedCheckpoint} ➔ ${target.toUpperCase()} via Rclone`
      );
      startStream({
        target,
        jobId: body.jobid ?? null,
        modelName: activePreset.recommendedCheckpoint,
        category: "checkpoints",
      });
    } finally {
      setStartingStream(false);
    }
  }

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    let payload;
    try {
      payload = buildPayload();
    } catch {
      toast.error("Invalid custom ComfyUI API JSON");
      return;
    }

    updateStudio({
      submitting: true,
      outputs: [],
      durationMs: null,
      queueElapsedMs: 0,
      queuePending: 0,
    });

    const activeTargets =
      multiGpuMode && selectedTargets.length > 0 ? selectedTargets : [target];

    try {
      const baseSeed = studio.seed ? Number(studio.seed) : Math.floor(Math.random() * 10000000);
      const dispatches = activeTargets.map((tgt, idx) => {
        const payloadForTarget = {
          ...payload,
          target: tgt,
          seed: baseSeed + idx,
        };
        return fetch("/api/workflow/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadForTarget),
        }).then(async (r) => {
          const body = await r.json();
          return { ok: r.ok, body, target: tgt };
        });
      });

      const results = await Promise.all(dispatches);
      const successful = results.filter((r) => r.ok && r.body.jobId);
      if (successful.length > 0) {
        updateStudio({
          pollingJobId: successful[0].body.jobId,
          pollingTarget: successful[0].target,
        });
        toast.success(
          successful.length > 1
            ? `Concurrently queued on ${successful.length} GPUs (${successful.map((s) => s.target.toUpperCase()).join(", ")})!`
            : `Dispatched to ${target.toUpperCase()}. Live progress tracked across all tabs.`
        );
      } else {
        toast.error("Failed to queue workflow on target GPU(s)");
        updateStudio({ submitting: false });
      }
    } catch {
      toast.error("Network error dispatching prompt");
      updateStudio({ submitting: false });
    }
  }

  const activePreset = WORKFLOW_PRESETS.find((p) => p.id === studio.activePresetId);
  const recommendedMissing =
    isTargetOnline &&
    activePreset &&
    !checkpoints.includes(activePreset.recommendedCheckpoint);

  const isTargetStreamingThisModel =
    activeStream?.active &&
    activeStream.target === target &&
    activeStream.modelName === activePreset?.recommendedCheckpoint;

  return (
    <div className="space-y-4">
      {/* Prompt Studio Header & Quick Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-[#111114] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 pr-2">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            <h2 className="text-sm font-bold tracking-tight text-white">Prompt Studio</h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const nextMode = !multiGpuMode;
                setMultiGpuMode(nextMode);
                if (nextMode) {
                  const onlines = vms
                    .filter((v) => v.status === "ONLINE" && !isLlmWorkerProfile(v.workerProfile))
                    .map((v) => v.target);
                  setSelectedTargets(onlines.length > 0 ? onlines : [target]);
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] transition whitespace-nowrap ${
                multiGpuMode
                  ? "border-amber-400/50 bg-amber-500/20 text-amber-200 shadow-sm shadow-amber-500/20 font-semibold"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
              }`}
            >
              <Shuffle className="h-3 w-3 text-amber-400" />
              Fan-Out {multiGpuMode && selectedTargets.length > 0 ? `(${selectedTargets.length})` : ""}
            </button>

            {vms.map((v) => {
              const isSelected = multiGpuMode
                ? selectedTargets.includes(v.target)
                : v.target === target;
              const online = v.status === "ONLINE";
              const isLlm = isLlmWorkerProfile(v.workerProfile);
              return (
                <button
                  key={v.target}
                  type="button"
                  onClick={() => {
                    if (multiGpuMode) {
                      if (selectedTargets.includes(v.target)) {
                        setSelectedTargets((prev) => prev.filter((t) => t !== v.target));
                      } else {
                        setSelectedTargets((prev) => [...prev, v.target]);
                      }
                    } else {
                      setSelectedTarget(v.target, true);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] transition whitespace-nowrap ${
                    isSelected
                      ? multiGpuMode
                        ? "border-amber-400/50 bg-amber-500/25 text-amber-100 shadow-sm shadow-amber-500/20 font-semibold"
                        : "border-indigo-400/50 bg-indigo-500/25 text-white shadow-sm shadow-indigo-500/20"
                      : online
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                      : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white"
                  } ${isLlm ? "opacity-60" : ""}`}
                  title={isLlm ? "LLM Profile Slot" : undefined}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      online
                        ? isLlm
                          ? "bg-cyan-400"
                          : "bg-emerald-400"
                        : v.status === "STARTING"
                        ? "bg-amber-400"
                        : "bg-zinc-600"
                    }`}
                  />
                  {v.target.toUpperCase()}
                  {multiGpuMode && isSelected ? " ✓" : ""}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isTargetOnline && (
            <div className="glass-pill hidden items-center gap-2 rounded-lg px-2.5 py-1 text-[11px] text-zinc-300 md:flex">
              <HardDrive className="h-3 w-3 text-emerald-400" />
              <span>{storedFiles.length} models</span>
              {storageData?.disk && <span className="font-mono text-zinc-400">· {storageData.disk.freeGb}GB free</span>}
              <button
                type="button"
                onClick={() => {
                  refetchCatalog();
                  refetchStorage();
                }}
                className="text-indigo-300 hover:text-white"
              >
                <RefreshCw className={`h-3 w-3 ${loadingCatalog || loadingStorage ? "animate-spin" : ""}`} />
              </button>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => updateStudio({ customJsonMode: !studio.customJsonMode })}
            className={`h-7 border-white/15 bg-white/[0.04] text-[11px] backdrop-blur-md hover:bg-white/10 ${
              studio.customJsonMode ? "border-indigo-400/50 text-indigo-300" : "text-zinc-200"
            }`}
          >
            <Code2 className="mr-1 h-3 w-3" />
            {studio.customJsonMode ? "Form" : "API JSON"}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportWorkflowJson}
            disabled={exportingJson}
            className="h-7 border-white/15 bg-white/[0.04] text-[11px] text-zinc-200 backdrop-blur-md hover:bg-white/10"
          >
            <FileJson className="mr-1 h-3 w-3 text-amber-300" />
            Export .json
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePushPresetToWebUi}
            disabled={pushingPreset || !isTargetOnline}
            className="h-7 border-white/15 bg-white/[0.04] text-[11px] text-zinc-200 backdrop-blur-md hover:bg-white/10"
          >
            {pushingPreset ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <UploadCloud className="mr-1 h-3 w-3 text-emerald-300" />
            )}
            Load WebUI
          </Button>

          <a
            href={isTargetOnline ? `/api/vm/${target}/webui` : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!isTargetOnline}
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium transition backdrop-blur-md ${
              isTargetOnline
                ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                : "pointer-events-none border-white/10 bg-white/[0.02] text-zinc-600"
            }`}
          >
            <ExternalLink className="h-3 w-3" />
            ComfyUI
          </a>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLogsOpen(true)}
            className="h-7 border-white/15 bg-white/[0.04] text-[11px] text-zinc-300 backdrop-blur-md hover:bg-white/10"
          >
            <Terminal className="mr-1 h-3 w-3" />
            Logs
          </Button>
        </div>
      </div>

      {/* ONE-CLICK WORKFLOW PRESETS */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {WORKFLOW_PRESETS.map((preset) => {
          const selected = !studio.customJsonMode && studio.activePresetId === preset.id;
          const loadedOnVm = checkpoints.includes(preset.recommendedCheckpoint);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleSelectPreset(preset)}
              className={`glass-card flex flex-col justify-between rounded-xl p-3 text-left transition ${
                selected
                  ? "border-indigo-400/60 bg-indigo-500/15 shadow-lg shadow-indigo-500/15"
                  : "hover:border-white/25 hover:bg-white/[0.06]"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-1">
                  <div className="truncate text-xs font-bold text-white">{preset.name}</div>
                  {loadedOnVm && (
                    <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-300">
                      READY
                    </span>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-cyan-300">{preset.badge}</div>
              </div>
              <div className="mt-2 flex items-center gap-1 truncate font-mono text-[10px] text-zinc-400">
                <Wand2 className="h-3 w-3 shrink-0 text-indigo-300" />
                <span className="truncate">{preset.recommendedCheckpoint}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* MAIN FORM + RENDER CANVAS */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <form
          onSubmit={handleRun}
          className="space-y-3 rounded-lg border border-zinc-800 bg-[#111114] p-4 lg:col-span-5"
        >
          {studio.customJsonMode ? (
            <div className="space-y-2">
              <Label>ComfyUI API Workflow JSON (Save API Format)</Label>
              <textarea
                rows={15}
                required
                value={studio.customJsonText}
                onChange={(e) => updateStudio({ customJsonText: e.target.value })}
                placeholder='{"1": {"class_type": "CheckpointLoaderSimple", "inputs": {...}}}'
                className="glass-input w-full rounded-xl p-3 font-mono text-[11px] text-zinc-100 focus:border-indigo-400 focus:outline-none"
              />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-300">
                    Checkpoint ({checkpoints.length} ready)
                  </Label>
                  <button
                    type="button"
                    onClick={() => {
                      refetchCatalog();
                      refetchStorage();
                    }}
                    className="flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200"
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingCatalog ? "animate-spin" : ""}`} />
                    Sync Models
                  </button>
                </div>
                <select
                  value={checkpoint}
                  onChange={(e) => updateStudio({ selectedCheckpoint: e.target.value })}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100 focus:border-indigo-400 focus:outline-none"
                >
                  {checkpoints.length === 0 ? (
                    <option value="" className="bg-zinc-900">
                      {isTargetOnline
                        ? "Auto / No Checkpoints on VM yet"
                        : `${target.toUpperCase()} offline — pick or boot a GPU`}
                    </option>
                  ) : (
                    checkpoints.map((ckpt) => (
                      <option key={ckpt} value={ckpt} className="bg-zinc-900">
                        {ckpt}
                      </option>
                    ))
                  )}
                </select>

                {isTargetStreamingThisModel && activeStream ? (
                  <div className="glass-card mt-1.5 space-y-1.5 rounded-xl border-indigo-400/40 bg-indigo-500/15 p-2.5 text-[11px]">
                    <div className="flex items-center justify-between font-mono text-indigo-200">
                      <span>{activeStream.completed ? "Model Loaded!" : "Streaming via Rclone"}</span>
                      <span>
                        {activeStream.percentage}% · {activeStream.speedText}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full transition-all duration-300 ${
                          activeStream.completed ? "bg-emerald-400" : "bg-indigo-400"
                        }`}
                        style={{ width: `${activeStream.percentage}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  recommendedMissing &&
                  activePreset && (
                    <button
                      type="button"
                      onClick={handleStreamRecommendedCheckpoint}
                      disabled={startingStream}
                      className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-indigo-400/35 bg-indigo-500/15 px-2.5 py-1.5 text-[11px] font-medium text-indigo-200 transition hover:bg-indigo-500/25"
                    >
                      {startingStream ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <HardDriveDownload className="h-3 w-3" />
                      )}
                      Stream {activePreset.recommendedCheckpoint} to {target.toUpperCase()}
                    </button>
                  )
                )}
              </div>

              {loras.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[11px] text-zinc-300">LoRA Overlay</Label>
                    <select
                      value={studio.selectedLora}
                      onChange={(e) => updateStudio({ selectedLora: e.target.value })}
                      className="glass-input w-full rounded-xl px-2.5 py-2 text-xs text-zinc-100"
                    >
                      <option value="" className="bg-zinc-900">None</option>
                      {loras.map((l) => (
                        <option key={l} value={l} className="bg-zinc-900">
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-zinc-300">Weight</Label>
                    <Input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1.5"
                      value={studio.loraStrength}
                      onChange={(e) => updateStudio({ loraStrength: Number(e.target.value) })}
                      className="glass-input border-white/10"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs text-zinc-300">Positive Prompt</Label>
                <textarea
                  rows={3}
                  value={studio.prompt}
                  onChange={(e) => updateStudio({ prompt: e.target.value })}
                  required
                  className="glass-input w-full rounded-xl p-2.5 text-xs text-zinc-100 focus:border-indigo-400 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-zinc-300">Negative Prompt</Label>
                <textarea
                  rows={2}
                  value={studio.negativePrompt}
                  onChange={(e) => updateStudio({ negativePrompt: e.target.value })}
                  className="glass-input w-full rounded-xl p-2.5 text-xs text-zinc-100 focus:border-indigo-400 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Aspect:
                </span>
                {ASPECT_RATIOS.map((ar) => {
                  const selected = studio.width === ar.width && studio.height === ar.height;
                  return (
                    <button
                      key={ar.label}
                      type="button"
                      onClick={() => updateStudio({ width: ar.width, height: ar.height })}
                      className={`rounded-md border px-2 py-0.5 font-mono text-[10px] transition ${
                        selected
                          ? "border-indigo-400/60 bg-indigo-500/20 text-indigo-200"
                          : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white"
                      }`}
                    >
                      {ar.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Width</Label>
                  <Input
                    type="number"
                    value={studio.width}
                    onChange={(e) => updateStudio({ width: Number(e.target.value) })}
                    step={64}
                    className="glass-input h-8 border-white/10 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Height</Label>
                  <Input
                    type="number"
                    value={studio.height}
                    onChange={(e) => updateStudio({ height: Number(e.target.value) })}
                    step={64}
                    className="glass-input h-8 border-white/10 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Steps</Label>
                  <Input
                    type="number"
                    value={studio.steps}
                    onChange={(e) => updateStudio({ steps: Number(e.target.value) })}
                    className="glass-input h-8 border-white/10 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">CFG</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={studio.cfg}
                    onChange={(e) => updateStudio({ cfg: Number(e.target.value) })}
                    className="glass-input h-8 border-white/10 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Sampler</Label>
                  <select
                    value={studio.samplerName}
                    onChange={(e) => updateStudio({ samplerName: e.target.value })}
                    className="glass-input h-8 w-full rounded-lg px-2 text-xs text-zinc-100"
                  >
                    {SAMPLERS.map((s) => (
                      <option key={s} value={s} className="bg-zinc-900">
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Scheduler</Label>
                  <select
                    value={studio.scheduler}
                    onChange={(e) => updateStudio({ scheduler: e.target.value })}
                    className="glass-input h-8 w-full rounded-lg px-2 text-xs text-zinc-100"
                  >
                    {SCHEDULERS.map((s) => (
                      <option key={s} value={s} className="bg-zinc-900">
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-400">Batch</Label>
                  <select
                    value={studio.batchSize}
                    onChange={(e) => updateStudio({ batchSize: Number(e.target.value) })}
                    className="glass-input h-8 w-full rounded-lg px-2 text-xs text-zinc-100"
                  >
                    {[1, 2, 3, 4].map((b) => (
                      <option key={b} value={b} className="bg-zinc-900">
                        {b}×
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] text-zinc-400">Seed</Label>
                    <button
                      type="button"
                      onClick={() =>
                        updateStudio({
                          seed: String(Math.floor(100_000 + Math.random() * 999_000_000)),
                        })
                      }
                      title="Generate fixed seed"
                      className="text-zinc-400 hover:text-cyan-300"
                    >
                      <Shuffle className="h-3 w-3" />
                    </button>
                  </div>
                  <Input
                    type="text"
                    placeholder="Random"
                    value={studio.seed}
                    onChange={(e) => updateStudio({ seed: e.target.value })}
                    className="glass-input h-8 border-white/10 text-xs"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={studio.hiresPass}
                  onChange={(e) => updateStudio({ hiresPass: e.target.checked })}
                  className="rounded border-white/20 bg-white/10"
                />
                2-Pass Latent Hires Upscale (2×)
              </label>
            </>
          )}

          <Button
            type="submit"
            disabled={
              studio.submitting ||
              (!multiGpuMode && !isTargetOnline) ||
              (multiGpuMode && selectedTargets.length === 0)
            }
            className={`h-9 w-full text-xs font-medium text-white disabled:opacity-40 ${
              multiGpuMode && selectedTargets.length > 1
                ? "bg-amber-600 hover:bg-amber-500 shadow-md shadow-amber-500/20 font-semibold"
                : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            {studio.submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {multiGpuMode && selectedTargets.length > 1
                  ? `Rendering across ${selectedTargets.length} GPUs in parallel...`
                  : studio.pollingJobId
                  ? `Rendering on ${(studio.pollingTarget || target).toUpperCase()} (${
                      studio.queueElapsedMs ? `${(studio.queueElapsedMs / 1000).toFixed(0)}s` : "..."
                    })...`
                  : "Dispatching..."}
              </>
            ) : (
              <>
                {multiGpuMode && selectedTargets.length > 1 ? (
                  <Shuffle className="mr-2 h-4 w-4" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {multiGpuMode && selectedTargets.length > 1
                  ? `Dispatch Concurrently to ${selectedTargets.length} GPUs (${selectedTargets.map((t) => t.toUpperCase()).join(", ")})`
                  : isTargetOnline
                  ? `Generate on ${target.toUpperCase()} & Save to Drive`
                  : `Boot a GPU Above to Generate`}
              </>
            )}
          </Button>
        </form>

        {/* Render Canvas */}
        <div className="flex flex-col justify-between rounded-lg border border-zinc-800 bg-[#111114] p-4 lg:col-span-7">
          <div className="mb-3 flex items-center justify-between text-xs text-zinc-400">
            <span className="font-semibold text-zinc-100">Render Canvas</span>
            <div className="flex items-center gap-3">
              {studio.submitting && studio.queueElapsedMs != null && (
                <span className="font-mono text-cyan-300">
                  Elapsed {(studio.queueElapsedMs / 1000).toFixed(0)}s
                  {studio.queuePending > 0 ? ` · Queue ${studio.queuePending}` : ""}
                </span>
              )}
              {studio.durationMs != null && (
                <span className="font-mono text-emerald-300">
                  Completed in {(studio.durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </div>

          <div className="glass-card flex min-h-[430px] flex-1 items-center justify-center overflow-hidden rounded-xl bg-black/25 p-4">
            {studio.outputs.length > 0 ? (
              <div
                className={`grid w-full gap-4 ${
                  studio.outputs.length > 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
                }`}
              >
                {studio.outputs.map((out) => (
                  <div key={out.gdriveFileId || out.filename} className="flex flex-col items-center gap-2">
                    {out.previewUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={out.previewUrl}
                        alt={out.filename}
                        className="max-h-[410px] rounded-xl object-contain shadow-2xl"
                      />
                    )}
                    <div className="flex items-center gap-3 text-xs text-zinc-400">
                      <span className="max-w-[240px] truncate font-mono">{out.gdrivePath}</span>
                      {out.previewUrl && (
                        <a
                          href={out.previewUrl}
                          download={out.filename}
                          className="flex items-center gap-1 text-cyan-300 hover:underline"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : studio.submitting ? (
              <div className="flex flex-col items-center gap-3 text-xs text-zinc-300">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                <span>
                  Executing workflow on {(studio.pollingTarget || target).toUpperCase()} &amp; syncing to Google Drive...
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-xs text-zinc-500">
                <ImageIcon className="h-10 w-10 text-zinc-600" />
                <span>Generated outputs will appear here and persist in History.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <VmLogsDialog target={target} open={logsOpen} onOpenChange={setLogsOpen} />
    </div>
  );
}

