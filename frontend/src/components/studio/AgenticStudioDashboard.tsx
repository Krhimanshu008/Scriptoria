"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Cpu,
  ExternalLink,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Power,
  Server,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import type { DualT4TopologyMode, PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { useClusterStore } from "@/store/cluster-store";
import {
  KaggleVmLauncherDialog,
  useKaggleClusterAccounts,
} from "@/components/studio/StudioVmLauncher";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import { SmartWorkflowCreator } from "@/components/studio/SmartWorkflowCreator";
import { SceneBatchStudio } from "@/components/studio/SceneBatchStudio";
import { WorkflowGalleryTab } from "@/components/studio/WorkflowGalleryTab";
import { AgentCoDirectorPanel } from "@/components/studio/AgentCoDirectorPanel";
import { LiveConsole } from "@/components/logs/LiveConsole";
import { toast } from "sonner";

type StudioTabId = "creator" | "batch" | "gallery";
type AssistantTabId = "codirector" | "logs";

const STUDIO_TABS: Array<{ id: StudioTabId; label: string }> = [
  { id: "creator", label: "Studio & Architect" },
  { id: "batch", label: "Batch Studio" },
  { id: "gallery", label: "Templates" },
];

const TOPOLOGY_LABELS: Array<{ id: DualT4TopologyMode; label: string; short: string }> = [
  { id: "dual_parallel", label: "Dual Parallel (2×16G)", short: "Parallel 2×" },
  { id: "dual_pipeline", label: "2-Stage Pipeline (GPU0→GPU1)", short: "2-Stage" },
  { id: "dual_split", label: "Dual-T4 Split (32G DiT)", short: "32G Split" },
  { id: "copilot_split", label: "Co-Pilot QA (Comfy + VLM)", short: "QA Split" },
];

export function AgenticStudioDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<StudioTabId>("creator");
  const [studioMode, setStudioMode] = useState<"architect" | "quick">("architect");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantTab, setAssistantTab] = useState<AssistantTabId>("codirector");
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [switchingTopo, setSwitchingTopo] = useState(false);
  const setSelectedTarget = useClusterStore((s) => s.setSelectedTarget);

  const { data: vmData } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 2500,
    refetchInterval: (q) =>
      q.state.data?.vms?.some((v) => v.status === "STARTING") ? 3000 : 10000,
  });

  const vms = vmData?.vms ?? [];
  const onlineVms = vms.filter((v) => v.status === "ONLINE" || v.status === "BUSY");
  const startingVms = vms.filter((v) => v.status === "STARTING");
  const { configuredAccounts } = useKaggleClusterAccounts(vms);
  const onlineKaggleCount = configuredAccounts.filter((a) => a.isOnline).length;

  // Pick active Dual-T4 pod (if an account has GPUs online/starting) to display paired GPU0+GPU1 & topology selector
  const activePod =
    configuredAccounts.find((a) => a.isOnline || a.isStarting) ||
    configuredAccounts[0] ||
    null;
  const activePodTopo =
    (activePod?.vms.find((v) => v.bootMetadata?.topologyMode)?.bootMetadata?.topologyMode as
      | DualT4TopologyMode
      | undefined) ||
    (activePod?.activeProfile === "IMAGE_DIT_DUAL_T4" ? "dual_split" : "dual_parallel");
  const requestedPodTopo = activePod?.vms.find((v) => v.bootMetadata?.requestedTopologyMode)
    ?.bootMetadata?.requestedTopologyMode;

  async function handleSwitchTopology(nextMode: DualT4TopologyMode) {
    if (!activePod) return;
    setSwitchingTopo(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(activePod.primaryTarget)}/topology`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to switch Dual-T4 topology");
        return;
      }
      toast.success(
        `Switched ${activePod.alias.toUpperCase()} topology to ${nextMode} (${data.dispatchedVia})`
      );
      await queryClient.invalidateQueries({ queryKey: ["vm-status"] });
    } finally {
      setSwitchingTopo(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Unified Studio Tab Bar + Dual-T4 Pod Strip & Topology Switcher + Assistant Drawer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-2.5">
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
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

          {activeTab === "creator" && (
            <div className="ml-1 inline-flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setStudioMode("architect")}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 transition ${
                  studioMode === "architect"
                    ? "bg-indigo-600/80 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <SlidersHorizontal className="h-3 w-3" />
                Modular
              </button>
              <button
                type="button"
                onClick={() => setStudioMode("quick")}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 transition ${
                  studioMode === "quick"
                    ? "bg-indigo-600/80 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Sparkles className="h-3 w-3" />
                Quick Canvas
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Paired Dual-T4 GPU Pill + Live Topology Mode Selector */}
          {onlineVms.length > 0 && activePod && (
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px]">
              <div className="flex items-center gap-2 pr-1 font-mono text-emerald-200">
                {activePod.vms
                  .filter((v) => v.status === "ONLINE" || v.status === "BUSY")
                  .map((v) => {
                    const free = Math.max(0, (v.vramTotalGb ?? 16) - (v.vramUsedGb ?? 0));
                    return (
                      <span key={v.target} className="inline-flex items-center gap-1">
                        <Cpu className="h-3 w-3 text-emerald-400" />
                        <strong>{v.target.toUpperCase()}</strong>
                        <span className="text-emerald-200/80">{free.toFixed(1)}G</span>
                      </span>
                    );
                  })}
              </div>

              <span className="h-3.5 w-px bg-emerald-500/25" />

              <div className="flex items-center gap-1 pl-1">
                <Zap className="h-3 w-3 text-amber-300" />
                <select
                  aria-label="Dual-T4 Execution Topology"
                  disabled={switchingTopo}
                  value={requestedPodTopo || activePodTopo}
                  onChange={(e) => handleSwitchTopology(e.target.value as DualT4TopologyMode)}
                  className="bg-transparent font-mono text-[10px] font-semibold text-amber-200 focus:outline-none"
                >
                  {TOPOLOGY_LABELS.map((t) => (
                    <option key={t.id} value={t.id} className="bg-zinc-900 text-zinc-100">
                      {t.label}
                    </option>
                  ))}
                </select>
                {switchingTopo && <Loader2 className="h-3 w-3 animate-spin text-amber-300" />}
              </div>
            </div>
          )}

          {startingVms.map((v) => (
            <span
              key={v.target}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-500/35 bg-amber-500/15 px-2 font-mono text-[10px] text-amber-200"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              <strong>{v.target.toUpperCase()}</strong>
              <span>{v.stepProgress || 1}/5</span>
            </span>
          ))}

          <button
            type="button"
            onClick={() => setLauncherOpen(true)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition ${
              onlineVms.length === 0 && startingVms.length === 0
                ? "border-amber-500/45 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
                : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            {onlineVms.length === 0 && startingVms.length === 0 ? (
              <Power className="h-3 w-3 text-amber-300" />
            ) : (
              <Server className="h-3 w-3 text-indigo-400" />
            )}
            <span>
              {onlineVms.length === 0 && startingVms.length === 0
                ? configuredAccounts.length > 0
                  ? `Boot Kaggle (${configuredAccounts.length} Acct${configuredAccounts.length > 1 ? "s" : ""})`
                  : "Boot Kaggle VM"
                : `Kaggle VMs (${onlineKaggleCount}/${configuredAccounts.length || 3})`}
            </span>
          </button>

          <Link
            href="/llm-studio"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-[11px] font-medium text-indigo-300 transition hover:bg-zinc-800 hover:text-indigo-200"
          >
            <Bot className="h-3.5 w-3.5" />
            <span>LLM Studio</span>
            <ExternalLink className="h-2.5 w-2.5 opacity-70" />
          </Link>

          <button
            type="button"
            onClick={() => setAssistantOpen((v) => !v)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${
              assistantOpen
                ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-200"
                : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            <Bot className="h-3.5 w-3.5 text-indigo-400" />
            <span>AI &amp; Logs</span>
            {assistantOpen ? (
              <PanelRightClose className="h-3 w-3 text-zinc-400" />
            ) : (
              <PanelRightOpen className="h-3 w-3 text-zinc-400" />
            )}
          </button>
        </div>
      </div>

      {/* Main Workspace + Toggleable Co-Director / Logs Drawer */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          {activeTab === "creator" &&
            (studioMode === "architect" ? (
              <SmartWorkflowCreator vms={vms} onOpenBatch={() => setActiveTab("batch")} />
            ) : (
              <StudioWorkspace onOpenArchitect={() => setStudioMode("architect")} />
            ))}
          {activeTab === "batch" && <SceneBatchStudio subView="batch" />}
          {activeTab === "gallery" && (
            <WorkflowGalleryTab
              vms={vms}
              onOpenInArchitect={() => {
                setStudioMode("architect");
                setActiveTab("creator");
              }}
              onSendToBatch={() => setActiveTab("batch")}
            />
          )}
        </div>

        {assistantOpen && (
          <aside className="w-full shrink-0 space-y-3 xl:sticky xl:top-16 xl:w-[400px]">
            <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-[#111114] p-1 text-[11px] font-medium">
              <button
                type="button"
                onClick={() => setAssistantTab("codirector")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 transition ${
                  assistantTab === "codirector"
                    ? "bg-indigo-600/85 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Bot className="h-3.5 w-3.5" />
                Co-Director
              </button>
              <button
                type="button"
                onClick={() => setAssistantTab("logs")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 transition ${
                  assistantTab === "logs"
                    ? "bg-indigo-600/85 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Terminal className="h-3.5 w-3.5" />
                Live Logs
              </button>
            </div>

            {assistantTab === "codirector" && <AgentCoDirectorPanel />}
            {assistantTab === "logs" && <LiveConsole />}
          </aside>
        )}
      </div>

      <KaggleVmLauncherDialog
        open={launcherOpen}
        onOpenChange={setLauncherOpen}
        vms={vms}
        onTargetSelected={(t) => setSelectedTarget(t, true)}
      />
    </div>
  );
}
