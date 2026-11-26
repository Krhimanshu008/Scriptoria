"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cpu,
  Power,
  Skull,
  Loader2,
  CheckCircle2,
  Zap,
  ExternalLink,
  Server,
  Clock,
  RefreshCw,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary } from "@/app/api/vm/accounts/route";
import {
  WORKER_PROFILE_LIST,
  getWorkerProfile,
  isLlmWorkerProfile,
  type WorkerProfileId,
} from "@/lib/catalog/worker-profiles";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface PrewarmModelRef {
  slug?: string;
  category: string;
  filename: string;
}

export interface EnrichedKaggleAccount {
  alias: string;
  displayName: string;
  username: string | null;
  configured: boolean;
  primaryTarget: string;
  targets: string[];
  vms: PublicVmInstance[];
  isOnline: boolean;
  isStarting: boolean;
  isError: boolean;
  maxStep: number;
  remainingSeconds: number;
  totalAllowedSeconds: number;
  activeProfile: string;
  lastError?: string | null;
  quotaError?: string | null;
}

const STEP_LABELS: Record<number, string> = {
  0: "Offline",
  1: "1/5 · Kernel Queued",
  2: "2/5 · FastBoot & Deps",
  3: "3/5 · Installing Nodes",
  4: "4/5 · Tunnel & ComfyUI",
  5: "5/5 · Online & Ready",
};

export function formatQuotaHrs(seconds: number): string {
  const mins = Math.max(0, Math.floor(seconds / 60));
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${(mins % 60).toString().padStart(2, "0")}m`;
}

/**
 * Shared React Query hook joining configured Kaggle accounts (`/api/vm/accounts`)
 * with live VM slots (`/api/vm/status`) and auto-polling during boot transitions.
 */
export function useKaggleClusterAccounts(vms: PublicVmInstance[]) {
  const queryClient = useQueryClient();

  const anyStarting = vms.some((v) => v.status === "STARTING");
  const {
    data: accountsData,
    isFetching: loadingAccounts,
    refetch: refetchAccounts,
  } = useQuery<{ kaggleAccounts: KaggleAccountSummary[] }>({
    queryKey: ["vm-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/vm/accounts");
      if (!res.ok) throw new Error("Failed to fetch Kaggle accounts");
      return res.json();
    },
    staleTime: 25_000,
    refetchInterval: anyStarting ? 5000 : false,
  });

  const enriched = useMemo<EnrichedKaggleAccount[]>(() => {
    const raw = accountsData?.kaggleAccounts ?? [];
    const byAlias = new Map<string, PublicVmInstance[]>();
    for (const vm of vms) {
      if (vm.provider !== "kaggle" || vm.target.startsWith("tpu")) continue;
      const list = byAlias.get(vm.accountAlias) || [];
      list.push(vm);
      byAlias.set(vm.accountAlias, list);
    }

    return raw.map((acc) => {
      const slotVms = (byAlias.get(acc.accountAlias) || []).sort((a, b) =>
        a.target.localeCompare(b.target)
      );
      const targets = slotVms.length > 0 ? slotVms.map((v) => v.target) : acc.gpuTargets || acc.targets || [];
      const primaryTarget = targets[0] || "gpu0";
      const isOnline = slotVms.some((v) => v.status === "ONLINE" || v.status === "BUSY");
      const isStarting = !isOnline && slotVms.some((v) => v.status === "STARTING");
      const isError = !isOnline && !isStarting && slotVms.some((v) => v.status === "ERROR");
      const maxStep = slotVms.reduce((m, v) => Math.max(m, v.stepProgress || 0), 0);
      const totalAllowed = acc.quota?.totalAllowedSeconds ?? 108_000;
      const remaining = acc.quota?.remainingSeconds ?? totalAllowed;

      return {
        alias: acc.accountAlias,
        displayName: acc.displayName || acc.username || "Personal Kaggle",
        username: acc.username,
        configured: acc.configured,
        primaryTarget,
        targets,
        vms: slotVms,
        isOnline,
        isStarting,
        isError,
        maxStep,
        remainingSeconds: remaining,
        totalAllowedSeconds: totalAllowed,
        activeProfile: slotVms[0]?.workerProfile || "BASE_COMFY",
        lastError: slotVms.find((v) => v.lastError)?.lastError,
        quotaError: acc.quotaError || null,
      };
    });
  }, [accountsData, vms]);

  const configuredAccounts = useMemo(
    () => enriched.filter((a) => a.configured),
    [enriched]
  );

  const bestOfflineAccount = useMemo(() => {
    const offline = configuredAccounts.filter((a) => !a.isOnline && !a.isStarting);
    const healthy = offline.filter((a) => !a.quotaError);
    const pool = healthy.length > 0 ? healthy : offline;
    return [...pool].sort((a, b) => b.remainingSeconds - a.remainingSeconds)[0] || null;
  }, [configuredAccounts]);

  const refreshCluster = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["vm-status"] }),
      queryClient.invalidateQueries({ queryKey: ["vm-accounts"] }),
    ]);
  };

  return {
    allKaggleAccounts: enriched,
    configuredAccounts,
    bestOfflineAccount,
    loadingAccounts,
    refetchAccounts,
    refreshCluster,
  };
}

/**
 * Optionally sets workerProfile + prewarmModels via PATCH /profile, then boots the Kaggle Dual-T4 session.
 */
export async function bootKaggleAccount(params: {
  primaryTarget: string;
  alias: string;
  workerProfile?: WorkerProfileId | string;
  currentProfile?: string;
  prewarmModels?: PrewarmModelRef[];
  workerMode?: "headless_safe" | "interactive_tunnel";
}): Promise<boolean> {
  const {
    primaryTarget,
    alias,
    workerProfile,
    currentProfile,
    prewarmModels,
    workerMode = "headless_safe",
  } = params;

  const needProfilePatch =
    (workerProfile && workerProfile !== currentProfile) ||
    (prewarmModels && prewarmModels.length > 0);

  if (needProfilePatch) {
    const patchBody: Record<string, unknown> = { applyToGroup: true };
    if (workerProfile && workerProfile !== currentProfile) {
      patchBody.workerProfile = workerProfile;
    }
    if (prewarmModels && prewarmModels.length > 0) {
      patchBody.prewarmModels = prewarmModels.slice(0, 3);
    }
    const pRes = await fetch(`/api/vm/${encodeURIComponent(primaryTarget)}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    });
    if (!pRes.ok) {
      const pErr = await pRes.json().catch(() => ({}));
      toast.error(pErr.error || `Failed updating profile on Kaggle ${alias}`);
      return false;
    }
  }

  const res = await fetch(`/api/vm/${encodeURIComponent(primaryTarget)}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "boot", workerMode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast.error(data.error || `Failed booting Kaggle ${alias}`);
    return false;
  }

  toast.success(
    `Booting Kaggle worker (${workerProfile || currentProfile || "IMAGE_CORE"}) -> ${primaryTarget.toUpperCase()}!`
  );
  return true;
}

export async function killKaggleAccount(primaryTarget: string, alias: string, force = true): Promise<boolean> {
  const res = await fetch(`/api/vm/${encodeURIComponent(primaryTarget)}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "kill", force }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast.error(data.error || `Failed stopping Kaggle ${alias}`);
    return false;
  }
  toast.success(`Stopped Kaggle ${alias.toUpperCase()} (${primaryTarget.toUpperCase()})`);
  return true;
}

interface KaggleVmLauncherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vms: PublicVmInstance[];
  desiredProfile?: WorkerProfileId;
  prewarmModels?: PrewarmModelRef[];
  onTargetSelected?: (target: string) => void;
}

/**
 * In-Studio Kaggle Dual-T4 Launcher & Quota Manager for all configured Kaggle accounts.
 */
export function KaggleVmLauncherDialog({
  open,
  onOpenChange,
  vms,
  desiredProfile,
  prewarmModels,
  onTargetSelected,
}: KaggleVmLauncherDialogProps) {
  const {
    allKaggleAccounts,
    configuredAccounts,
    bestOfflineAccount,
    loadingAccounts,
    refreshCluster,
  } = useKaggleClusterAccounts(vms);

  const [busyAlias, setBusyAlias] = useState<string | null>(null);
  const [matchWorkflowProfile, setMatchWorkflowProfile] = useState(true);
  const [attachPrewarm, setAttachPrewarm] = useState(true);
  const [workerMode, setWorkerMode] = useState<"headless_safe" | "interactive_tunnel">("headless_safe");
  const [profileOverrides, setProfileOverrides] = useState<Record<string, string>>({});

  const imageProfiles = WORKER_PROFILE_LIST.filter((p) => !isLlmWorkerProfile(p.id) && p.accelerator !== "tpu");

  async function handleBootOne(acc: EnrichedKaggleAccount) {
    setBusyAlias(acc.alias);
    try {
      const targetProfile =
        profileOverrides[acc.alias] ||
        (matchWorkflowProfile && desiredProfile ? desiredProfile : acc.activeProfile);
      const ok = await bootKaggleAccount({
        primaryTarget: acc.primaryTarget,
        alias: acc.alias,
        workerProfile: targetProfile,
        currentProfile: acc.activeProfile,
        prewarmModels: attachPrewarm ? prewarmModels : undefined,
        workerMode,
      });
      if (ok && onTargetSelected) {
        onTargetSelected(acc.primaryTarget);
      }
      await refreshCluster();
    } finally {
      setBusyAlias(null);
    }
  }

  async function handleKillOne(acc: EnrichedKaggleAccount) {
    setBusyAlias(acc.alias);
    try {
      await killKaggleAccount(acc.primaryTarget, acc.alias, true);
      await refreshCluster();
    } finally {
      setBusyAlias(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-popover max-w-2xl border-white/15 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-cyan-400" />
            Studio Kaggle Dual-T4 VM Launcher ({configuredAccounts.length} Accounts Linked)
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            Boot any attached Kaggle Dual-T4 account directly from Studio, auto-matching your active workflow profile &amp; pre-warming needed checkpoints.
          </DialogDescription>
        </DialogHeader>

        {/* Top Match & Batch Boot Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-xs">
          <div className="space-y-1 text-zinc-300">
            {desiredProfile && (
              <label className="flex cursor-pointer items-center gap-2 text-zinc-200">
                <input
                  type="checkbox"
                  checked={matchWorkflowProfile}
                  onChange={(e) => setMatchWorkflowProfile(e.target.checked)}
                />
                <span>
                  Auto-set profile to{" "}
                  <strong className="font-mono text-indigo-300">{desiredProfile}</strong> (
                  {getWorkerProfile(desiredProfile).shortTag})
                </span>
              </label>
            )}
            {prewarmModels && prewarmModels.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
                <input
                  type="checkbox"
                  checked={attachPrewarm}
                  onChange={(e) => setAttachPrewarm(e.target.checked)}
                />
                <span>
                  Pre-warm {Math.min(3, prewarmModels.length)} workflow model(s) into `/tmp/models` on boot
                </span>
              </label>
            )}
            {!desiredProfile && (!prewarmModels || prewarmModels.length === 0) && (
              <span className="text-[11px] text-zinc-400">
                Choose a Kaggle account below or click <strong>Boot Best</strong> to start a Dual-T4 VM.
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {bestOfflineAccount && (
              <Button
                type="button"
                size="sm"
                disabled={Boolean(busyAlias)}
                onClick={() => handleBootOne(bestOfflineAccount)}
                className="h-8 bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-500"
              >
                {busyAlias === bestOfflineAccount.alias ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="mr-1.5 h-3.5 w-3.5" />
                )}
                Boot Best ({bestOfflineAccount.displayName})
              </Button>
            )}


          </div>
        </div>

        {/* Kaggle Execution Mode Selector (Protects against Tunnel/Proxy Bans) */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-emerald-300">
              <input
                type="radio"
                name="kaggleWorkerMode"
                checked={workerMode === "headless_safe"}
                onChange={() => setWorkerMode("headless_safe")}
              />
              <span>Safe Headless Mode (No Tunnel · Batch + Studio Ready)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-zinc-400">
              <input
                type="radio"
                name="kaggleWorkerMode"
                checked={workerMode === "interactive_tunnel"}
                onChange={() => setWorkerMode("interactive_tunnel")}
              />
              <span>Interactive Tunnel Proxy (Higher Ban Risk)</span>
            </label>
          </div>
        </div>

        {/* Account Cards */}
        <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
          {configuredAccounts.length === 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
              No configured Kaggle credentials found yet ({allKaggleAccounts.length} empty slots). Add Kaggle usernames &amp; API keys in{" "}
              <Link href="/settings/vault" className="font-semibold underline">
                Settings → Credential Vault
              </Link>
              .
            </div>
          ) : (
            configuredAccounts.map((acc) => {
              const effectiveProfile =
                profileOverrides[acc.alias] ||
                (matchWorkflowProfile && desiredProfile && !acc.isOnline && !acc.isStarting
                  ? desiredProfile
                  : acc.activeProfile);
              const pct = Math.min(
                100,
                Math.round((acc.remainingSeconds / Math.max(1, acc.totalAllowedSeconds)) * 100)
              );

              return (
                <div
                  key={acc.alias}
                  className={`space-y-2 rounded-lg border p-3 text-xs transition ${
                    acc.isOnline
                      ? "border-emerald-500/40 bg-emerald-500/[0.06]"
                      : acc.isStarting
                      ? "border-amber-500/40 bg-amber-500/[0.06]"
                      : acc.isError
                      ? "border-rose-500/40 bg-rose-500/[0.06]"
                      : "border-zinc-800 bg-zinc-950/90"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-cyan-300">
                        {acc.displayName}
                      </span>
                      <span className="font-medium text-white">{acc.username}</span>
                      <span className="font-mono text-[10px] text-zinc-400">
                        ({acc.targets.map((t) => t.toUpperCase()).join(" + ")})
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {acc.quotaError ? (
                        <span className="rounded-full bg-rose-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-300">
                          AUTH ERROR (401/403)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-400">
                          <Clock className="h-3 w-3 text-zinc-500" />
                          {formatQuotaHrs(acc.remainingSeconds)} ({pct}%)
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          acc.isOnline
                            ? "bg-emerald-500/20 text-emerald-300"
                            : acc.isStarting
                            ? "bg-amber-500/20 text-amber-200"
                            : acc.isError || acc.quotaError
                            ? "bg-rose-500/20 text-rose-300"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {acc.isOnline
                          ? "ONLINE"
                          : acc.isStarting
                          ? STEP_LABELS[acc.maxStep] || "STARTING"
                          : acc.isError
                          ? "ERROR"
                          : acc.quotaError
                          ? "RESTRICTED"
                          : "OFFLINE"}
                      </span>
                    </div>
                  </div>

                  {acc.quotaError && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-rose-500/35 bg-rose-950/35 px-2.5 py-1.5 text-[11px] text-rose-200">
                      <span>{acc.quotaError}</span>
                      <div className="flex items-center gap-2">
                        <a
                          href="https://www.kaggle.com/contact"
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold underline hover:text-white"
                        >
                          Appeal Ban
                        </a>
                        <Link href="/settings/vault" className="font-semibold underline hover:text-white">
                          Rotate Key in Vault
                        </Link>
                      </div>
                    </div>
                  )}

                  {acc.lastError && acc.isError && (
                    <p className="rounded border border-rose-500/30 bg-rose-950/40 px-2 py-1 text-[11px] text-rose-200">
                      {acc.lastError}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <select
                      disabled={acc.isOnline || acc.isStarting}
                      value={effectiveProfile}
                      onChange={(e) =>
                        setProfileOverrides((prev) => ({ ...prev, [acc.alias]: e.target.value }))
                      }
                      className="glass-input h-8 min-w-0 w-full flex-1 rounded-md px-2 font-mono text-[11px] text-zinc-200 disabled:opacity-60 sm:min-w-[260px]"
                    >
                      {imageProfiles.map((p) => (
                        <option key={p.id} value={p.id} className="bg-zinc-900">
                          {p.shortTag} · {p.label}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-1.5">
                      {onTargetSelected && acc.isOnline && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            onTargetSelected(acc.primaryTarget);
                            onOpenChange(false);
                          }}
                          className="h-8 border-emerald-500/40 bg-emerald-500/15 text-[11px] text-emerald-200"
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                          Use {acc.primaryTarget.toUpperCase()}
                        </Button>
                      )}

                      {acc.isOnline || acc.isStarting ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={Boolean(busyAlias)}
                          onClick={() => handleKillOne(acc)}
                          className="h-8 border-rose-500/40 bg-rose-500/15 text-[11px] text-rose-200 hover:bg-rose-500/25"
                        >
                          {busyAlias === acc.alias ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Skull className="mr-1 h-3.5 w-3.5" />
                          )}
                          Stop
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={Boolean(busyAlias)}
                          onClick={() => handleBootOne(acc)}
                          className="h-8 bg-emerald-600 text-[11px] font-medium text-white hover:bg-emerald-500"
                        >
                          {busyAlias === acc.alias ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Power className="mr-1 h-3.5 w-3.5" />
                          )}
                          Boot {acc.displayName}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 pt-2 text-[11px] text-zinc-400">
          <button
            type="button"
            onClick={() => refreshCluster()}
            className="inline-flex items-center gap-1 hover:text-zinc-200"
          >
            <RefreshCw className={`h-3 w-3 ${loadingAccounts ? "animate-spin" : ""}`} />
            Refresh Quota &amp; Status
          </button>
          <Link href="/vms" className="inline-flex items-center gap-1 text-indigo-300 hover:underline">
            <Server className="h-3 w-3" />
            Full GPU Cluster Manager
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
