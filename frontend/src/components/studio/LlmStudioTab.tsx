"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Terminal,
  GitCompare,
  ListChecks,
  Workflow,
  Sparkles,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  KaggleVmLauncherDialog,
  useKaggleClusterAccounts,
} from "@/components/studio/StudioVmLauncher";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import {
  CANONICAL_LLM_PRESET_ID,
  CANONICAL_LLM_PROFILE_ID,
} from "@/lib/llm/llm-model-presets";
import {
  type LlmHealthResponse,
  buildTargetOptions,
} from "@/components/llm-studio/types";
import { LlmTelemetryProvider } from "@/components/llm-studio/LlmTelemetryContext";
import { MissionControlHud } from "@/components/llm-studio/MissionControlHud";
import { PlaygroundPanel } from "@/components/llm-studio/PlaygroundPanel";
import { ArenaPanel } from "@/components/llm-studio/ArenaPanel";
import { BatchEvalPanel } from "@/components/llm-studio/BatchEvalPanel";
import { WorkflowsChainPanel } from "@/components/llm-studio/WorkflowsChainPanel";

type LlmStudioTabKey = "playground" | "arena" | "batch" | "workflows";

interface EndpointInfoResponse {
  online: boolean;
  headless?: boolean;
  status: string;
  target: string | null;
  workerProfile?: string | null;
  llmTopologyMode?: string;
  baseUrl: string | null;
  relayEndpoint: string;
  services?: Record<string, string> | null;
  apiKey: string | null;
}

export function LlmStudioTab({
  vms = [],
  onVmsUpdated,
}: {
  vms?: PublicVmInstance[];
  onVmsUpdated?: () => void;
}) {
  const [activeSubTab, setActiveSubTab] = useState<LlmStudioTabKey>("playground");
  const [globalThinkingEnabled, setGlobalThinkingEnabled] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [modelActionBusy, setModelActionBusy] = useState<string | null>(null);

  const { configuredAccounts, bestOfflineAccount, refreshCluster } =
    useKaggleClusterAccounts(vms);

  const {
    data: health,
    isFetching: refreshingHealth,
    refetch: refetchHealth,
  } = useQuery<LlmHealthResponse>({
    queryKey: ["llm-studio-health"],
    queryFn: async () => {
      const res = await fetch("/api/llm-studio/health");
      if (!res.ok) throw new Error("Failed to check LLM Studio health");
      return res.json();
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 5000;
      if (
        d.activeTransfer ||
        d.vmStatus === "STARTING" ||
        d.runtimeMode === "loading_model" ||
        d.slot?.isProcessing
      ) {
        return 2500;
      }
      return d.vmStatus === "ONLINE" ? 5000 : 10000;
    },
    staleTime: 2000,
  });

  const { data: endpointInfo, refetch: refetchEndpoint } = useQuery<EndpointInfoResponse>({
    queryKey: ["llm-studio-endpoint"],
    queryFn: async () => {
      const res = await fetch("/api/v1/llm-endpoint");
      if (!res.ok) throw new Error("Failed to load API endpoint info");
      return res.json();
    },
    enabled: apiDialogOpen,
  });

  const targetOptions = useMemo(() => buildTargetOptions(health), [health]);

  const onlineGpuLlmVm = useMemo(() => {
    const online = health?.onlineVms || [];
    return (
      online.find((v) => !v.target.startsWith("tpu") && v.reachable) ||
      online.find((v) => !v.target.startsWith("tpu")) ||
      null
    );
  }, [health?.onlineVms]);

  const healthAccountAlias = health?.accountAlias;
  const activeAccount = useMemo(() => {
    if (healthAccountAlias) {
      const matched = configuredAccounts.find(
        (a) => a.alias.toLowerCase() === healthAccountAlias.toLowerCase()
      );
      if (matched) return matched;
    }
    return bestOfflineAccount || configuredAccounts[0] || null;
  }, [configuredAccounts, bestOfflineAccount, healthAccountAlias]);

  const controlTarget = onlineGpuLlmVm?.target || health?.target || activeAccount?.primaryTarget || null;

  async function handleModelControlAction(
    action: "stage_llm" | "load_llm" | "unload_llm" | "keep_alive"
  ) {
    if (!onlineGpuLlmVm || modelActionBusy) return;
    setModelActionBusy(action);
    try {
      const res = await fetch(
        `/api/vm/${encodeURIComponent(onlineGpuLlmVm.target)}/model-control`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            ...(action === "stage_llm" || action === "load_llm"
              ? { presetId: CANONICAL_LLM_PRESET_ID }
              : {}),
          }),
        }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(
        action === "stage_llm"
          ? `Queued Qwen3.8-27B disk staging on ${onlineGpuLlmVm.target.toUpperCase()}`
          : action === "load_llm"
          ? `Queued Qwen3.8-27B VRAM load on ${onlineGpuLlmVm.target.toUpperCase()} (~15-45s)`
          : action === "keep_alive"
          ? `Watchdog +Keep Alive ping sent to ${onlineGpuLlmVm.target.toUpperCase()}`
          : `Unloaded Qwen3.8-27B from ${onlineGpuLlmVm.target.toUpperCase()} VRAM`
      );
      await refetchHealth();
      onVmsUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed ${action}`);
    } finally {
      setModelActionBusy(null);
    }
  }

  async function handleHotReload() {
    if (!onlineGpuLlmVm) return;
    try {
      const res = await fetch(
        `/api/vm/${encodeURIComponent(onlineGpuLlmVm.target)}/hot-reload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: CANONICAL_LLM_PROFILE_ID }),
        }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success("Hot-reloaded worker to refresh llama-server CUDA 12 v2");
      await refetchHealth();
      onVmsUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to hot-reload worker");
    }
  }

  async function handleAttachSuggestedDataset(slug: string) {
    if (!controlTarget) return;
    try {
      const existing = health?.ancillary?.dataset.attachedSlugs ?? [];
      const next = existing.includes(slug) ? existing : [...existing, slug].slice(0, 6);
      const res = await fetch(`/api/vm/${encodeURIComponent(controlTarget)}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applyToGroup: true, kaggleDatasets: next }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed attaching Qwen dataset");
      toast.success(`Attached Qwen dataset ${slug}`);
      await Promise.all([refetchHealth(), refreshCluster()]);
      onVmsUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed attaching Qwen dataset");
    }
  }

  async function handleBuildDataset() {
    if (!controlTarget) return;
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(controlTarget)}/build-fastboot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: CANONICAL_LLM_PROFILE_ID,
          presetId: CANONICAL_LLM_PRESET_ID,
        }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(json.error || "Failed queueing 0-GPU Dataset builder");
      toast.success("Queued 0-GPU Qwen3.8-27B Dataset build! Check Kaggle Output to save dataset.");
      await refetchHealth();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed queueing dataset build");
    }
  }

  const originUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const curlSample = endpointInfo?.relayEndpoint
    ? `curl -X POST "${endpointInfo.relayEndpoint}" \\\n  -H "Authorization: Bearer YOUR_SK_SCRIPTORIA_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"default","messages":[{"role":"user","content":"Hello!"}]}'`
    : `curl -X POST "${originUrl}/api/v1/chat/completions" \\\n  -H "Authorization: Bearer YOUR_SK_SCRIPTORIA_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"default","messages":[{"role":"user","content":"Hello!"}]}'`;

  return (
    <LlmTelemetryProvider>
      <div className="space-y-4">
        <MissionControlHud
          health={health}
          refreshingHealth={refreshingHealth}
          globalThinkingEnabled={globalThinkingEnabled}
          onToggleThinking={setGlobalThinkingEnabled}
          activeAccount={activeAccount}
          targetBusyAction={modelActionBusy}
          onOpenLauncher={() => setLauncherOpen(true)}
          onOpenApiDialog={() => {
            setApiDialogOpen(true);
            void refetchEndpoint();
          }}
          onRefreshHealth={() => {
            void refetchHealth();
            void refreshCluster();
            onVmsUpdated?.();
          }}
          onModelAction={handleModelControlAction}
          onHotReload={handleHotReload}
          onAttachSuggestedDataset={handleAttachSuggestedDataset}
          onBuildDataset={handleBuildDataset}
        />

        {/* 4 Clean LLM Studio Workspace Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/70 p-1.5">
          {[
            { key: "playground" as const, label: "Playground & Vision QA", icon: Sparkles },
            { key: "arena" as const, label: "Config A/B Tuning Arena", icon: GitCompare },
            { key: "batch" as const, label: "Batch Eval & Datasets", icon: ListChecks },
            { key: "workflows" as const, label: "LLM Workflows (Chained)", icon: Workflow },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveSubTab(key)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                activeSubTab === key
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        {activeSubTab === "playground" && (
          <PlaygroundPanel
            targetOptions={targetOptions}
            globalThinkingEnabled={globalThinkingEnabled}
          />
        )}
        {activeSubTab === "arena" && (
          <ArenaPanel
            targetOptions={targetOptions}
            globalThinkingEnabled={globalThinkingEnabled}
            vaultProviders={health?.vaultProviders || []}
          />
        )}
        {activeSubTab === "batch" && (
          <BatchEvalPanel
            targetOptions={targetOptions}
            globalThinkingEnabled={globalThinkingEnabled}
          />
        )}
        {activeSubTab === "workflows" && (
          <WorkflowsChainPanel
            targetOptions={targetOptions}
            globalThinkingEnabled={globalThinkingEnabled}
          />
        )}

        {/* Fixed LLM-Only Kaggle Dual-T4 Boot Launcher */}
        <KaggleVmLauncherDialog
          open={launcherOpen}
          onOpenChange={setLauncherOpen}
          vms={vms}
          desiredProfile={CANONICAL_LLM_PROFILE_ID}
          launcherMode="llm"
          prewarmModels={[]}
          onTargetSelected={() => {
            void refetchHealth();
            onVmsUpdated?.();
          }}
        />

        {/* OpenAI-Compatible API Gateway Modal */}
        <Dialog open={apiDialogOpen} onOpenChange={setApiDialogOpen}>
          <DialogContent className="sm:max-w-xl bg-zinc-950 border-zinc-800 text-zinc-100">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-zinc-100">
                <Terminal className="size-4 text-violet-400" />
                OpenAI-Compatible LLM Gateway
              </DialogTitle>
              <DialogDescription className="text-zinc-400">
                Call Scriptoria&apos;s Qwen3.8-27B VLM + Native MTP from external scripts or CI via OpenAI SDK. Routes across Kaggle Dual-T4 (including Safe Headless Relay) or Vault fallback.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-xs">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Status</span>
                  <Badge variant="outline">
                    {endpointInfo?.online
                      ? endpointInfo.headless
                        ? "ONLINE (Safe Headless Relay)"
                        : `ONLINE (${endpointInfo.target})`
                      : "OFFLINE (Vault Fallback Ready)"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-400">Completions URL</span>
                  <code className="text-[11px] text-cyan-300 truncate">
                    {endpointInfo?.relayEndpoint || `${originUrl}/api/v1/chat/completions`}
                  </code>
                </div>
                {endpointInfo?.llmTopologyMode && (
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">Active Dual-T4 Mode</span>
                    <code className="text-[11px] text-violet-300">
                      {endpointInfo.llmTopologyMode}
                    </code>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-300">cURL Quickstart</span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(curlSample);
                      setCopiedCurl(true);
                      setTimeout(() => setCopiedCurl(false), 1500);
                    }}
                  >
                    {copiedCurl ? <Check className="size-3" /> : <Copy className="size-3" />}
                    {copiedCurl ? "Copied" : "Copy"}
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 font-mono text-[11px] text-zinc-200">
                  {curlSample}
                </pre>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </LlmTelemetryProvider>
  );
}
