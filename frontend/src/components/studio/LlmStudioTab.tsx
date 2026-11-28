"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Cpu,
  Rocket,
  Terminal,
  RefreshCw,
  Loader2,
  GitCompare,
  ListChecks,
  Workflow,
  Sparkles,
  Layers,
  Copy,
  Check,
  ExternalLink,
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
import { KaggleVmLauncherDialog } from "@/components/studio/StudioVmLauncher";
import type { LlmTopologyMode, PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { WorkerProfileId } from "@/lib/catalog/worker-profiles";
import { LLM_MODEL_PRESETS, getDefaultPresetForLlmProfile } from "@/lib/llm/llm-model-presets";
import {
  LLM_LAUNCH_PROFILES,
  LLM_TOPOLOGY_OPTIONS,
  type LlmHealthResponse,
  buildTargetOptions,
} from "@/components/llm-studio/types";
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
  const [launchProfile, setLaunchProfile] = useState<WorkerProfileId>("LLM_QWEN_FAST_8B");
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [switchingTopo, setSwitchingTopo] = useState<string | null>(null);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [modelActionBusy, setModelActionBusy] = useState<string | null>(null);

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
    refetchInterval: 8000,
    staleTime: 4000,
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

  // Pick primary online GPU LLM VM for Dual-T4 topology switching (exclude TPU from Dual-T4 GPU splits)
  const onlineGpuLlmVm = useMemo(() => {
    const online = health?.onlineVms || [];
    return (
      online.find((v) => !v.target.startsWith("tpu") && v.reachable) ||
      online.find((v) => !v.target.startsWith("tpu")) ||
      null
    );
  }, [health?.onlineVms]);

  const activeTopology = (onlineGpuLlmVm?.llmTopologyMode ||
    (onlineGpuLlmVm?.workerProfile === "LLM_LIGHTWEIGHT_SWARM"
      ? "llm_swarm_multi"
      : "llm_layer_split")) as LlmTopologyMode;

  const requestedTopology = onlineGpuLlmVm?.requestedLlmTopology || null;
  const isDualReplicaActive = (health?.onlineVms || []).some(
    (v) => v.llmTopologyMode === "llm_dual_replica"
  );

  async function handleSwitchTopology(mode: LlmTopologyMode) {
    if (!onlineGpuLlmVm || switchingTopo) return;
    setSwitchingTopo(mode);
    try {
      const res = await fetch(
        `/api/vm/${encodeURIComponent(onlineGpuLlmVm.target)}/llm-topology`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        }
      );
      const json = (await res.json()) as { dispatchedVia?: string; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(
        `Switched Dual-T4 LLM topology to ${mode} (${json.dispatchedVia || "queued"})`
      );
      await refetchHealth();
      onVmsUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to switch LLM topology");
    } finally {
      setSwitchingTopo(null);
    }
  }

  const effectiveQuickPresetId =
    selectedPresetId && LLM_MODEL_PRESETS.some((p) => p.id === selectedPresetId)
      ? selectedPresetId
      : getDefaultPresetForLlmProfile(onlineGpuLlmVm?.workerProfile || launchProfile).id;

  async function handleModelControlAction(action: "stage_llm" | "load_llm" | "unload_llm") {
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
            ...(action !== "unload_llm" ? { presetId: effectiveQuickPresetId } : {}),
          }),
        }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(
        action === "stage_llm"
          ? `Queued model staging onto ${onlineGpuLlmVm.target.toUpperCase()} disk`
          : action === "load_llm"
          ? `Queued VRAM load on ${onlineGpuLlmVm.target.toUpperCase()} (~15-45s)`
          : `Unloaded LLM from ${onlineGpuLlmVm.target.toUpperCase()} VRAM`
      );
      await refetchHealth();
      onVmsUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed ${action}`);
    } finally {
      setModelActionBusy(null);
    }
  }

  const originUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const curlSample = endpointInfo?.relayEndpoint
    ? `curl -X POST "${endpointInfo.relayEndpoint}" \\\n  -H "Authorization: Bearer YOUR_SK_SCRIPTORIA_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"default","messages":[{"role":"user","content":"Hello!"}]}'`
    : `curl -X POST "${originUrl}/api/v1/chat/completions" \\\n  -H "Authorization: Bearer YOUR_SK_SCRIPTORIA_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"default","messages":[{"role":"user","content":"Hello!"}]}'`;

  return (
    <div className="space-y-4">
      {/* Top Compute & Dual-T4 LLM Topology Header */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="size-5 text-violet-400" />
              <h1 className="text-base font-semibold tracking-tight text-zinc-100">
                LLM Studio & Benchmark Lab
              </h1>
              <Badge
                variant="outline"
                className={
                  health?.reachable
                    ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300"
                    : health?.vmStatus === "STARTING"
                    ? "border-amber-500/40 bg-amber-950/30 text-amber-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-400"
                }
              >
                {health?.reachable
                  ? `ONLINE · ${health.target?.toUpperCase()} (${health.endpointPreview || "Ready"})`
                  : health?.vmStatus === "STARTING"
                  ? `STARTING · ${health.target?.toUpperCase() || "VM"}`
                  : "GPU/TPU OFFLINE"}
              </Badge>
              {health?.loadedModel ? (
                <Badge variant="secondary" className="text-[11px]">
                  VRAM: {health.loadedModel}
                </Badge>
              ) : health?.reachable ? (
                <Badge
                  variant="outline"
                  className={`text-[11px] ${
                    health?.runtimeMode === "loading_model"
                      ? "border-amber-500/40 text-amber-300 animate-pulse"
                      : "border-cyan-500/35 text-cyan-300"
                  }`}
                >
                  {health?.runtimeMode === "loading_model"
                    ? `LOADING ${health.activeModelName || "MODEL"}...`
                    : "IDLE · EMPTY COMPUTE (0 MODELS)"}
                </Badge>
              ) : null}
              {(health?.vaultFallbackCount || 0) > 0 && (
                <Badge variant="outline" className="text-[11px] border-cyan-500/30 text-cyan-300">
                  +{health?.vaultFallbackCount} Vault API
                  {(health?.vaultFallbackCount || 0) > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <p className="text-xs text-zinc-400">
              {health?.onlineVms && health.onlineVms.length > 0
                ? `${health.onlineVms.length} active LLM worker${
                    health.onlineVms.length > 1 ? "s" : ""
                  } · ${health.gpuName || "Compute Ready"}${
                    health.probeLatencyMs ? ` · ${health.probeLatencyMs}ms ping` : ""
                  }`
                : "Launch a Kaggle Dual-T4 LLM worker (tunneled or Safe Headless Relay), TPU v5e-8, or test directly against Vault cloud models."}
            </p>
          </div>

          {/* Compute Launcher & API Gateway Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={launchProfile}
              onChange={(e) => setLaunchProfile(e.target.value as WorkerProfileId)}
              className="h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100 outline-none focus:border-violet-500"
              title="Select Kaggle LLM Worker Profile"
            >
              {LLM_LAUNCH_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>

            <Button size="sm" onClick={() => setLauncherOpen(true)}>
              <Rocket className="size-3.5" /> Boot GPU LLM
            </Button>

            <Link
              href="/tpu-cluster"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <Cpu className="size-3.5 text-cyan-400" /> TPU v5e-8
              <ExternalLink className="size-3 text-zinc-500" />
            </Link>

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setApiDialogOpen(true);
                void refetchEndpoint();
              }}
            >
              <Terminal className="size-3.5" /> API Endpoint
            </Button>

            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => {
                void refetchHealth();
                onVmsUpdated?.();
              }}
              title="Refresh LLM worker telemetry"
            >
              {refreshingHealth ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Dual-T4 LLM Topology Switcher Bar */}
        <div className="border-t border-zinc-800/90 pt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Layers className="size-3.5 text-violet-400 shrink-0" />
            <span className="font-medium text-zinc-300">Dual-T4 GPU Topology:</span>
            {!onlineGpuLlmVm && (
              <span className="text-[11px] text-zinc-500">
                (Boot a Kaggle Dual-T4 LLM worker to live-switch GPU0+GPU1 split vs 2x Replica / A-B Arena)
              </span>
            )}
            {requestedTopology && requestedTopology !== activeTopology && (
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                Switching to {requestedTopology}...
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {LLM_TOPOLOGY_OPTIONS.map((opt) => {
              const isSelected = Boolean(onlineGpuLlmVm) && activeTopology === opt.mode;
              const isPending = switchingTopo === opt.mode || requestedTopology === opt.mode;
              return (
                <button
                  key={opt.mode}
                  type="button"
                  disabled={!onlineGpuLlmVm || Boolean(switchingTopo)}
                  onClick={() => handleSwitchTopology(opt.mode)}
                  title={opt.description}
                  className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition disabled:opacity-45 ${
                    isSelected
                      ? "border-violet-500/70 bg-violet-950/35 text-violet-100"
                      : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 font-medium">
                    <span className="truncate">{opt.shortLabel}</span>
                    {isPending && <Loader2 className="size-3 animate-spin shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Decoupled Model Stage / VRAM Loader Strip (only when an online GPU LLM VM exists) */}
        {onlineGpuLlmVm && (() => {
          const activeVmMeta = vms.find((v) => v.target === onlineGpuLlmVm.target)?.bootMetadata;
          const activeTransfer = activeVmMeta?.activeTransfer;
          const cachedFiles = activeVmMeta?.storageFiles ?? [];
          const diskFreeGb = activeVmMeta?.disk?.freeGb;
          return (
            <div className="border-t border-zinc-800/90 pt-3 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                  <span className="font-medium text-zinc-300">
                    Model Loader ({onlineGpuLlmVm.target.toUpperCase()}):
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    {onlineGpuLlmVm.loadedModel
                      ? `Active in VRAM: ${onlineGpuLlmVm.loadedModel}`
                      : onlineGpuLlmVm.runtimeMode === "loading_model"
                      ? `Loading ${onlineGpuLlmVm.activeModelName || "model"} into VRAM...`
                      : "Setup-only boot (0 models). Stage or Load a model before running local inference."}
                  </span>
                  {typeof diskFreeGb === "number" && (
                    <span className="rounded border border-zinc-800 bg-zinc-900/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                      /tmp free {diskFreeGb.toFixed(1)}G · {cachedFiles.length} file{cachedFiles.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={effectiveQuickPresetId}
                    disabled={Boolean(modelActionBusy)}
                    onChange={(e) => setSelectedPresetId(e.target.value)}
                    className="h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 outline-none focus:border-violet-500"
                  >
                    {LLM_MODEL_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.shortLabel} (~{p.approxDiskGb}G · {p.approxVramGb}G VRAM)
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(modelActionBusy)}
                    onClick={() => handleModelControlAction("stage_llm")}
                  >
                    {modelActionBusy === "stage_llm" && <Loader2 className="size-3 animate-spin" />}
                    Stage Disk
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={Boolean(modelActionBusy)}
                    onClick={() => handleModelControlAction("load_llm")}
                  >
                    {modelActionBusy === "load_llm" && <Loader2 className="size-3 animate-spin" />}
                    Load VRAM
                  </Button>
                  {onlineGpuLlmVm.loadedModel && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(modelActionBusy)}
                      onClick={() => handleModelControlAction("unload_llm")}
                      className="border-rose-500/35 text-rose-300 hover:bg-rose-500/15"
                    >
                      {modelActionBusy === "unload_llm" && <Loader2 className="size-3 animate-spin" />}
                      Unload
                    </Button>
                  )}
                </div>
              </div>
              {activeTransfer && (
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-3 py-2 text-[11px]">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-cyan-200">
                    <span className="truncate">
                      Downloading {activeTransfer.filename}
                      {(activeTransfer.queueCount ?? 1) > 1 ? ` (+${(activeTransfer.queueCount ?? 1) - 1} queued)` : ""}
                    </span>
                    <span className="shrink-0">
                      {activeTransfer.percentage}%
                      {activeTransfer.speedMbps ? ` · ${activeTransfer.speedMbps.toFixed(1)} MB/s` : ""}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full bg-cyan-400 transition-all duration-300"
                      style={{ width: `${Math.max(2, Math.min(100, activeTransfer.percentage))}%` }}
                    />
                  </div>
                </div>
              )}
              {activeVmMeta?.recentLog && (
                <div className="truncate font-mono text-[10px] text-zinc-500">
                  &gt; {activeVmMeta.recentLog}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* 4 Clean LLM Studio Workspace Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/70 p-1.5">
        {[
          { key: "playground" as const, label: "Playground & Test Bench", icon: Sparkles },
          { key: "arena" as const, label: "A/B Compare Arena", icon: GitCompare },
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

      {activeSubTab === "playground" && <PlaygroundPanel targetOptions={targetOptions} />}
      {activeSubTab === "arena" && <ArenaPanel targetOptions={targetOptions} />}
      {activeSubTab === "batch" && (
        <BatchEvalPanel
          targetOptions={targetOptions}
          isDualReplicaActive={isDualReplicaActive}
        />
      )}
      {activeSubTab === "workflows" && <WorkflowsChainPanel targetOptions={targetOptions} />}

      {/* Inline Kaggle Dual-T4 LLM Launcher */}
      <KaggleVmLauncherDialog
        open={launcherOpen}
        onOpenChange={setLauncherOpen}
        vms={vms}
        desiredProfile={launchProfile}
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
              Call Scriptoria from external apps, CI evals, or local agents via OpenAI SDK. Routes across Kaggle Dual-T4 (including Safe Headless Relay), TPU v5e-8, or Vault fallbacks.
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
                  <span className="text-zinc-400">Active Dual-T4 Topology</span>
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
  );
}
