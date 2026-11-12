"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bot, Cpu, PanelRightClose, PanelRightOpen, Server } from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import { SmartWorkflowCreator } from "@/components/studio/SmartWorkflowCreator";
import { SceneBatchStudio } from "@/components/studio/SceneBatchStudio";
import { WorkflowGalleryTab } from "@/components/studio/WorkflowGalleryTab";
import { AgentCoDirectorPanel } from "@/components/studio/AgentCoDirectorPanel";
import { LiveConsole } from "@/components/logs/LiveConsole";

type StudioTabId = "single" | "creator" | "scenes" | "batch" | "gallery";

const STUDIO_TABS: Array<{ id: StudioTabId; label: string }> = [
  { id: "single", label: "Prompt" },
  { id: "creator", label: "Workflow Creator" },
  { id: "scenes", label: "5-Track Scenes" },
  { id: "batch", label: "Batch & Ingest" },
  { id: "gallery", label: "Templates" },
];

export function AgenticStudioDashboard() {
  const [activeTab, setActiveTab] = useState<StudioTabId>("single");
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);

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
      {/* Clean Underline Tab Bar + Online GPU Strip + Co-Director Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-2.5">
        <div className="flex flex-wrap items-center gap-5 text-xs font-medium">
          {STUDIO_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-[11px] border-b-2 pb-2.5 transition ${
                activeTab === tab.id
                  ? "border-indigo-500 text-white"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onlineVms.length === 0 ? (
            <Link
              href="/vms"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-[11px] font-medium text-amber-300 hover:bg-zinc-800"
            >
              <Server className="h-3 w-3" />
              Boot GPUs
            </Link>
          ) : (
            onlineVms.map((v) => {
              const total = v.vramTotalGb ?? 16;
              const free = Math.max(0, total - (v.vramUsedGb ?? 0));
              return (
                <span
                  key={v.target}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 font-mono text-[10px] text-emerald-300"
                >
                  <Cpu className="h-3 w-3" />
                  <strong>{v.target.toUpperCase()}</strong>
                  <span className="text-emerald-200/75">{free.toFixed(1)}G</span>
                </span>
              );
            })
          )}

          <button
            type="button"
            onClick={() => setAgentDrawerOpen((v) => !v)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${
              agentDrawerOpen
                ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-200"
                : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            <Bot className="h-3.5 w-3.5 text-indigo-400" />
            <span>AI Co-Director</span>
            {agentDrawerOpen ? (
              <PanelRightClose className="h-3 w-3 text-zinc-400" />
            ) : (
              <PanelRightOpen className="h-3 w-3 text-zinc-400" />
            )}
          </button>
        </div>
      </div>

      {/* Main Workspace + Toggleable Co-Director Right Drawer */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          {activeTab === "single" && <StudioWorkspace />}
          {activeTab === "creator" && <SmartWorkflowCreator vms={vms} />}
          {activeTab === "scenes" && <SceneBatchStudio subView="scenes" />}
          {activeTab === "batch" && <SceneBatchStudio subView="batch" />}
          {activeTab === "gallery" && <WorkflowGalleryTab vms={vms} />}
          <LiveConsole />
        </div>

        {agentDrawerOpen && (
          <aside className="w-full shrink-0 xl:sticky xl:top-16 xl:w-[360px]">
            <AgentCoDirectorPanel />
          </aside>
        )}
      </div>
    </div>
  );
}
