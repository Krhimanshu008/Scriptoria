"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { WORKFLOW_PRESETS, WorkflowPreset } from "@/lib/orchestrator/workflow-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface GeneratedOutput {
  filename: string;
  gdriveFileId: string;
  gdrivePath: string;
  previewUrl: string;
}

const SAMPLERS = ["euler_ancestral", "euler", "dpmpp_2m", "dpmpp_sde", "dpmpp_2m_sde", "uni_pc"];
const SCHEDULERS = ["normal", "karras", "exponential", "sgm_uniform", "simple"];

export default function StudioPage() {
  const [target, setTarget] = useState("gpu0");
  const [activePresetId, setActivePresetId] = useState<string>("sdxl-illustrious-hq");
  const [selectedCheckpoint, setSelectedCheckpoint] = useState("");

  const [prompt, setPrompt] = useState(WORKFLOW_PRESETS[0].defaultPrompt);
  const [negativePrompt, setNegativePrompt] = useState(WORKFLOW_PRESETS[0].defaultNegativePrompt);
  const [width, setWidth] = useState(WORKFLOW_PRESETS[0].width);
  const [height, setHeight] = useState(WORKFLOW_PRESETS[0].height);
  const [steps, setSteps] = useState(WORKFLOW_PRESETS[0].steps);
  const [cfg, setCfg] = useState(WORKFLOW_PRESETS[0].cfg);
  const [samplerName, setSamplerName] = useState(WORKFLOW_PRESETS[0].samplerName);
  const [scheduler, setScheduler] = useState(WORKFLOW_PRESETS[0].scheduler);
  const [hiresPass, setHiresPass] = useState(false);
  const [seed, setSeed] = useState("");

  const [customJsonMode, setCustomJsonMode] = useState(false);
  const [customJsonText, setCustomJsonText] = useState("");

  const [pushingPreset, setPushingPreset] = useState(false);
  const [streamingCkpt, setStreamingCkpt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<GeneratedOutput[]>([]);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: vmData } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const vms = vmData?.vms ?? [];

  const {
    data: catalogData,
    isFetching: loadingCatalog,
    refetch: refetchCatalog,
  } = useQuery<{ models?: { checkpoints?: string[] } }>({
    queryKey: ["vm-catalog", target],
    queryFn: async () => {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/catalog`);
      if (!res.ok) return { models: { checkpoints: [] } };
      return res.json();
    },
    retry: false,
  });

  const checkpoints = catalogData?.models?.checkpoints ?? [];
  const checkpoint =
    selectedCheckpoint && checkpoints.includes(selectedCheckpoint)
      ? selectedCheckpoint
      : checkpoints[0] ?? "";

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  function applyPreset(preset: WorkflowPreset) {
    setActivePresetId(preset.id);
    setCustomJsonMode(false);
    setPrompt(preset.defaultPrompt);
    setNegativePrompt(preset.defaultNegativePrompt);
    setWidth(preset.width);
    setHeight(preset.height);
    setSteps(preset.steps);
    setCfg(preset.cfg);
    setSamplerName(preset.samplerName);
    setScheduler(preset.scheduler);
    setHiresPass(Boolean(preset.hiresPass));
    if (checkpoints.includes(preset.recommendedCheckpoint)) {
      setSelectedCheckpoint(preset.recommendedCheckpoint);
    }
    toast.success(`Loaded preset: ${preset.name}`);
  }

  async function handlePushPresetToWebUi() {
    setPushingPreset(true);
    try {
      let customWorkflowJson: Record<string, unknown> | undefined;
      if (customJsonMode) {
        try {
          customWorkflowJson = JSON.parse(customJsonText);
        } catch {
          toast.error("Invalid custom ComfyUI API JSON");
          return;
        }
      }

      const res = await fetch("/api/workflow/push-preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          presetId: activePresetId,
          checkpoint: checkpoint || undefined,
          prompt,
          negativePrompt,
          width,
          height,
          steps,
          cfg,
          samplerName,
          scheduler,
          seed: seed ? Number(seed) : undefined,
          customWorkflowJson,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to push workflow to GPU");
        return;
      }
      toast.success(`Loaded ${data.savedPath} directly onto ${target.toUpperCase()} ComfyUI sidebar!`);
    } finally {
      setPushingPreset(false);
    }
  }

  async function handleStreamRecommendedCheckpoint() {
    const activePreset = WORKFLOW_PRESETS.find((p) => p.id === activePresetId);
    if (!activePreset) return;
    setStreamingCkpt(true);
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
      toast.success(
        `Streaming ${activePreset.recommendedCheckpoint} to ${target} (~15s via Rclone)...`
      );
      setTimeout(() => refetchCatalog(), 12000);
    } finally {
      setStreamingCkpt(false);
    }
  }

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    let customWorkflowJson: Record<string, unknown> | undefined;
    if (customJsonMode) {
      try {
        customWorkflowJson = JSON.parse(customJsonText);
      } catch {
        toast.error("Invalid custom ComfyUI API JSON");
        return;
      }
    }

    setSubmitting(true);
    setOutputs([]);
    setDurationMs(null);

    try {
      const res = await fetch("/api/workflow/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          presetId: customJsonMode ? undefined : activePresetId,
          prompt,
          negativePrompt,
          checkpoint: checkpoint || undefined,
          width,
          height,
          steps,
          cfg,
          samplerName,
          scheduler,
          hiresPass,
          seed: seed ? Number(seed) : undefined,
          customWorkflowJson,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to queue workflow");
        setSubmitting(false);
        return;
      }

      const jobId: string = data.jobId;
      setPollingJobId(jobId);
      toast.info(`Dispatched to ${target}. Waiting for GPU & Google Drive sync...`);

      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        try {
          const sRes = await fetch(`/api/workflow/${encodeURIComponent(jobId)}/status`);
          const sData = await sRes.json();
          if (sData.status === "COMPLETED") {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setOutputs(sData.outputs || []);
            setDurationMs(sData.executionTimeMs || null);
            setPollingJobId(null);
            setSubmitting(false);
            toast.success("Generation completed & saved permanently to Google Drive!");
          } else if (sData.status === "FAILED") {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setPollingJobId(null);
            setSubmitting(false);
            toast.error(sData.errorMessage || "Workflow failed on GPU");
          }
        } catch {
          // continue polling
        }
      }, 2000);
    } catch {
      toast.error("Network error dispatching prompt");
      setSubmitting(false);
    }
  }

  const activePreset = WORKFLOW_PRESETS.find((p) => p.id === activePresetId);
  const recommendedMissing =
    activePreset &&
    checkpoints.length >= 0 &&
    !checkpoints.includes(activePreset.recommendedCheckpoint);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">ComfyUI Prompt Studio</h1>
          <p className="text-xs text-zinc-400">
            Choose a workflow preset, push directly into a running GPU&apos;s ComfyUI WebUI, or render &amp; auto-save outputs to Google Drive.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCustomJsonMode((v) => !v)}
            className={`border-zinc-800 text-xs ${
              customJsonMode
                ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40"
                : "bg-zinc-900 text-zinc-300"
            }`}
          >
            <Code2 className="mr-1.5 h-3.5 w-3.5" />
            {customJsonMode ? "Preset Form Mode" : "Custom API JSON"}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePushPresetToWebUi}
            disabled={pushingPreset}
            className="border-zinc-800 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            {pushingPreset ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <UploadCloud className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
            )}
            Load Workflow on GPU WebUI
          </Button>
        </div>
      </div>

      {/* WORKFLOW PRESETS BAR */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <Wand2 className="h-3.5 w-3.5 text-indigo-400" />
          One-Click Workflow Presets
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {WORKFLOW_PRESETS.map((preset) => {
            const selected = !customJsonMode && activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
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
                <div className="mt-2 truncate font-mono text-[10px] text-zinc-500">
                  {preset.recommendedCheckpoint}
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
          <div className="space-y-1.5">
            <Label>Target GPU Slot</Label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
            >
              {(vms.length > 0
                ? vms
                : [
                    { target: "gpu0", displayName: "Kaggle GPU 0", status: "OFFLINE" },
                    { target: "gpu1", displayName: "Kaggle GPU 1", status: "OFFLINE" },
                    { target: "gpu2", displayName: "Kaggle GPU 2", status: "OFFLINE" },
                    { target: "gpu3", displayName: "Kaggle GPU 3", status: "OFFLINE" },
                    { target: "gcgpu", displayName: "Colab GPU 0", status: "OFFLINE" },
                    { target: "gcgpu1", displayName: "Colab GPU 1", status: "OFFLINE" },
                  ]
              ).map((v) => (
                <option key={v.target} value={v.target}>
                  {v.target.toUpperCase()} — {v.displayName} ({v.status})
                </option>
              ))}
            </select>
          </div>

          {customJsonMode ? (
            <div className="space-y-2">
              <Label>ComfyUI API Workflow JSON (Save API Format)</Label>
              <textarea
                rows={14}
                required
                value={customJsonText}
                onChange={(e) => setCustomJsonText(e.target.value)}
                placeholder='{"1": {"class_type": "CheckpointLoaderSimple", "inputs": {...}}}'
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3 font-mono text-[11px] text-zinc-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Checkpoint Model</Label>
                  <button
                    type="button"
                    onClick={() => refetchCatalog()}
                    className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingCatalog ? "animate-spin" : ""}`} />
                    Refresh Catalog
                  </button>
                </div>
                <select
                  value={checkpoint}
                  onChange={(e) => setSelectedCheckpoint(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                >
                  {checkpoints.length === 0 ? (
                    <option value="">Auto (First Available Checkpoint on VM)</option>
                  ) : (
                    checkpoints.map((ckpt) => (
                      <option key={ckpt} value={ckpt}>
                        {ckpt}
                      </option>
                    ))
                  )}
                </select>

                {recommendedMissing && activePreset && (
                  <button
                    type="button"
                    onClick={handleStreamRecommendedCheckpoint}
                    disabled={streamingCkpt}
                    className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-950/30 px-2.5 py-1.5 text-[11px] text-indigo-300 hover:bg-indigo-950/50"
                  >
                    {streamingCkpt ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <HardDriveDownload className="h-3 w-3" />
                    )}
                    Stream {activePreset.recommendedCheckpoint} to {target}
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Positive Prompt</Label>
                <textarea
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  required
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Negative Prompt</Label>
                <textarea
                  rows={2}
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-[11px]">Width</Label>
                  <Input
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                    step={64}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Height</Label>
                  <Input
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value))}
                    step={64}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Steps</Label>
                  <Input
                    type="number"
                    value={steps}
                    onChange={(e) => setSteps(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">CFG</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={cfg}
                    onChange={(e) => setCfg(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">Sampler</Label>
                  <select
                    value={samplerName}
                    onChange={(e) => setSamplerName(e.target.value)}
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
                    value={scheduler}
                    onChange={(e) => setScheduler(e.target.value)}
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
                  <Label className="text-[11px]">Seed</Label>
                  <Input
                    type="text"
                    placeholder="Random"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={hiresPass}
                  onChange={(e) => setHiresPass(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900"
                />
                Enable 2-Pass Latent Hires Upscale (2× resolution refinement)
              </label>
            </>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {pollingJobId ? `Rendering & Syncing (${pollingJobId.slice(-6)})...` : "Dispatching..."}
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
            {durationMs != null && (
              <span className="font-mono text-emerald-400">
                Completed in {(durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          <div className="flex min-h-[420px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            {outputs.length > 0 && outputs[0].previewUrl ? (
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={outputs[0].previewUrl}
                  alt={outputs[0].filename}
                  className="max-h-[460px] rounded-lg object-contain shadow-2xl"
                />
                <div className="flex items-center gap-3 text-xs text-zinc-400">
                  <span className="font-mono">{outputs[0].gdrivePath}</span>
                  <a
                    href={outputs[0].previewUrl}
                    download={outputs[0].filename}
                    className="flex items-center gap-1 text-indigo-400 hover:underline"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                </div>
              </div>
            ) : submitting ? (
              <div className="flex flex-col items-center gap-3 text-xs text-zinc-400">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                <span>Executing workflow on {target.toUpperCase()} &amp; syncing to Google Drive...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-xs text-zinc-500">
                <ImageIcon className="h-10 w-10 text-zinc-700" />
                <span>Generated output will appear here and persist in History.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
