"use client";

import React, { useState } from "react";
import {
  Power,
  Skull,
  Activity,
  Cpu,
  Download,
  ListChecks,
  Loader2,
  AlertTriangle,
  Clock,
  ExternalLink,
  Terminal,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { VmLogsDialog } from "@/components/gpu/VmLogsDialog";
import { toast } from "sonner";

interface GpuCardProps {
  vm: PublicVmInstance;
  onRefresh: () => void;
  onColabReady?: (downloadUrl: string, target: string) => void;
}

const STEP_LABELS: Record<number, string> = {
  0: "Idle / Stopped",
  1: "1/5: Kernel Triggered",
  2: "2/5: Rclone & Storage Ready",
  3: "3/5: ComfyUI Installing",
  4: "4/5: Caddy Tunnel Up",
  5: "5/5: Online & Ready",
};

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return "--";
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m ${seconds % 60}s`;
}

export const GpuCard: React.FC<GpuCardProps> = ({ vm, onRefresh, onColabReady }) => {
  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  const vramTotal = vm.vramTotalGb || 16;
  const vramUsed = vm.vramUsedGb || 0;
  const vramPct = Math.min(100, Math.round((vramUsed / vramTotal) * 100));

  const isOnline = vm.status === "ONLINE" || vm.status === "BUSY";
  const isStarting = vm.status === "STARTING";

  async function triggerToggle(confirmKill = false) {
    if (confirmKill && !confirm(`Trigger immediate Zero-Quota kill for ${vm.sessionGroup}?`)) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/vm/${vm.target}/toggle`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Failed to toggle ${vm.target}`);
        return;
      }

      if (data.colabNotebookUrl) {
        toast.success(`Colab notebook ready for ${vm.target}`);
        onColabReady?.(data.colabNotebookUrl, vm.target);
      } else {
        toast.success(data.message || `Updated ${vm.target}`);
      }
      onRefresh();
    } catch {
      toast.error(`Network error toggling ${vm.target}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchCatalog() {
    setCatalogLoading(true);
    try {
      const res = await fetch(`/api/vm/${vm.target}/catalog`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Catalog unavailable for ${vm.target}`);
        return;
      }
      toast.success(
        `${vm.target.toUpperCase()} Catalog: ${data.models?.checkpoints?.length || 0} checkpoints, ${data.totalNodesAvailable || 0} nodes`
      );
    } catch {
      toast.error(`Failed to reach ${vm.target} catalog`);
    } finally {
      setCatalogLoading(false);
    }
  }

  return (
    <div
      className={`flex flex-col justify-between rounded-2xl border p-5 shadow-xl transition-all ${
        isOnline
          ? "border-emerald-500/40 bg-zinc-900/90"
          : isStarting
          ? "border-amber-500/40 bg-zinc-900/90"
          : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
      }`}
    >
      <div>
        {/* Card Header */}
        <div className="flex items-start justify-between border-b border-zinc-800/80 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-700/70 bg-zinc-900 text-indigo-400">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-mono text-sm font-bold uppercase tracking-tight text-white">
                  {vm.target}
                </h3>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                  {vm.provider}/{vm.accountAlias} · :{vm.internalPort}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">{vm.displayName}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1">
            <span
              className={`h-2 w-2 rounded-full ${
                isOnline
                  ? "bg-emerald-500 shadow-[0_0_8px_#10b981]"
                  : isStarting
                  ? "animate-pulse bg-amber-500"
                  : vm.status === "ERROR"
                  ? "bg-rose-500"
                  : "bg-zinc-600"
              }`}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-200">
              {vm.status}
            </span>
          </div>
        </div>

        {/* Error notice */}
        {vm.lastError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-950/30 p-2 text-[11px] text-rose-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-2">{vm.lastError}</span>
          </div>
        )}

        {/* 5-step progress */}
        <div className="my-4">
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>Provisioning Phase</span>
            <span className="font-medium text-zinc-200">
              {STEP_LABELS[vm.stepProgress] || "Idle"}
            </span>
          </div>
          <div className="mt-1.5 flex gap-1">
            {[1, 2, 3, 4, 5].map((step) => (
              <div
                key={step}
                className={`h-1.5 flex-1 rounded-sm transition-all duration-300 ${
                  step <= vm.stepProgress
                    ? isOnline
                      ? "bg-emerald-500"
                      : "bg-indigo-500"
                    : "bg-zinc-800"
                }`}
              />
            ))}
          </div>
        </div>

        {/* VRAM Gauge */}
        <div className="my-4 space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-zinc-400">
              VRAM ({vm.gpuName || "T4 16GB"})
            </span>
            <span className="font-mono text-zinc-200">
              {vramUsed.toFixed(1)} / {vramTotal.toFixed(1)} GB ({vramPct}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full transition-all duration-500 ${
                vramPct > 85 ? "bg-rose-500" : "bg-emerald-500"
              }`}
              style={{ width: `${vramPct}%` }}
            />
          </div>
        </div>

        {/* Telemetry & Tunnel */}
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Activity className="h-3.5 w-3.5 text-zinc-500" />
              {isOnline && vm.latencyMs != null ? `${vm.latencyMs}ms` : "--"}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-zinc-500" />
              {formatUptime(vm.uptimeSeconds)}
            </span>
          </div>
          <span className="truncate font-mono text-[10px] text-zinc-500 max-w-[150px]">
            {vm.publicUrl ? vm.publicUrl.replace(/^https?:\/\//, "") : "Caddy Route-less"}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-5 space-y-2 border-t border-zinc-800/80 pt-4">
        <div className="flex gap-2">
          <button
            onClick={() => triggerToggle(false)}
            disabled={loading}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${
              isOnline || isStarting
                ? "border border-amber-500/30 bg-amber-600/20 text-amber-300 hover:bg-amber-600/30"
                : "bg-indigo-600 text-white hover:bg-indigo-500"
            }`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Power className="h-4 w-4" />
            )}
            {isOnline || isStarting
              ? "Graceful Stop"
              : vm.provider === "colab"
              ? "Arm Colab Node"
              : "Boot Cluster Node"}
          </button>

          <button
            onClick={() => triggerToggle(true)}
            disabled={loading || vm.status === "OFFLINE"}
            title="Zero-Quota In-Band Kill (:9999 /vm-kill)"
            className="flex items-center justify-center rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs font-semibold text-rose-400 transition hover:bg-rose-900/50 disabled:opacity-40"
          >
            <Skull className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleFetchCatalog}
            disabled={!isOnline || catalogLoading}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40"
          >
            {catalogLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ListChecks className="h-3.5 w-3.5 text-indigo-400" />
            )}
            Catalog
          </button>

          <a
            href={isOnline ? `/api/vm/${vm.target}/webui` : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!isOnline}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] transition ${
              isOnline
                ? "text-emerald-300 hover:bg-zinc-800"
                : "pointer-events-none opacity-40 text-zinc-500"
            }`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            ComfyUI
          </a>

          <button
            onClick={() => setLogsOpen(true)}
            className="flex items-center justify-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-300 transition hover:bg-zinc-800"
          >
            <Terminal className="h-3.5 w-3.5 text-zinc-400" />
            Logs
          </button>

          {vm.provider === "colab" && (
            <a
              href={`/api/vm/colab/${vm.target}/notebook`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-amber-300 transition hover:bg-zinc-800"
            >
              <Download className="h-3.5 w-3.5" />
              .ipynb
            </a>
          )}
        </div>
      </div>

      <VmLogsDialog target={vm.target} open={logsOpen} onOpenChange={setLogsOpen} />
    </div>
  );
};

