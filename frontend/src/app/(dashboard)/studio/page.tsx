"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, RefreshCw, Loader2, Image as ImageIcon, Download } from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
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

export default function StudioPage() {
  const [target, setTarget] = useState("gpu0");
  const [selectedCheckpoint, setSelectedCheckpoint] = useState("");

  const [prompt, setPrompt] = useState(
    "masterpiece, best quality, highly detailed anime fantasy portrait, cinematic volumetric lighting, sharp focus"
  );
  const [negativePrompt, setNegativePrompt] = useState("bad quality, blurry, deformed, lowres");
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [steps, setSteps] = useState(25);
  const [cfg, setCfg] = useState(6.0);
  const [seed, setSeed] = useState("");

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

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setOutputs([]);
    setDurationMs(null);

    try {
      const res = await fetch("/api/workflow/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          prompt,
          negativePrompt,
          checkpoint: checkpoint || undefined,
          width,
          height,
          steps,
          cfg,
          seed: seed ? Number(seed) : undefined,
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">ComfyUI Prompt Studio</h1>
        <p className="text-xs text-zinc-400">
          Dispatch SDXL/Illustrious prompts to live GPU slots. Generated images automatically upload to Google Drive for permanent offline gallery playback.
        </p>
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

          <div className="space-y-1.5">
            <Label className="text-[11px]">Seed (optional)</Label>
            <Input
              type="text"
              placeholder="Random"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </div>

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

