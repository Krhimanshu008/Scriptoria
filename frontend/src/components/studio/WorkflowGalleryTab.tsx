"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Play, Loader2, Cpu } from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
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

export function WorkflowGalleryTab({ vms }: { vms: PublicVmInstance[] }) {
  const [modalityFilter, setModalityFilter] = useState("ALL");
  const [runningSlug, setRunningSlug] = useState<string | null>(null);
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
    (w) => modalityFilter === "ALL" || w.modality === modalityFilter
  );

  async function handleQuickBatchTemplate(wf: WorkflowTemplateItem) {
    setRunningSlug(wf.slug);
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
                  ? { audio_tts: { text: "Welcome to Scriptoria multi-modal audio synthesis.", voice: "af_heart" } }
                  : wf.modality === "VIDEO"
                  ? { video_i2v: { motionPrompt: "cinematic slow camera dolly motion", dependsOnVisual: false } }
                  : { visual: { prompt: `cinematic artwork rendered via ${wf.name}` } },
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
          ? `Queued ${wf.name} into Multi-GPU Batch (${body.batchId})`
          : `Queued ${wf.name} in Batch Queue — boot a matching GPU (${wf.targetProfile}) in /vms`
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

            <div className="flex items-center justify-between border-t border-zinc-800/80 pt-2.5">
              <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
                <Cpu className="h-3 w-3" />
                {wf.requiredNodes.length} Comfy nodes
              </span>

              <button
                type="button"
                disabled={runningSlug === wf.slug}
                onClick={() => handleQuickBatchTemplate(wf)}
                className="flex items-center gap-1 rounded-lg bg-indigo-600/85 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-500"
              >
                {runningSlug === wf.slug ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                Queue Run
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

