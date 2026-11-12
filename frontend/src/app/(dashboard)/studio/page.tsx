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
import { useClusterStore } from "@/store/cluster-store";
import { formatBytes } from "@/lib/format";
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

export default function StudioPage() {
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

    try {
      const res = await fetch("/api/workflow/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to queue workflow");
        updateStudio({ submitting: false });
        return;
      }

      updateStudio({
        pollingJobId: data.jobId,
        pollingTarget: target,
      });
      toast.info(`Dispatched to ${target.toUpperCase()}. Live progress tracked across all tabs.`);
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
    <div className="space-y-5">
      {/* Studio Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">ComfyUI Prompt Studio</h1>
          <p className="text-xs text-zinc-400">
            Select a preset, push or export LiteGraph workflows, stream models with live Rclone telemetry, and auto-save renders to Drive.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => updateStudio({ customJsonMode: !studio.customJsonMode })}
            className={`border-zinc-800 text-xs ${
              studio.customJsonMode
                ? "border-indigo-500/40 bg-indigo-600/20 text-indigo-300"
                : "bg-zinc-900 text-zinc-300"
            }`}
          >
            <Code2 className="mr-1.5 h-3.5 w-3.5" />
            {studio.customJsonMode ? "Preset Form" : "Custom API JSON"}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportWorkflowJson}
            disabled={exportingJson}
            className="border-zinc-800 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            <FileJson className="mr-1.5 h-3.5 w-3.5 text-amber-400" />
            Export .json
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePushPresetToWebUi}
            disabled={pushingPreset || !isTargetOnline}
            className="border-zinc-800 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            {pushingPreset ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <UploadCloud className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
            )}
            Load on GPU WebUI
          </Button>

          <a
            href={isTargetOnline ? `/api/vm/${target}/webui` : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!isTargetOnline}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition ${
              isTargetOnline
                ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40"
                : "pointer-events-none border-zinc-800 bg-zinc-900/50 text-zinc-600"
            }`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open ComfyUI
          </a>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLogsOpen(true)}
            className="border-zinc-800 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <Terminal className="mr-1.5 h-3.5 w-3.5" />
            Logs
          </Button>
        </div>
      </div>

      {/* ONLINE GPU QUICK PILL BAR + LOADED MODELS SUMMARY */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800/90 bg-zinc-950 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Active GPU:
          </span>
          {vms.map((v) => {
            const active = v.target === target;
            const online = v.status === "ONLINE";
            return (
              <button
                key={v.target}
                type="button"
                onClick={() => setSelectedTarget(v.target, true)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] transition ${
                  active
                    ? "border-indigo-500 bg-indigo-600/20 text-white"
                    : online
                    ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40"
                    : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    online ? "bg-emerald-400" : v.status === "STARTING" ? "bg-amber-400" : "bg-zinc-600"
                  }`}
                />
                {v.target.toUpperCase()}
              </button>
            );
          })}
        </div>

        {isTargetOnline && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
            <span>
              /tmp models:{" "}
              <strong className="text-zinc-200">{storedFiles.length} file(s)</strong>
              {storedFiles.length > 0 &&
                ` (${formatBytes(storedFiles.reduce((a, b) => a + b.sizeBytes, 0))})`}
            </span>
            {storageData?.disk && (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                Free: {storageData.disk.freeGb} GB
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                refetchCatalog();
                refetchStorage();
              }}
              className="text-indigo-400 hover:text-indigo-300"
            >
              <RefreshCw
                className={`h-3 w-3 ${loadingCatalog || loadingStorage ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        )}
      </div>

      {/* WORKFLOW PRESETS BAR */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <Wand2 className="h-3.5 w-3.5 text-indigo-400" />
          One-Click Workflow Presets
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {WORKFLOW_PRESETS.map((preset) => {
            const selected = !studio.customJsonMode && studio.activePresetId === preset.id;
            const loadedOnVm = checkpoints.includes(preset.recommendedCheckpoint);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`flex flex-col justify-between rounded-xl border p-3 text-left transition ${
                  selected
                    ? "border-indigo-500 bg-indigo-950/30 shadow-lg shadow-indigo-500/10"
                    : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                }`}
              >
                <div>
                  <div className="text-xs font-bold text-white">{preset.name}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-indigo-400">
                    {preset.badge}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[11px] text-zinc-400">
                    {preset.description}
                  </p>
                </div>
                <div className="mt-2 flex items-center justify-between gap-1 text-[10px]">
                  <span className="truncate font-mono text-zinc-500">
                    {preset.recommendedCheckpoint}
                  </span>
                  {loadedOnVm && (
                    <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 font-mono text-[9px] text-emerald-300">
                      READY
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Form Controls */}
        <form
          onSubmit={handleRun}
          className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 lg:col-span-5"
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
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3 font-mono text-[11px] text-zinc-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          ) : (
            <>
              {/* Checkpoint Selector */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Checkpoint Model ({checkpoints.length} loaded)</Label>
                  <button
                    type="button"
                    onClick={() => {
                      refetchCatalog();
                      refetchStorage();
                    }}
                    className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingCatalog ? "animate-spin" : ""}`} />
                    Refresh Catalog
                  </button>
                </div>
                <select
                  value={checkpoint}
                  onChange={(e) => updateStudio({ selectedCheckpoint: e.target.value })}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                >
                  {checkpoints.length === 0 ? (
                    <option value="">
                      {isTargetOnline
                        ? "Auto / No Checkpoints on VM yet"
                        : `${target.toUpperCase()} is offline — pick an ONLINE GPU`}
                    </option>
                  ) : (
                    checkpoints.map((ckpt) => (
                      <option key={ckpt} value={ckpt}>
                        {ckpt}
                      </option>
                    ))
                  )}
                </select>

                {/* Inline Stream Button or Live Rclone Progress Bar */}
                {isTargetStreamingThisModel && activeStream ? (
                  <div className="mt-1.5 space-y-1.5 rounded-lg border border-indigo-500/40 bg-indigo-950/30 p-2.5 text-[11px]">
                    <div className="flex items-center justify-between font-mono text-indigo-200">
                      <span>{activeStream.completed ? "Model Loaded!" : "Streaming via Rclone"}</span>
                      <span>
                        {activeStream.percentage}% · {activeStream.speedText}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full transition-all duration-300 ${
                          activeStream.completed ? "bg-emerald-500" : "bg-indigo-500"
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
                      className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-950/30 px-2.5 py-1.5 text-[11px] text-indigo-300 hover:bg-indigo-950/50"
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

              {/* Optional LoRA Picker */}
              {loras.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[11px]">LoRA Overlay (Optional)</Label>
                    <select
                      value={studio.selectedLora}
                      onChange={(e) => updateStudio({ selectedLora: e.target.value })}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100"
                    >
                      <option value="">None</option>
                      {loras.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">LoRA Weight</Label>
                    <Input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1.5"
                      value={studio.loraStrength}
                      onChange={(e) => updateStudio({ loraStrength: Number(e.target.value) })}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Positive Prompt</Label>
                <textarea
                  rows={4}
                  value={studio.prompt}
                  onChange={(e) => updateStudio({ prompt: e.target.value })}
                  required
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Negative Prompt</Label>
                <textarea
                  rows={2}
                  value={studio.negativePrompt}
                  onChange={(e) => updateStudio({ negativePrompt: e.target.value })}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Aspect Ratio Quick Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
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
                          ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                          : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {ar.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-[11px]">Width</Label>
                  <Input
                    type="number"
                    value={studio.width}
                    onChange={(e) => updateStudio({ width: Number(e.target.value) })}
                    step={64}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Height</Label>
                  <Input
                    type="number"
                    value={studio.height}
                    onChange={(e) => updateStudio({ height: Number(e.target.value) })}
                    step={64}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Steps</Label>
                  <Input
                    type="number"
                    value={studio.steps}
                    onChange={(e) => updateStudio({ steps: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">CFG</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={studio.cfg}
                    onChange={(e) => updateStudio({ cfg: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-[11px]">Sampler</Label>
                  <select
                    value={studio.samplerName}
                    onChange={(e) => updateStudio({ samplerName: e.target.value })}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100"
                  >
                    {SAMPLERS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px]">Scheduler</Label>
                  <select
                    value={studio.scheduler}
                    onChange={(e) => updateStudio({ scheduler: e.target.value })}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100"
                  >
                    {SCHEDULERS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px]">Batch (1–4)</Label>
                  <select
                    value={studio.batchSize}
                    onChange={(e) => updateStudio({ batchSize: Number(e.target.value) })}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100"
                  >
                    {[1, 2, 3, 4].map((b) => (
                      <option key={b} value={b}>
                        {b}×
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px]">Seed</Label>
                    <button
                      type="button"
                      onClick={() =>
                        updateStudio({
                          seed: String(Math.floor(100_000 + Math.random() * 999_000_000)),
                        })
                      }
                      title="Generate fixed seed"
                      className="text-zinc-400 hover:text-indigo-300"
                    >
                      <Shuffle className="h-3 w-3" />
                    </button>
                  </div>
                  <Input
                    type="text"
                    placeholder="Random"
                    value={studio.seed}
                    onChange={(e) => updateStudio({ seed: e.target.value })}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={studio.hiresPass}
                  onChange={(e) => updateStudio({ hiresPass: e.target.checked })}
                  className="rounded border-zinc-700 bg-zinc-900"
                />
                Enable 2-Pass Latent Hires Upscale (2× resolution refinement)
              </label>
            </>
          )}

          <Button
            type="submit"
            disabled={studio.submitting || !isTargetOnline}
            className="w-full bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {studio.submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {studio.pollingJobId
                  ? `Rendering on ${(studio.pollingTarget || target).toUpperCase()} (${
                      studio.queueElapsedMs ? `${(studio.queueElapsedMs / 1000).toFixed(0)}s` : "..."
                    })...`
                  : "Dispatching..."}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate &amp; Auto-Save to Drive
              </>
            )}
          </Button>
        </form>

        {/* Render Canvas */}
        <div className="flex flex-col justify-between rounded-2xl border border-zinc-800 bg-zinc-950 p-5 lg:col-span-7">
          <div className="mb-3 flex items-center justify-between text-xs text-zinc-400">
            <span className="font-semibold text-zinc-200">Render Canvas</span>
            <div className="flex items-center gap-3">
              {studio.submitting && studio.queueElapsedMs != null && (
                <span className="font-mono text-indigo-400">
                  Elapsed {(studio.queueElapsedMs / 1000).toFixed(0)}s
                  {studio.queuePending > 0 ? ` · Queue ${studio.queuePending}` : ""}
                </span>
              )}
              {studio.durationMs != null && (
                <span className="font-mono text-emerald-400">
                  Completed in {(studio.durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </div>

          <div className="flex min-h-[460px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
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
                        className="max-h-[430px] rounded-lg object-contain shadow-2xl"
                      />
                    )}
                    <div className="flex items-center gap-3 text-xs text-zinc-400">
                      <span className="max-w-[240px] truncate font-mono">{out.gdrivePath}</span>
                      {out.previewUrl && (
                        <a
                          href={out.previewUrl}
                          download={out.filename}
                          className="flex items-center gap-1 text-indigo-400 hover:underline"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : studio.submitting ? (
              <div className="flex flex-col items-center gap-3 text-xs text-zinc-400">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                <span>
                  Executing workflow on {(studio.pollingTarget || target).toUpperCase()} &amp; syncing to Google Drive...
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-xs text-zinc-500">
                <ImageIcon className="h-10 w-10 text-zinc-700" />
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
