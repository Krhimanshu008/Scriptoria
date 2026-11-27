"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Play, Loader2, Cpu, SlidersHorizontal, Layers } from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { WorkflowBuildSpec, WorkflowPipelineKind } from "@/lib/workflow/compiler";
import { useClusterStore } from "@/store/cluster-store";
import { toast } from "sonner";

interface WorkflowTemplateItem {
  id: string;
  slug: string;
  name: string;
  modality: string;
  categoryTag: string;
  targetProfile: string;
  description: string;
  vramRequiredGb: number;
  requiredModels: string[];
  requiredNodes: string[];
  isSeeded: boolean;
}

function buildSpecFromTemplate(wf: WorkflowTemplateItem): WorkflowBuildSpec {
  const s = `${wf.slug} ${wf.name}`.toLowerCase();
  const modelsLower = wf.requiredModels.map((m) => m.toLowerCase());

  let pipeline: WorkflowPipelineKind = "sdxl_txt2img";
  if (wf.modality === "AUDIO") {
    pipeline = s.includes("f5")
      ? "audio_f5"
      : s.includes("mmaudio")
      ? "audio_mmaudio"
      : s.includes("stable")
      ? "audio_stable"
      : "audio_kokoro";
  } else if (wf.modality === "VIDEO") {
    pipeline = s.includes("latentsync") ? "video_latentsync" : "video_ltx";
  } else if (s.includes("flux3") || s.includes("klein")) {
    pipeline = "flux3_klein";
  } else if (s.includes("moss")) {
    pipeline = "moss_image";
  } else if (s.includes("qwen21") || s.includes("2.1")) {
    pipeline = "qwen21_edit";
  } else if (s.includes("360") || s.includes("2512")) {
    pipeline = "panorama_360";
  } else if (s.includes("noob") || modelsLower.some((m) => m.includes("vpred"))) {
    pipeline = "noob_vpred";
  } else if (s.includes("animagine")) {
    pipeline = "animagine_v4";
  } else if (s.includes("lumina") || s.includes("neta")) {
    pipeline = "neta_lumina";
  } else if (s.includes("anima")) {
    pipeline = "anima_v1";
  } else if (s.includes("flux")) {
    pipeline = "flux_gguf";
  } else if (s.includes("qwen")) {
    pipeline = "qwen_edit";
  } else if (s.includes("detailer") || s.includes("upscale")) {
    pipeline = "sdxl_detailer_upscale";
  }

  const pickByPrefix = (prefixes: string[]) => {
    const match = wf.requiredModels.find((m) =>
      prefixes.some((p) => m.toLowerCase().startsWith(p))
    );
    return match ? match.split("/").pop() : undefined;
  };

  return {
    pipeline,
    baseModel: pickByPrefix(["checkpoints/", "diffusion_models/", "unet/"]),
    vaeModel: pickByPrefix(["vae/"]),
    upscalerModel: pickByPrefix(["upscale_models/"]),
    enableFaceDetailer: modelsLower.some((m) => m.includes("face_yolov8")),
    enableHandDetailer: modelsLower.some((m) => m.includes("hand_yolov8")),
    relight: modelsLower.some((m) => m.includes("lbm_relighting")) ? "lbm_relight" : "none",
    dualGpuSplit:
      wf.targetProfile === "IMAGE_DIT_DUAL_T4" ||
      ["flux3_klein", "moss_image", "qwen21_edit", "panorama_360"].includes(pipeline),
    prompt: `masterpiece, ${wf.name.toLowerCase()} — cinematic detailed story artwork`,
  };
}

export function WorkflowGalleryTab({
  vms,
  onOpenInArchitect,
  onSendToBatch,
}: {
  vms: PublicVmInstance[];
  onOpenInArchitect?: () => void;
  onSendToBatch?: () => void;
}) {
  const [modalityFilter, setModalityFilter] = useState("ALL");
  const [runningSlug, setRunningSlug] = useState<string | null>(null);
  const setArchitectDraftSpec = useClusterStore((s) => s.setArchitectDraftSpec);
  const setBatchDraft = useClusterStore((s) => s.setBatchDraft);
  const onlineVm = vms.find((v) => v.status === "ONLINE");

  const { data } = useQuery<{ workflows: WorkflowTemplateItem[] }>({
    queryKey: ["catalog-workflows"],
    queryFn: async () => {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 20000,
  });

  const workflows = (data?.workflows ?? []).filter(
    (w) => w.modality !== "LLM" && (modalityFilter === "ALL" || w.modality === modalityFilter)
  );

  function handleOpenArchitect(wf: WorkflowTemplateItem) {
    const spec = buildSpecFromTemplate(wf);
    setArchitectDraftSpec(spec);
    toast.success(`Loaded "${wf.name}" into Architect`);
    onOpenInArchitect?.();
  }

  function handleOpenBatch(wf: WorkflowTemplateItem) {
    const spec = buildSpecFromTemplate(wf);
    setBatchDraft({
      baseSpec: spec,
      title: `${wf.name} · Batch`,
      suggestedMode: "prompt_list",
      createdAt: Date.now(),
    });
    toast.success(`Sent "${wf.name}" config to Batch Studio`);
    onSendToBatch?.();
  }

  async function handleQuickBatchTemplate(wf: WorkflowTemplateItem) {
    setRunningSlug(wf.slug);
    const spec = buildSpecFromTemplate(wf);
    try {
      const res = await fetch("/api/v1/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceApp: "workflow-gallery",
          title: wf.name,
          scenes: [
            {
              sceneKey: wf.slug,
              tracks:
                wf.modality === "AUDIO"
                  ? {
                      audio_tts: {
                        text: "Welcome to Scriptoria multi-modal audio synthesis.",
                        voice: "af_heart",
                      },
                    }
                  : wf.modality === "VIDEO"
                  ? {
                      video_i2v: {
                        motionPrompt: "cinematic slow camera dolly motion",
                        dependsOnVisual: false,
                      },
                    }
                  : { visual: spec },
            },
          ],
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to queue template");
        return;
      }
      toast.success(
        onlineVm
          ? `Queued ${wf.name} (${body.batchId})`
          : `Queued ${wf.name} — boot a matching GPU (${wf.targetProfile})`
      );
    } finally {
      setRunningSlug(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-[#111114] px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-xs font-medium text-white">
          <Sparkles className="h-3.5 w-3.5 text-zinc-400" />
          <span>Workflow Templates ({workflows.length})</span>
        </div>

        <div className="flex gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[11px]">
          {["ALL", "IMAGE", "AUDIO", "VIDEO"].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModalityFilter(m)}
              className={`rounded px-2.5 py-1 font-medium transition ${
                modalityFilter === m
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {workflows.map((wf) => (
          <div
            key={wf.id}
            className="flex flex-col justify-between space-y-2.5 rounded-lg border border-zinc-800 bg-[#111114] p-3.5 text-xs"
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-white">{wf.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-[10px]">
                    <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-zinc-200">
                      {wf.modality}
                    </span>
                    <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-400">
                      {wf.targetProfile}
                    </span>
                    <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-400">
                      ~{wf.vramRequiredGb}G
                    </span>
                  </div>
                </div>
                {!wf.isSeeded && (
                  <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    Custom
                  </span>
                )}
              </div>

              <p className="text-[11px] text-zinc-400">{wf.description}</p>

              <div className="flex flex-wrap gap-1">
                {wf.requiredModels.map((rm) => (
                  <span
                    key={rm}
                    className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[9.5px] text-zinc-400"
                  >
                    {rm}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-2.5">
              <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
                <Cpu className="h-3 w-3" />
                {wf.requiredNodes.length} nodes
              </span>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleOpenArchitect(wf)}
                  className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-800"
                >
                  <SlidersHorizontal className="h-3 w-3 text-indigo-400" />
                  Open in Architect
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenBatch(wf)}
                  className="flex items-center gap-1 rounded-md border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20"
                >
                  <Layers className="h-3 w-3" />
                  Send to Batch
                </button>
                <button
                  type="button"
                  disabled={runningSlug === wf.slug}
                  onClick={() => handleQuickBatchTemplate(wf)}
                  title="Queue 1 sample render immediately"
                  className="flex items-center gap-1 rounded-md bg-indigo-600/85 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-500"
                >
                  {runningSlug === wf.slug ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  Run
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
