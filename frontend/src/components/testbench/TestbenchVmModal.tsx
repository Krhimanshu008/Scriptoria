"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Cpu,
  Power,
  RefreshCw,
  Zap,
  Globe,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Flame,
  ShieldCheck,
  Server,
  Loader2,
  Clock,
  Sparkles,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary, ColabAccountSummary } from "@/app/api/vm/accounts/route";
import { WORKER_PROFILE_LIST, getWorkerProfile, WorkerProfileId } from "@/lib/catalog/worker-profiles";
import { toast } from "sonner";

interface TestbenchVmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vms: PublicVmInstance[];
  kaggleAccounts?: KaggleAccountSummary[];
  colabAccounts?: ColabAccountSummary[];
  onRefresh: () => void;
}

export function TestbenchVmModal({
  open,
  onOpenChange,
  vms,
  kaggleAccounts = [],
  colabAccounts = [],
  onRefresh,
}: TestbenchVmModalProps) {
  const [selectedTarget, setSelectedTarget] = useState<string>("gpu0");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Group VMs by target
  const currentVm = vms.find((v) => v.target === selectedTarget) || vms[0];
  const isOnline = currentVm?.status === "ONLINE" || currentVm?.status === "BUSY";
  const isStarting = currentVm?.status === "STARTING";

  // Filter LLM relevant profiles
  const llmProfiles = WORKER_PROFILE_LIST.filter(
    (p) =>
      p.id.startsWith("LLM_") ||
      p.id.startsWith("TPU_") ||
      p.id === "BASE_COMFY"
  );

  const handleToggleVm = async (target: string, isKill = false) => {
    setActionLoading(target);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/toggle`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Failed to toggle ${target}`);
        return;
      }
      toast.success(data.message || `Command sent to ${target}`);
      onRefresh();
    } catch (err: any) {
      toast.error(`Network error: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSyncVm = async (target: string) => {
    setActionLoading(target);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/sync`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync request failed");
      toast.success(`VM status synced: ${data.status} (Tunnel: ${data.tunnelAlive ? "Live" : "Inactive"})`);
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to sync VM");
    } finally {
      setActionLoading(null);
    }
  };

  const handleProfileChange = async (target: string, nextProfile: string) => {
    setSavingProfile(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerProfile: nextProfile }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to update profile");
        return;
      }
      toast.success(`Profile updated to ${getWorkerProfile(nextProfile).shortTag}`);
      onRefresh();
    } catch (err: any) {
      toast.error("Profile update failed: " + err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const getQuotaForTarget = (target: string) => {
    if (target.startsWith("gpu")) {
      const match = kaggleAccounts.find((k) => k.targets?.includes(target) || k.gpuTargets?.includes(target));
      if (match?.quota?.remainingSeconds != null) {
        const hrs = Math.floor(match.quota.remainingSeconds / 3600);
        const mins = Math.floor((match.quota.remainingSeconds % 3600) / 60);
        return `${hrs}h ${mins}m left`;
      }
    }
    return "30h / week";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-zinc-800 bg-[#0d0d11] p-6 text-zinc-100 shadow-2xl sm:max-w-2xl">
        <DialogHeader className="border-b border-zinc-800/80 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <Cpu className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-zinc-100">
                  Cloud VM Swarm & Worker Control
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-400">
                  Manage Kaggle Dual-T4, Google Colab, and TPU compute instances without leaving Testbench.
                </DialogDescription>
              </div>
            </div>

            <button
              onClick={onRefresh}
              className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition"
              title="Refresh Cluster Status"
            >
              <RefreshCw className="h-3 w-3" />
              Sync
            </button>
          </div>
        </DialogHeader>

        {/* Quick Launch & Profile Configuration */}
        <div className="mt-2 space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Target Instance & Architecture
              </span>
              <span className="text-[11px] font-mono text-zinc-500">
                {currentVm ? `Status: ${currentVm.status}` : ""}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Target Selector */}
              <div>
                <label className="text-[11px] font-medium text-zinc-400 mb-1 block">
                  Select Target Machine
                </label>
                <select
                  value={selectedTarget}
                  onChange={(e) => setSelectedTarget(e.target.value)}
                  className="w-full h-8.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  {vms.map((v) => (
                    <option key={v.target} value={v.target}>
                      {v.target.toUpperCase()} ({v.provider.toUpperCase()} · {v.accountAlias}) — {v.status}
                    </option>
                  ))}
                  {vms.length === 0 && (
                    <>
                      <option value="gpu0">GPU0 (Kaggle Dual-T4 · acc1)</option>
                      <option value="gpu2">GPU2 (Kaggle Dual-T4 · acc2)</option>
                      <option value="gcgpu">GCGPU (Google Colab T4)</option>
                      <option value="tpu0">TPU0 (Kaggle TPU v5e-8)</option>
                    </>
                  )}
                </select>
              </div>

              {/* Profile Selector */}
              <div>
                <label className="text-[11px] font-medium text-zinc-400 mb-1 block">
                  Worker LLM Profile
                </label>
                <select
                  value={currentVm?.workerProfile || "LLM_LIGHTWEIGHT_SWARM"}
                  onChange={(e) => handleProfileChange(selectedTarget, e.target.value)}
                  disabled={savingProfile}
                  className="w-full h-8.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  {llmProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.shortTag}: {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Profile Brief Info */}
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5 text-[11px] text-zinc-400 leading-relaxed">
              <span className="font-semibold text-zinc-200">
                {getWorkerProfile(currentVm?.workerProfile || "LLM_LIGHTWEIGHT_SWARM").label}:
              </span>{" "}
              {getWorkerProfile(currentVm?.workerProfile || "LLM_LIGHTWEIGHT_SWARM").description}
            </div>

            {/* Primary Action Button (Dynamically toggles Boot vs Kill) */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Clock className="h-3.5 w-3.5 text-zinc-500" />
                <span>Quota: {getQuotaForTarget(selectedTarget)}</span>
              </div>

              <div className="flex items-center gap-2">
                {isOnline && (
                  <button
                    onClick={() => handleSyncVm(selectedTarget)}
                    disabled={actionLoading === selectedTarget}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${actionLoading === selectedTarget ? "animate-spin" : ""}`} />
                    Sync
                  </button>
                )}

                {/* THE DYNAMIC BOOT / KILL BUTTON */}
                {isOnline ? (
                  <button
                    onClick={() => handleToggleVm(selectedTarget, true)}
                    disabled={actionLoading === selectedTarget}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-red-700/80 bg-red-950/80 px-4 text-xs font-semibold text-red-300 hover:bg-red-900 hover:border-red-500 transition shadow-sm"
                  >
                    <Power className={`h-3.5 w-3.5 ${actionLoading === selectedTarget ? "animate-spin" : ""}`} />
                    🛑 Stop / Terminate
                  </button>
                ) : isStarting ? (
                  <button
                    onClick={() => handleToggleVm(selectedTarget, true)}
                    disabled={actionLoading === selectedTarget}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-600/80 bg-amber-950/80 px-4 text-xs font-semibold text-amber-300 hover:bg-amber-900 transition shadow-sm"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Starting (Step {currentVm?.stepProgress || 1}/5) · Cancel
                  </button>
                ) : (
                  <button
                    onClick={() => handleToggleVm(selectedTarget, false)}
                    disabled={actionLoading === selectedTarget}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-500 bg-amber-500 px-4 text-xs font-semibold text-zinc-950 hover:bg-amber-400 transition shadow-sm"
                  >
                    <Zap className={`h-3.5 w-3.5 ${actionLoading === selectedTarget ? "animate-spin" : ""}`} />
                    ⚡ Boot {selectedTarget.toUpperCase()}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Quick Target Fleet Overview */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 px-1">
              Configured Machine Fleet
            </span>
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {vms.map((v) => {
                const isTargetOnline = v.status === "ONLINE" || v.status === "BUSY";
                const isTargetStarting = v.status === "STARTING";
                const profile = getWorkerProfile(v.workerProfile);

                return (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition ${
                      v.target === selectedTarget
                        ? "border-amber-500/40 bg-zinc-900/80"
                        : "border-zinc-800/80 bg-zinc-950/40 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setSelectedTarget(v.target)}
                        className="font-mono font-bold text-zinc-200 hover:text-amber-400"
                      >
                        {v.target.toUpperCase()}
                      </button>

                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          isTargetOnline
                            ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800"
                            : isTargetStarting
                            ? "bg-amber-950/80 text-amber-400 border border-amber-800 animate-pulse"
                            : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                        }`}
                      >
                        {v.status}
                      </span>

                      <span className="text-[11px] text-zinc-400 truncate max-w-[130px]" title={profile.label}>
                        {profile.shortTag}
                      </span>

                      {v.publicUrl && (
                        <a
                          href={v.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-[10px] text-cyan-400 hover:underline"
                        >
                          Tunnel
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isTargetOnline ? (
                        <button
                          onClick={() => handleToggleVm(v.target, true)}
                          disabled={actionLoading === v.target}
                          className="rounded border border-red-800/60 bg-red-950/40 px-2 py-1 text-[11px] font-medium text-red-300 hover:bg-red-900/60 transition"
                        >
                          Stop
                        </button>
                      ) : isTargetStarting ? (
                        <span className="text-[11px] text-amber-400 animate-pulse">
                          Step {v.stepProgress || 1}/5
                        </span>
                      ) : (
                        <button
                          onClick={() => handleToggleVm(v.target, false)}
                          disabled={actionLoading === v.target}
                          className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-amber-400 hover:bg-zinc-700 hover:text-amber-300 transition"
                        >
                          Boot
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
