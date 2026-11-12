"use client";

import React, { useState } from "react";
import {
  Power,
  Skull,
  Clock,
  Cpu,
  Globe,
  ExternalLink,
  ListChecks,
  Terminal,
  Copy,
  Check,
  Download,
  Loader2,
  Activity,
  AlertTriangle,
  Settings2,
  UserCheck,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary, ColabAccountSummary } from "@/app/api/vm/accounts/route";
import { WORKER_PROFILE_LIST, getWorkerProfile } from "@/lib/catalog/worker-profiles";
import { VmLogsDialog } from "@/components/gpu/VmLogsDialog";
import { toast } from "sonner";

const STEP_LABELS: Record<number, string> = {
  0: "Idle",
  1: "1/5: Kernel Queued",
  2: "2/5: FastBoot & Dependencies",
  3: "3/5: Installing / Starting",
  4: "4/5: Tunnel Ready · Booting UI",
  5: "5/5: Online & Ready",
};

const STEP_SHORT_LABELS: Record<number, string> = {
  1: "Kernel",
  2: "FastBoot",
  3: "Models/Deps",
  4: "Tunnel",
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

interface AccountClusterCardProps {
  kind: "kaggle" | "colab";
  kaggleAccount?: KaggleAccountSummary;
  colabAccount?: ColabAccountSummary;
  vms: PublicVmInstance[];
  onRefresh: () => void;
  onOpenColabSetup?: () => void;
  onCopyCell?: (target: string) => void;
  copiedTarget?: string | null;
}

export const AccountClusterCard: React.FC<AccountClusterCardProps> = ({
  kind,
  kaggleAccount,
  colabAccount,
  vms,
  onRefresh,
  onOpenColabSetup,
  onCopyCell,
  copiedTarget,
}) => {
  const [actionLoading, setActionLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [logsTarget, setLogsTarget] = useState<string | null>(null);
  const [pinnedOpen, setPinnedOpen] = useState(false);

  const primaryVm = vms[0];
  const primaryTarget =
    primaryVm?.target ||
    (kind === "kaggle"
      ? kaggleAccount?.accountAlias === "acc2"
        ? "gpu2"
        : "gpu0"
      : colabAccount?.accountAlias === "acc2"
      ? "gcgpu1"
      : "gcgpu");

  const isOnline = vms.some((v) => v.status === "ONLINE" || v.status === "BUSY");
  const isStarting = !isOnline && vms.some((v) => v.status === "STARTING");
  const isError = !isOnline && !isStarting && vms.some((v) => v.status === "ERROR");
  const anyActive = isOnline || isStarting;

  const maxStep = vms.reduce((acc, v) => Math.max(acc, v.stepProgress || 0), 0);
  const firstError = vms.find((v) => v.lastError)?.lastError;
  const firstTunnel = vms.find((v) => v.publicUrl)?.publicUrl;
  const latency = vms.find((v) => v.latencyMs != null)?.latencyMs ?? null;
  const uptime = vms.reduce((acc, v) => Math.max(acc, v.uptimeSeconds || 0), 0);
  const activeProfile = getWorkerProfile(primaryVm?.workerProfile);

  async function handleProfileChange(nextProfile: string) {
    setSavingProfile(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(primaryTarget)}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerProfile: nextProfile }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to update worker profile");
        return;
      }
      toast.success(`Profile set to ${getWorkerProfile(nextProfile).shortTag} for next boot`);
      onRefresh();
    } finally {
      setSavingProfile(false);
    }
  }

  const totalSec = kaggleAccount?.quota?.totalAllowedSeconds ?? 108000;
  const remainSec = kaggleAccount?.quota?.remainingSeconds ?? totalSec;
  const remainPct = Math.min(100, Math.round((remainSec / Math.max(1, totalSec)) * 100));

  async function handleBootOrKill(confirmKill = false) {
    const label =
      kind === "kaggle"
        ? `Kaggle ${kaggleAccount?.accountAlias}`
        : `Colab ${colabAccount?.accountAlias}`;
    if (confirmKill && !confirm(`Trigger immediate Zero-Quota kill for ${label}?`)) {
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(primaryTarget)}/toggle`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Failed to toggle ${label}`);
        return;
      }
      toast.success(data.message || `Updated ${label}`);
      onRefresh();
    } catch {
      toast.error(`Network error toggling ${label}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleInspectCatalog() {
    setCatalogLoading(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(primaryTarget)}/catalog`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Catalog unavailable for ${primaryTarget}`);
        return;
      }
      toast.success(
        `${primaryTarget.toUpperCase()} Catalog: ${data.models?.checkpoints?.length || 0} checkpoints, ${data.totalNodesAvailable || 0} nodes`
      );
    } catch {
      toast.error(`Failed to reach ${primaryTarget} catalog`);
    } finally {
      setCatalogLoading(false);
    }
  }

  return (
    <div className="group relative">
      {/* Main Clean Left-Rail Frosted Card */}
      <div
        className={`glass-panel rounded-2xl p-3.5 transition-all duration-200 ${
          isOnline
            ? "border-emerald-400/40 bg-emerald-500/[0.06] shadow-[0_0_24px_-10px_rgba(16,185,129,0.45)]"
            : isStarting
            ? "border-amber-400/40 bg-amber-500/[0.06]"
            : isError
            ? "border-rose-400/35 bg-rose-500/[0.05]"
            : "hover:border-white/25"
        }`}
      >
        {/* Row 1: Provider / Account / Unified Status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {kind === "kaggle" ? (
              <Cpu className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
            ) : (
              <Globe className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            )}
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase whitespace-nowrap ${
                kind === "kaggle"
                  ? "bg-cyan-500/15 text-cyan-300"
                  : "bg-amber-500/15 text-amber-300"
              }`}
            >
              {kind === "kaggle"
                ? `Kaggle ${kaggleAccount?.accountAlias || "acc1"}`
                : `Colab ${colabAccount?.accountAlias || "acc1"}`}
            </span>
            <span className="truncate font-mono text-[11px] text-zinc-200">
              {kind === "kaggle"
                ? kaggleAccount?.username || "Unconfigured"
                : colabAccount?.connected
                ? colabAccount.email?.split("@")[0]
                : "Not linked"}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase whitespace-nowrap ${
                isOnline
                  ? "bg-emerald-500/20 text-emerald-300"
                  : isStarting
                  ? "bg-amber-500/20 text-amber-200"
                  : isError
                  ? "bg-rose-500/20 text-rose-300"
                  : "bg-white/[0.07] text-zinc-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isOnline
                    ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                    : isStarting
                    ? "animate-pulse bg-amber-400"
                    : isError
                    ? "bg-rose-400"
                    : "bg-zinc-500"
                }`}
              />
              {isOnline
                ? kind === "kaggle"
                  ? "2×T4 ON"
                  : "ONLINE"
                : isStarting
                ? `BOOT ${maxStep}/5`
                : isError
                ? "ERROR"
                : "OFFLINE"}
            </span>

            <button
              type="button"
              onClick={() => setPinnedOpen((v) => !v)}
              title="Hover or click to inspect GPU details"
              className={`rounded-md border border-white/10 p-1 text-zinc-400 transition hover:text-white ${
                pinnedOpen ? "bg-white/15 text-white" : "bg-white/[0.03]"
              }`}
            >
              <ChevronRight
                className={`h-3 w-3 transition-transform duration-200 ${
                  pinnedOpen ? "rotate-90 lg:rotate-180" : "group-hover:lg:rotate-180"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Row 2: Kaggle Time Remaining OR Colab Linked Account Summary */}
        {kind === "kaggle" ? (
          <div className="mt-2.5 space-y-1">
            {kaggleAccount?.quota ? (
              <>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1 font-semibold text-emerald-300">
                    <Clock className="h-3 w-3 shrink-0" />
                    {formatHoursMinutes(remainSec)} left
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400">
                    {(kaggleAccount?.targets?.length ? kaggleAccount.targets : ["gpu0", "gpu1"])
                      .map((t) => t.toUpperCase())
                      .join("+")}{" "}
                    · {formatHoursMinutes(totalSec)}
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full transition-all duration-500 ${
                      remainPct < 15
                        ? "bg-rose-400"
                        : remainPct < 35
                        ? "bg-amber-400"
                        : "bg-cyan-400"
                    }`}
                    style={{ width: `${remainPct}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="text-[10px] text-zinc-500">
                {kaggleAccount?.quotaError || "Add Kaggle token in Vault"}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
            <span className="flex min-w-0 items-center gap-1 truncate">
              {colabAccount?.connected ? (
                <>
                  <UserCheck className="h-3 w-3 shrink-0 text-emerald-400" />
                  <span className="truncate text-zinc-300">{colabAccount.email}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-3 w-3 shrink-0 text-amber-400" />
                  <span>Connect Google account</span>
                </>
              )}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-zinc-500">
              {primaryTarget.toUpperCase()}
            </span>
          </div>
        )}

        {/* Row 3: Worker Modality Profile Selector */}
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
          <span className="text-zinc-500">Profile</span>
          <select
            value={activeProfile.id}
            disabled={anyActive || savingProfile}
            onChange={(e) => handleProfileChange(e.target.value)}
            title={activeProfile.description}
            className="max-w-[195px] truncate rounded-lg border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[10px] text-zinc-200 disabled:opacity-60"
          >
            {WORKER_PROFILE_LIST.map((p) => (
              <option key={p.id} value={p.id} className="bg-zinc-900">
                {p.shortTag} · {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Row 4: Primary Controls (ONLY Boot/Kill on Kaggle; Open Colab/Kill/Setup on Colab) */}
        <div className="mt-3 flex items-center gap-1.5">
          {kind === "kaggle" ? (
            <>
              <button
                type="button"
                onClick={() => handleBootOrKill(false)}
                disabled={actionLoading || !kaggleAccount?.configured}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 whitespace-nowrap ${
                  anyActive
                    ? "border border-amber-400/35 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                    : "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-600/25 hover:from-indigo-500 hover:to-violet-500"
                }`}
              >
                {actionLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Power className="h-3.5 w-3.5" />
                )}
                {anyActive ? "Stop Dual-T4" : "Boot Dual-T4"}
              </button>

              <button
                type="button"
                onClick={() => handleBootOrKill(true)}
                disabled={actionLoading || !anyActive}
                title="Zero-Quota Panic Kill"
                className="flex items-center justify-center gap-1 rounded-xl border border-rose-400/30 bg-rose-500/15 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-35"
              >
                <Skull className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <a
                href={`/api/vm/colab/${encodeURIComponent(primaryTarget)}/launch`}
                target="_blank"
                rel="noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25 whitespace-nowrap"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open Colab
              </a>

              <button
                type="button"
                onClick={() => handleBootOrKill(true)}
                disabled={actionLoading || !anyActive}
                title="Zero-Quota Panic Kill"
                className="flex items-center justify-center rounded-xl border border-rose-400/30 bg-rose-500/15 px-2.5 py-1.5 text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-35"
              >
                <Skull className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={onOpenColabSetup}
                title="Connect / Setup Colab Account & Notebook"
                className="glass-pill flex items-center justify-center rounded-xl px-2.5 py-1.5 text-zinc-200 hover:bg-white/15"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Inline Live Booting Process Strip (Shown automatically during STARTING) */}
        {isStarting && (
          <div className="mt-3 space-y-2 rounded-xl border border-amber-400/25 bg-black/40 p-2.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1.5 font-medium text-amber-200">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                {STEP_LABELS[maxStep] || "Booting container..."}
              </span>
              <div className="flex items-center gap-2 font-mono text-[10px]">
                {primaryVm?.bootMetadata?.totalBootElapsed ? (
                  <span className="text-amber-300">
                    Total: {primaryVm.bootMetadata.totalBootElapsed}s
                  </span>
                ) : null}
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-semibold text-amber-300">
                  {maxStep}/5
                </span>
              </div>
            </div>

            <div className="grid grid-cols-5 gap-1 pt-0.5">
              {[1, 2, 3, 4, 5].map((s) => {
                const isDone = s < maxStep || (s === 5 && isOnline);
                const isRunning = s === maxStep && !isOnline;
                const dur = primaryVm?.bootMetadata?.stepDurations?.[String(s)];
                const runningElapsed = primaryVm?.bootMetadata?.currentStepElapsed;

                return (
                  <div key={s} className="space-y-1">
                    <div
                      className={`h-1.5 w-full rounded-sm transition-all duration-300 ${
                        isDone
                          ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]"
                          : isRunning
                          ? "animate-pulse bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]"
                          : "bg-white/10"
                      }`}
                    />
                    <div className="flex flex-col text-[9px] font-mono leading-tight">
                      <span className={`truncate ${isRunning ? "font-semibold text-amber-300" : isDone ? "text-zinc-300" : "text-zinc-600"}`}>
                        {STEP_SHORT_LABELS[s]}
                      </span>
                      <span className="text-[8px] text-zinc-400">
                        {isDone && dur != null ? (
                          <span className="text-emerald-400/90">{dur}s</span>
                        ) : isRunning ? (
                          <span className="text-amber-300">{runningElapsed != null ? `${runningElapsed}s...` : "active"}</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {firstError && (
              <p className="truncate text-[10px] text-amber-200/80" title={firstError}>
                {firstError}
              </p>
            )}
          </div>
        )}

        {/* Inline Error Notice */}
        {isError && firstError && (
          <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/15 p-2 text-[10px] text-rose-200">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-2">{firstError}</span>
          </div>
        )}
      </div>

      {/* Hover Telemetry & Secondary Tools Popover (NO duplicate Boot button; opens cleanly to right on lg+) */}
      <div
        className={`glass-popover z-50 rounded-2xl p-3.5 text-[11px] transition-all duration-200 lg:absolute lg:left-[calc(100%+12px)] lg:top-0 lg:w-72 ${
          pinnedOpen
            ? "mt-2 block opacity-100 lg:mt-0 lg:translate-x-0 lg:pointer-events-auto"
            : "hidden lg:block lg:pointer-events-none lg:translate-x-1 lg:opacity-0 lg:group-hover:pointer-events-auto lg:group-hover:translate-x-0 lg:group-hover:opacity-100 lg:group-focus-within:pointer-events-auto lg:group-focus-within:translate-x-0 lg:group-focus-within:opacity-100"
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <span className="font-mono text-xs font-bold uppercase text-white">
            {kind === "kaggle"
              ? `${kaggleAccount?.accountAlias} · Dual T4 Telemetry`
              : `${primaryTarget} · T4 Telemetry`}
          </span>
          <span className="font-mono text-[10px] text-zinc-400">
            {isOnline && latency != null ? `${latency}ms` : "--"} · {formatUptime(uptime)}
          </span>
        </div>

        {/* Per-GPU VRAM Gauges */}
        <div className="mt-2.5 space-y-2">
          {vms.map((v) => {
            const total = v.vramTotalGb || 16;
            const used = v.vramUsedGb || 0;
            const pct = Math.min(100, Math.round((used / total) * 100));
            return (
              <div key={v.id} className="space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-mono font-semibold uppercase text-zinc-200">
                    {v.target} <span className="text-zinc-500">:{v.internalPort}</span>
                  </span>
                  <span className="font-mono text-zinc-300">
                    {used.toFixed(1)} / {total.toFixed(1)} GB ({pct}%)
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full ${
                      pct > 85 ? "bg-rose-400" : v.status === "ONLINE" ? "bg-emerald-400" : "bg-white/20"
                    }`}
                    style={{ width: `${v.status === "ONLINE" ? Math.max(4, pct) : 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Tunnel */}
        <div className="mt-2.5 flex items-center justify-between border-t border-white/10 pt-2 text-[10px] text-zinc-400">
          <span className="flex items-center gap-1">
            <Activity className="h-3 w-3 text-cyan-400" /> Ingress
          </span>
          <span className="max-w-[165px] truncate font-mono text-zinc-300">
            {firstTunnel ? firstTunnel.replace(/^https?:\/\//, "") : "Caddy Route-less"}
          </span>
        </div>

        {/* Inspection & Notebook Actions Only */}
        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-white/10 pt-2.5">
          {vms.map((v) => (
            <a
              key={v.target}
              href={v.status === "ONLINE" ? `/api/vm/${v.target}/webui` : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={v.status !== "ONLINE"}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition ${
                v.status === "ONLINE"
                  ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                  : "pointer-events-none border-white/10 bg-white/[0.03] text-zinc-600"
              }`}
            >
              <ExternalLink className="h-3 w-3" />
              UI :{v.internalPort}
            </a>
          ))}

          <button
            type="button"
            onClick={handleInspectCatalog}
            disabled={!isOnline || catalogLoading}
            className="glass-pill flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-zinc-200 hover:bg-white/10 disabled:opacity-40"
          >
            {catalogLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ListChecks className="h-3 w-3 text-indigo-300" />
            )}
            Catalog
          </button>

          <button
            type="button"
            onClick={() => setLogsTarget(primaryTarget)}
            className="glass-pill flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-zinc-200 hover:bg-white/10"
          >
            <Terminal className="h-3 w-3 text-zinc-300" />
            Logs
          </button>

          {kind === "colab" && (
            <>
              <button
                type="button"
                onClick={() => onCopyCell?.(primaryTarget)}
                className="glass-pill flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-amber-200 hover:bg-white/10"
              >
                {copiedTarget === primaryTarget ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                Cell
              </button>
              <a
                href={`/api/vm/colab/${primaryTarget}/notebook`}
                className="glass-pill flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-amber-200 hover:bg-white/10"
              >
                <Download className="h-3 w-3" />
                .ipynb
              </a>
            </>
          )}
        </div>
      </div>

      <VmLogsDialog
        target={logsTarget}
        open={Boolean(logsTarget)}
        onOpenChange={(open) => !open && setLogsTarget(null)}
      />
    </div>
  );
};

