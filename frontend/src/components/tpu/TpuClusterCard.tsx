"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Zap,
  Power,
  Terminal,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
  Cpu,
  Clock,
  Sparkles,
  Bot,
  Activity,
  CheckCircle2,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { TpuAccountSummary } from "@/app/api/vm/accounts/route";
import { VmLogsDialog } from "@/components/gpu/VmLogsDialog";
import { toast } from "sonner";

interface TpuClusterCardProps {
  account: TpuAccountSummary;
  vm: PublicVmInstance | undefined;
  globalIdleTimeoutMinutes?: number;
  onRefresh?: () => void;
}

const TPU_STEP_LABELS: Record<number, string> = {
  0: "Offline",
  1: "1/5 Verifying TPU v5e-8 Topology (8 chips)",
  2: "2/5 Initializing uv & PyTorch / XLA Runtime",
  3: "3/5 Mounting Qwen3.8-27B BF16 Weights",
  4: "4/5 Launching vLLM Engine on 8 Chips (:8000)",
  5: "5/5 Cloudflare Quick Tunnel Live",
};

const TPU_STEP_SHORT_LABELS: Record<number, string> = {
  1: "Topology",
  2: "uv Runtime",
  3: "Weights",
  4: "vLLM TPU",
  5: "Ready",
};

function formatHoursMinutes(seconds: number): string {
  const mins = Math.max(0, Math.floor(seconds / 60));
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins.toString().padStart(2, "0")}m`;
}

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return "--";
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m ${seconds % 60}s`;
}

export function TpuClusterCard({
  account,
  vm,
  globalIdleTimeoutMinutes = 15,
  onRefresh,
}: TpuClusterCardProps) {
  const [toggling, setToggling] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedOpenAi, setCopiedOpenAi] = useState(false);
  const [testingEndpoint, setTestingEndpoint] = useState(false);

  const target = vm?.target || account.target;
  const status = vm?.status || "OFFLINE";
  const isOnline = status === "ONLINE" || status === "BUSY";
  const isStarting = status === "STARTING";
  const step = vm?.stepProgress || 0;

  // TPU Quota (Kaggle allocates 20h per week for TPU v5e-8)
  const quota = account.quota;
  const tpuRemaining = quota?.tpuRemainingSeconds ?? 72000;
  const tpuTotal = quota?.tpuTotalAllowedSeconds ?? 72000;
  const tpuUsed = quota?.tpuUsedSeconds ?? 0;
  const quotaPercent = Math.min(100, Math.max(0, (tpuRemaining / (tpuTotal || 72000)) * 100));

  async function handleToggle(action: "start" | "stop") {
    setToggling(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Failed to ${action} TPU node`);
        return;
      }
      toast.success(
        action === "start"
          ? `Dispatched Kaggle TPU v5e-8 kernel (${account.accountAlias}). Booting in ~120s...`
          : `Stopped TPU node (${account.accountAlias}). Quota preserved.`
      );
      onRefresh?.();
    } catch {
      toast.error(`Network error attempting to ${action} TPU node`);
    } finally {
      setToggling(false);
    }
  }

  async function handleTestEndpoint() {
    if (!vm?.publicUrl) return;
    setTestingEndpoint(true);
    try {
      const res = await fetch(`${vm.publicUrl}/v1/models`);
      if (res.ok) {
        const body = await res.json();
        const modelCount = body.data?.length ?? 1;
        toast.success(`TPU vLLM online! Serving ${modelCount} unquantized model(s).`);
      } else {
        toast.error(`TPU endpoint responded with HTTP ${res.status}`);
      }
    } catch {
      toast.error("Endpoint test failed or tunnel handshake timed out.");
    } finally {
      setTestingEndpoint(false);
    }
  }

  function handleCopy(text: string, type: "url" | "openai") {
    navigator.clipboard.writeText(text);
    if (type === "url") {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
      toast.success("Copied TPU Ingress URL");
    } else {
      setCopiedOpenAi(true);
      setTimeout(() => setCopiedOpenAi(false), 2000);
      toast.success("Copied OpenAI Base URL (/v1)");
    }
  }

  const effectiveIdle = vm?.idleTimeoutMinutes ?? globalIdleTimeoutMinutes;

  return (
    <div className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-zinc-800 bg-[#0f0f13] p-4 transition-all hover:border-amber-500/30">
      {/* Background Glow when Online */}
      {isOnline && (
        <div className="pointer-events-none absolute -top-12 -right-12 h-36 w-36 rounded-full bg-amber-500/10 blur-3xl" />
      )}

      {/* Top Header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                isOnline
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-400"
                  : isStarting
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300 animate-pulse"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400"
              }`}
            >
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">
                  Kaggle {account.accountAlias.toUpperCase()}
                </span>
                <span className="font-mono text-xs text-zinc-400">
                  {account.username ? `@${account.username}` : "(Not configured)"}
                </span>
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/30">
                  TPU v5e-8
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 font-mono">
                Slot {target.toUpperCase()} &bull; 8 Chips &bull; 128 GB HBM
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                isOnline
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : isStarting
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse"
                  : status === "ERROR"
                  ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700/50"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isOnline
                    ? "bg-emerald-400 animate-pulse"
                    : isStarting
                    ? "bg-amber-400 animate-ping"
                    : status === "ERROR"
                    ? "bg-rose-400"
                    : "bg-zinc-500"
                }`}
              />
              {status}
            </span>
          </div>
        </div>

        {/* Quota & Error Banner */}
        {account.quotaError ? (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{account.quotaError}</span>
            </div>
            <Link
              href="/settings"
              className="shrink-0 rounded bg-rose-500/20 px-2 py-0.5 text-[11px] font-medium text-rose-200 hover:bg-rose-500/30"
            >
              Fix in Settings
            </Link>
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-zinc-500" />
                Weekly TPU Quota:
              </span>
              <span className="font-mono text-zinc-200 font-medium">
                {formatHoursMinutes(tpuRemaining)}{" "}
                <span className="text-zinc-500 font-normal">/ {formatHoursMinutes(tpuTotal)}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full transition-all ${
                  quotaPercent > 40
                    ? "bg-amber-500"
                    : quotaPercent > 15
                    ? "bg-yellow-500"
                    : "bg-rose-500"
                }`}
                style={{ width: `${quotaPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Hardware & Serving Specs Spec Strip */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2">
            <span className="block text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
              HBM Memory
            </span>
            <span className="font-mono text-zinc-200 font-medium">
              {isOnline ? `${(vm?.vramUsedGb || 0).toFixed(1)} / 128G` : "128 GB"}
            </span>
          </div>

          <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2">
            <span className="block text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
              Serving Engine
            </span>
            <span className="font-mono text-amber-300 font-medium truncate block">
              vLLM TPU v5e
            </span>
          </div>

          <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2">
            <span className="block text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
              Model
            </span>
            <span className="font-mono text-zinc-200 font-medium truncate block" title="Qwen3.8-27B BF16 Unquantized">
              Qwen 27B BF16
            </span>
          </div>

          <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2">
            <span className="block text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
              Speculative MTP
            </span>
            <span className="font-mono text-emerald-400 font-medium">
              ~130 tok/s
            </span>
          </div>
        </div>

        {/* 5-Step Boot Progress Tracker (When STARTING) */}
        {isStarting && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-amber-300 flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {TPU_STEP_LABELS[step] || `Booting TPU (${step}/5)...`}
              </span>
              <span className="font-mono text-[11px] text-zinc-400">
                Step {step} of 5
              </span>
            </div>

            {/* Stepper pills */}
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {[1, 2, 3, 4, 5].map((s) => {
                const isPassed = step > s;
                const isCurrent = step === s;
                return (
                  <div
                    key={s}
                    className={`rounded px-1.5 py-1 text-center text-[10px] font-mono transition-all ${
                      isPassed
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        : isCurrent
                        ? "bg-amber-500/30 text-amber-200 border border-amber-500/50 animate-pulse font-semibold"
                        : "bg-zinc-800/60 text-zinc-500 border border-zinc-800"
                    }`}
                  >
                    {TPU_STEP_SHORT_LABELS[s]}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Online Ingress & API Keys Strip (When ONLINE) */}
        {isOnline && vm?.publicUrl && (
          <div className="mt-3 space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-300">
                  TPU Inference Tunnel Active
                </span>
                <span className="font-mono text-[10px] text-zinc-400">
                  (Uptime: {formatUptime(vm.onlineSince ? Math.floor((Date.now() - new Date(vm.onlineSince).getTime()) / 1000) : 0)})
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleTestEndpoint}
                  disabled={testingEndpoint}
                  className="inline-flex h-6 items-center gap-1 rounded bg-zinc-800 px-2 text-[10px] font-medium text-zinc-200 hover:bg-zinc-700"
                >
                  {testingEndpoint ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                  <span>Ping /v1</span>
                </button>
                <Link
                  href={`/llm-studio?target=${encodeURIComponent(target)}`}
                  className="inline-flex h-6 items-center gap-1 rounded bg-amber-600 px-2 text-[10px] font-medium text-white hover:bg-amber-500"
                >
                  <Bot className="h-3 w-3" />
                  <span>Open in LLM Studio</span>
                </Link>
              </div>
            </div>

            {/* Quick URL copy buttons */}
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 pt-1">
              <div className="flex items-center justify-between rounded bg-zinc-900/80 px-2.5 py-1 text-xs border border-zinc-800">
                <span className="text-[11px] text-zinc-400 truncate max-w-[200px]" title={vm.publicUrl}>
                  {vm.publicUrl}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(vm.publicUrl, "url")}
                  className="text-zinc-400 hover:text-white"
                  title="Copy Ingress URL"
                >
                  {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>

              <div className="flex items-center justify-between rounded bg-zinc-900/80 px-2.5 py-1 text-xs border border-zinc-800">
                <span className="text-[11px] text-amber-300 font-mono truncate max-w-[200px]" title={`${vm.publicUrl}/v1`}>
                  {`${vm.publicUrl}/v1`}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(`${vm.publicUrl}/v1`, "openai")}
                  className="text-zinc-400 hover:text-white"
                  title="Copy OpenAI Base URL"
                >
                  {copiedOpenAi ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-3">
        <div className="flex items-center gap-2">
          {isOnline ? (
            <button
              type="button"
              onClick={() => handleToggle("stop")}
              disabled={toggling}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 text-xs font-semibold text-rose-300 hover:bg-rose-500/25 transition"
            >
              {toggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
              <span>Stop TPU</span>
            </button>
          ) : isStarting ? (
            <button
              type="button"
              onClick={() => handleToggle("stop")}
              disabled={toggling}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 transition"
            >
              {toggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
              <span>Abort Boot</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleToggle("start")}
              disabled={toggling || !account.configured}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 px-3.5 text-xs font-semibold text-white shadow-md shadow-amber-950/40 hover:from-amber-500 hover:to-amber-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {toggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              <span>Boot TPU Node</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setLogsOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition"
          >
            <Terminal className="h-3.5 w-3.5 text-zinc-400" />
            <span>Logs</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">Watchdog:</span>
          <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-300 border border-zinc-800">
            {effectiveIdle === 0 ? "Off" : `${effectiveIdle}m`}
          </span>
        </div>
      </div>

      {/* Logs Modal Dialog */}
      <VmLogsDialog
        target={target}
        open={logsOpen}
        onOpenChange={setLogsOpen}
      />
    </div>
  );
}
