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
  Pencil,
  Flame,
  X,
} from "lucide-react";
import type { PrewarmModelRef, PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary, ColabAccountSummary } from "@/app/api/vm/accounts/route";
import { WORKER_PROFILE_LIST, getWorkerProfile } from "@/lib/catalog/worker-profiles";
import { VmLogsDialog } from "@/components/gpu/VmLogsDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export interface CatalogModelChoice {
  slug: string;
  displayName: string;
  category: string;
  filename: string;
  modality: string;
  backupStatus?: string;
}

const STEP_LABELS: Record<number, string> = {
  0: "Idle",
  1: "1/5: Kernel Queued",
  2: "2/5: FastBoot & Dependencies",
  3: "3/5: Installing / Starting",
  4: "4/5: Tunnel Ready · Booting UI",
  5: "5/5: Online & Ready",
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

interface VmClusterCardProps {
  kind: "kaggle" | "colab";
  kaggleAccount?: KaggleAccountSummary;
  colabAccount?: ColabAccountSummary;
  vms: PublicVmInstance[];
  globalIdleTimeoutMinutes: number;
  catalogChoices: CatalogModelChoice[];
  onRefresh: () => void;
  onOpenColabSetup?: () => void;
  onCopyCell?: (target: string) => void;
  copiedTarget?: string | null;
}

export const VmClusterCard: React.FC<VmClusterCardProps> = ({
  kind,
  kaggleAccount,
  colabAccount,
  vms,
  globalIdleTimeoutMinutes,
  catalogChoices,
  onRefresh,
  onOpenColabSetup,
  onCopyCell,
  copiedTarget,
}) => {
  const [actionLoading, setActionLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [logsTarget, setLogsTarget] = useState<string | null>(null);
  const [editingTargetName, setEditingTargetName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [liveCatalogModal, setLiveCatalogModal] = useState<{
    target: string;
    checkpoints: string[];
    totalNodesAvailable: number;
  } | null>(null);

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
  const selectedPrewarm: PrewarmModelRef[] = primaryVm?.prewarmModels ?? [];
  const slotIdleOverride = primaryVm?.idleTimeoutMinutes ?? null;

  const totalSec = kaggleAccount?.quota?.totalAllowedSeconds ?? 108000;
  const remainSec = kaggleAccount?.quota?.remainingSeconds ?? totalSec;
  const remainPct = Math.min(100, Math.round((remainSec / Math.max(1, totalSec)) * 100));

  async function patchBootConfig(
    target: string,
    payload: {
      workerProfile?: string;
      displayName?: string;
      idleTimeoutMinutes?: number | null;
      prewarmModels?: PrewarmModelRef[];
    },
    successMsg: string
  ) {
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to update boot configuration");
        return;
      }
      toast.success(successMsg);
      onRefresh();
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleSaveDisplayName(target: string) {
    const trimmed = nameDraft.trim();
    setEditingTargetName(null);
    if (!trimmed) return;
    await patchBootConfig(target, { displayName: trimmed }, `Renamed ${target.toUpperCase()} to ${trimmed}`);
  }

  async function handleAddPrewarm(slug: string) {
    if (!slug) return;
    const match = catalogChoices.find((c) => c.slug === slug);
    if (!match) return;
    if (selectedPrewarm.some((p) => p.filename === match.filename && p.category === match.category)) {
      return;
    }
    if (selectedPrewarm.length >= 3) {
      toast.error("Maximum 3 pre-warm models per VM slot to keep boot fast.");
      return;
    }
    const next = [
      ...selectedPrewarm,
      { slug: match.slug, category: match.category, filename: match.filename },
    ];
    await patchBootConfig(
      primaryTarget,
      { prewarmModels: next },
      `Queued ${match.displayName} for boot pre-warm`
    );
  }

  async function handleRemovePrewarm(filename: string, category: string) {
    const next = selectedPrewarm.filter(
      (p) => !(p.filename === filename && p.category === category)
    );
    await patchBootConfig(primaryTarget, { prewarmModels: next }, "Updated pre-warm model list");
  }

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
      setLiveCatalogModal({
        target: primaryTarget,
        checkpoints: data.models?.checkpoints || [],
        totalNodesAvailable: data.totalNodesAvailable || 0,
      });
    } catch {
      toast.error(`Failed to reach ${primaryTarget} catalog`);
    } finally {
      setCatalogLoading(false);
    }
  }

  return (
    <div
      className={`glass-panel flex flex-col justify-between rounded-2xl p-5 transition-all duration-200 ${
        isOnline
          ? "border-emerald-400/40 bg-emerald-500/[0.05] shadow-[0_0_28px_-12px_rgba(16,185,129,0.45)]"
          : isStarting
          ? "border-amber-400/40 bg-amber-500/[0.05]"
          : isError
          ? "border-rose-400/35 bg-rose-500/[0.04]"
          : "hover:border-white/25"
      }`}
    >
      <div className="space-y-4">
        {/* Card Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                kind === "kaggle"
                  ? "border-cyan-400/30 bg-cyan-500/15 text-cyan-300"
                  : "border-amber-400/30 bg-amber-500/15 text-amber-300"
              }`}
            >
              {kind === "kaggle" ? <Cpu className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">
                  {kind === "kaggle"
                    ? `Kaggle ${kaggleAccount?.accountAlias?.toUpperCase() || "ACC1"}`
                    : `Colab ${colabAccount?.accountAlias?.toUpperCase() || "ACC1"}`}
                </span>
                <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                  {activeProfile.shortTag}
                </span>
              </div>
              <div className="truncate font-mono text-[11px] text-zinc-400">
                {kind === "kaggle"
                  ? kaggleAccount?.username
                    ? `@${kaggleAccount.username}`
                    : "Unconfigured in Settings"
                  : colabAccount?.connected
                  ? colabAccount.email
                  : "Google account not linked"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOnline && (
              <span className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 font-mono text-[10px] text-zinc-300">
                {latency != null ? `${latency}ms` : "--"} · {formatUptime(uptime)}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
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
                  ? "2×T4 ONLINE"
                  : "ONLINE"
                : isStarting
                ? `BOOT ${maxStep}/5`
                : isError
                ? "ERROR"
                : "OFFLINE"}
            </span>
          </div>
        </div>

        {/* Account Quota / Colab Status */}
        {kind === "kaggle" ? (
          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
            {kaggleAccount?.quota ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 font-semibold text-emerald-300">
                    <Clock className="h-3.5 w-3.5" />
                    {formatHoursMinutes(remainSec)} weekly quota remaining
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400">
                    {formatHoursMinutes(totalSec)} total ({remainPct}%)
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
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
              </div>
            ) : (
              <div className="text-[11px] text-zinc-400">
                {kaggleAccount?.quotaError || "Add Kaggle API key in Settings → Stored Keys."}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/25 p-3 text-[11px]">
            <span className="flex items-center gap-1.5">
              {colabAccount?.connected ? (
                <>
                  <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-zinc-200">{colabAccount.email}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-zinc-400">Click Setup to connect Gmail / Drive</span>
                </>
              )}
            </span>
            <div className="flex items-center gap-1.5 font-mono text-[10px]">
              <span
                className={`rounded px-1.5 py-0.5 ${
                  colabAccount?.driveFileId
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-white/[0.06] text-zinc-400"
                }`}
              >
                {colabAccount?.driveFileId ? "Drive .ipynb Bound" : "Dynamic Launcher"}
              </span>
            </div>
          </div>
        )}

        {/* Per-GPU Telemetry & Direct WebUI Links */}
        <div className="space-y-2">
          {vms.map((v) => {
            const total = v.vramTotalGb || 16;
            const used = v.vramUsedGb || 0;
            const pct = Math.min(100, Math.round((used / total) * 100));
            const gpuOnline = v.status === "ONLINE" || v.status === "BUSY";
            const isEditingName = editingTargetName === v.target;

            return (
              <div
                key={v.id}
                className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold uppercase text-indigo-300">
                      {v.target}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500">:{v.internalPort}</span>

                    {isEditingName ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSaveDisplayName(v.target);
                        }}
                        className="flex items-center gap-1"
                      >
                        <input
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          autoFocus
                          className="glass-input h-6 w-32 rounded px-1.5 text-[11px] text-white"
                          placeholder={v.target.toUpperCase()}
                        />
                        <button
                          type="submit"
                          className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTargetName(null)}
                          className="text-zinc-400 hover:text-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTargetName(v.target);
                          setNameDraft(v.displayName || v.target.toUpperCase());
                        }}
                        title="Rename slot label"
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-white/[0.06] hover:text-white"
                      >
                        <span>{v.displayName || v.target.toUpperCase()}</span>
                        <Pencil className="h-2.5 w-2.5 text-zinc-500" />
                      </button>
                    )}

                    {v.gpuName && (
                      <span className="hidden rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-400 sm:inline">
                        {v.gpuName}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11px] text-zinc-300">
                      {used.toFixed(1)} / {total.toFixed(1)} GB ({pct}%)
                    </span>
                    <a
                      href={gpuOnline ? `/api/vm/${v.target}/webui` : undefined}
                      target="_blank"
                      rel="noreferrer"
                      aria-disabled={!gpuOnline}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${
                        gpuOnline
                          ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                          : "pointer-events-none border-white/10 bg-white/[0.03] text-zinc-600"
                      }`}
                    >
                      <ExternalLink className="h-3 w-3" />
                      UI :{v.internalPort}
                    </a>
                  </div>
                </div>

                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full transition-all duration-300 ${
                      pct > 85
                        ? "bg-rose-400"
                        : gpuOnline
                        ? "bg-emerald-400"
                        : "bg-white/15"
                    }`}
                    style={{ width: `${gpuOnline ? Math.max(4, pct) : 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Boot Configuration (Editable when Offline) */}
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/25 p-3.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-zinc-200">Boot Configuration</span>
            {anyActive && (
              <span className="text-[10px] text-amber-300/90">
                Stop VM to modify next-boot profile &amp; pre-warm models
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                Worker Profile
              </label>
              <select
                value={activeProfile.id}
                disabled={anyActive || savingConfig}
                onChange={(e) =>
                  patchBootConfig(
                    primaryTarget,
                    { workerProfile: e.target.value },
                    `Profile set to ${getWorkerProfile(e.target.value).shortTag} for next boot`
                  )
                }
                title={activeProfile.description}
                className="glass-input w-full rounded-xl px-2.5 py-1.5 font-mono text-[11px] text-zinc-100 disabled:opacity-55"
              >
                {WORKER_PROFILE_LIST.map((p) => (
                  <option key={p.id} value={p.id} className="bg-zinc-900">
                    {p.shortTag} · {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                Idle Watchdog Timeout
              </label>
              <select
                value={slotIdleOverride === null ? "global" : String(slotIdleOverride)}
                disabled={anyActive || savingConfig}
                onChange={(e) => {
                  const val = e.target.value;
                  const next = val === "global" ? null : Number(val);
                  patchBootConfig(
                    primaryTarget,
                    { idleTimeoutMinutes: next },
                    next === null
                      ? `Using global idle timeout (${globalIdleTimeoutMinutes}m)`
                      : next === 0
                      ? "Disabled auto-shutdown on idle for this slot"
                      : `Slot idle timeout set to ${next}m`
                  );
                }}
                className="glass-input w-full rounded-xl px-2.5 py-1.5 font-mono text-[11px] text-zinc-100 disabled:opacity-55"
              >
                <option value="global" className="bg-zinc-900">
                  Global Setting ({globalIdleTimeoutMinutes === 0 ? "Disabled" : `${globalIdleTimeoutMinutes}m`})
                </option>
                <option value="10" className="bg-zinc-900">10 minutes</option>
                <option value="15" className="bg-zinc-900">15 minutes</option>
                <option value="30" className="bg-zinc-900">30 minutes</option>
                <option value="60" className="bg-zinc-900">60 minutes</option>
                <option value="0" className="bg-zinc-900">Disabled (0m)</option>
              </select>
            </div>
          </div>

          {/* Pre-warm Models Picker */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                <Flame className="h-3 w-3 text-amber-400" />
                Pre-warm Models on Boot ({selectedPrewarm.length}/3)
              </label>
              <select
                value=""
                disabled={anyActive || savingConfig || selectedPrewarm.length >= 3}
                onChange={(e) => handleAddPrewarm(e.target.value)}
                className="max-w-[210px] rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-200 disabled:opacity-45"
              >
                <option value="" className="bg-zinc-900">
                  + Add model to pre-warm...
                </option>
                {catalogChoices.map((m) => (
                  <option key={m.slug} value={m.slug} className="bg-zinc-900">
                    [{m.modality}] {m.displayName}
                  </option>
                ))}
              </select>
            </div>

            {selectedPrewarm.length === 0 ? (
              <p className="text-[10px] text-zinc-500">
                No pre-warm models queued — only worker profile dependencies load at boot.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {selectedPrewarm.map((m) => (
                  <span
                    key={`${m.category}/${m.filename}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/25 bg-indigo-500/15 px-2 py-0.5 font-mono text-[10px] text-indigo-200"
                  >
                    <span>
                      {m.category}/{m.filename}
                    </span>
                    {!anyActive && (
                      <button
                        type="button"
                        disabled={savingConfig}
                        onClick={() => handleRemovePrewarm(m.filename, m.category)}
                        className="text-indigo-300 hover:text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live Booting Stepper */}
        {isStarting && (
          <div className="space-y-1.5 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] p-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 font-medium text-amber-200">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {STEP_LABELS[maxStep] || "Booting container..."}
              </span>
              <span className="font-mono text-zinc-300">{maxStep}/5</span>
            </div>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((step) => (
                <div
                  key={step}
                  className={`h-1.5 flex-1 rounded-sm transition-all duration-300 ${
                    step <= maxStep ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]" : "bg-white/10"
                  }`}
                />
              ))}
            </div>
            {firstError && (
              <p className="truncate text-[10px] text-amber-200/85" title={firstError}>
                {firstError}
              </p>
            )}
          </div>
        )}

        {/* Inline Error Notice */}
        {isError && firstError && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/15 p-3 text-[11px] text-rose-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{firstError}</span>
          </div>
        )}
      </div>

      {/* Footer Ingress + Primary & Secondary Actions */}
      <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between text-[10px] text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-cyan-400" />
            Ingress Tunnel
          </span>
          <span className="max-w-[260px] truncate font-mono text-zinc-300">
            {firstTunnel ? firstTunnel.replace(/^https?:\/\//, "") : "Caddy Route-less (Standby)"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {kind === "kaggle" ? (
            <button
              type="button"
              onClick={() => handleBootOrKill(false)}
              disabled={actionLoading || !kaggleAccount?.configured}
              className={`flex min-w-[140px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition disabled:opacity-40 whitespace-nowrap ${
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
          ) : (
            <a
              href={`/api/vm/colab/${encodeURIComponent(primaryTarget)}/launch`}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-[140px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25 whitespace-nowrap"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open Colab
            </a>
          )}

          <button
            type="button"
            onClick={() => handleBootOrKill(true)}
            disabled={actionLoading || !anyActive}
            title="Zero-Quota Panic Kill"
            className="flex items-center justify-center gap-1 rounded-xl border border-rose-400/30 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-35"
          >
            <Skull className="h-3.5 w-3.5" />
            Kill
          </button>

          <button
            type="button"
            onClick={handleInspectCatalog}
            disabled={!isOnline || catalogLoading}
            className="glass-pill flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-white/10 disabled:opacity-40"
          >
            {catalogLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ListChecks className="h-3.5 w-3.5 text-indigo-300" />
            )}
            Catalog
          </button>

          <button
            type="button"
            onClick={() => setLogsTarget(primaryTarget)}
            className="glass-pill flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-white/10"
          >
            <Terminal className="h-3.5 w-3.5 text-zinc-300" />
            Logs
          </button>

          {kind === "colab" && (
            <>
              <button
                type="button"
                onClick={onOpenColabSetup}
                className="glass-pill flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-white/10"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Setup
              </button>
              <button
                type="button"
                onClick={() => onCopyCell?.(primaryTarget)}
                className="glass-pill flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-amber-200 hover:bg-white/10"
              >
                {copiedTarget === primaryTarget ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Cell
              </button>
              <a
                href={`/api/vm/colab/${primaryTarget}/notebook`}
                className="glass-pill flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-amber-200 hover:bg-white/10"
              >
                <Download className="h-3.5 w-3.5" />
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

      <Dialog
        open={Boolean(liveCatalogModal)}
        onOpenChange={(open) => !open && setLiveCatalogModal(null)}
      >
        <DialogContent className="glass-popover border-white/15 text-zinc-100">
          <DialogHeader>
            <DialogTitle>
              Live ComfyUI Inspection ({liveCatalogModal?.target.toUpperCase()})
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              {liveCatalogModal?.totalNodesAvailable || 0} installed ComfyUI custom/core nodes
              and {liveCatalogModal?.checkpoints.length || 0} loaded checkpoints in `/tmp/models`.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-black/35 p-3 font-mono text-[11px] text-zinc-300">
            {liveCatalogModal?.checkpoints.length ? (
              liveCatalogModal.checkpoints.map((ckpt) => <div key={ckpt}>• {ckpt}</div>)
            ) : (
              <div className="italic text-zinc-500">No checkpoints currently cached on this GPU.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

