"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Cpu, Sparkles, Wand2, Film, Layers, LayoutGrid, Server } from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import { SmartWorkflowCreator } from "@/components/studio/SmartWorkflowCreator";
import { SceneBatchStudio } from "@/components/studio/SceneBatchStudio";
import { WorkflowGalleryTab } from "@/components/studio/WorkflowGalleryTab";
import { AgentCoDirectorPanel } from "@/components/studio/AgentCoDirectorPanel";
import { LiveConsole } from "@/components/logs/LiveConsole";

type StudioTabId = "single" | "creator" | "scenes" | "batch" | "gallery";

export function AgenticStudioDashboard() {
  const [activeTab, setActiveTab] = useState<StudioTabId>("single");

  const { data: vmData } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 2500,
  });

  const vms = vmData?.vms ?? [];
  const onlineVms = vms.filter((v) => v.status === "ONLINE" || v.status === "BUSY");

  return (
    <div className="space-y-4">
      {/* Compact GPU Readiness & Tab Bar */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("single")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "single"
                ? "bg-indigo-600 text-white shadow"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Single-Pass Studio
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("creator")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "creator"
                ? "bg-indigo-600 text-white shadow"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Smart Workflow Creator
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("scenes")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "scenes"
                ? "bg-indigo-600 text-white shadow"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Film className="h-3.5 w-3.5" />
            5-Track Scene Studio
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("batch")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "batch"
                ? "bg-indigo-600 text-white shadow"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Batch &amp; Book Ingest
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("gallery")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "gallery"
                ? "bg-indigo-600 text-white shadow"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Workflow Gallery
          </button>
        </div>

        {/* Compact GPU Strip */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {onlineVms.length === 0 ? (
            <Link
              href="/vms"
              className="flex items-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-500/15 px-3 py-1.5 font-semibold text-amber-200 hover:bg-amber-500/25"
            >
              <Server className="h-3.5 w-3.5" />
              All GPUs Offline — Boot on VM Cluster
            </Link>
          ) : (
            onlineVms.map((v) => {
              const total = v.vramTotalGb ?? 16;
              const free = Math.max(0, total - (v.vramUsedGb ?? 0));
              return (
                <span
                  key={v.target}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 font-mono text-[10px] text-emerald-200"
                >
                  <Cpu className="h-3 w-3 text-emerald-400" />
                  <strong>{v.target.toUpperCase()}</strong>
                  <span className="text-emerald-300/80">{free.toFixed(1)}G free</span>
                  <span className="rounded bg-black/30 px-1 text-[9px] text-zinc-300">
                    {v.workerProfile}
                  </span>
                </span>
              );
            })
          )}
        </div>
      </div>

      {/* Main Split: Workspace Tabs (left) + Docked Agentic AI Co-Director (right) */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          {activeTab === "single" && <StudioWorkspace />}
          {activeTab === "creator" && <SmartWorkflowCreator vms={vms} />}
          {activeTab === "scenes" && <SceneBatchStudio subView="scenes" />}
          {activeTab === "batch" && <SceneBatchStudio subView="batch" />}
          {activeTab === "gallery" && <WorkflowGalleryTab vms={vms} />}
          <LiveConsole />
        </div>

        <aside className="xl:col-span-4">
          <div className="xl:sticky xl:top-20">
            <AgentCoDirectorPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}

