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
  AlertTriangle,
  Settings2,
  Pencil,
  Flame,
  Zap,
  X,
} from "lucide-react";
import type { PrewarmModelRef, PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary, ColabAccountSummary } from "@/app/api/vm/accounts/route";
import { WORKER_PROFILE_LIST, getWorkerProfile, isLlmWorkerProfile } from "@/lib/catalog/worker-profiles";
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
  1: "1/5 Kernel queued",
  2: "2/5 FastBoot environment",
  3: "3/5 Dependencies & runtime",
  4: "4/5 Tunnel & ComfyUI init",
  5: "5/5 Ready",
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
      ? kaggleAccount?.accountAlias === "acc4"
        ? "gpu6"
        : kaggleAccount?.accountAlias === "acc3"
        ? "gpu4"
        : kaggleAccount?.accountAlias === "acc2"
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
      toast.error("Maximum 3 pre-warm models per slot.");
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

  const [hotReloadLoading, setHotReloadLoading] = useState(false);

  async function handleHotReload() {
    if (!primaryTarget) return;
    setHotReloadLoading(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(primaryTarget)}/hot-reload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: activeProfile.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Hot reload request failed");
      }
      toast.success("Worker hot-reloaded! In-container restart in progress (<3s)...");
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to hot reload worker");
    } finally {
      setHotReloadLoading(false);
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
      className={`flex flex-col justify-between rounded-lg border bg-[#111114] p-3.5 transition-colors ${
        isOnline
          ? "border-emerald-500/45"
          : isStarting
          ? "border-amber-500/45"
          : isError
          ? "border-rose-500/45"
          : "border-zinc-800 hover:border-zinc-700"
      }`}
    >
      <div className="space-y-3">
        {/* Compact Card Header */}
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {kind === "kaggle" ? (
              <Cpu className="h-4 w-4 shrink-0 text-zinc-400" />
            ) : (
              <Globe className="h-4 w-4 shrink-0 text-zinc-400" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-white">
                  {kind === "kaggle"
                    ? `Kaggle ${kaggleAccount?.accountAlias?.toUpperCase() || "ACC1"}`
                    : `Colab ${colabAccount?.accountAlias?.toUpperCase() || "ACC1"}`}
                </span>
                <span className="truncate font-mono text-[11px] text-zinc-500">
                  {kind === "kaggle"
                    ? kaggleAccount?.username
                      ? `@${kaggleAccount.username}`
                      : "unconfigured"
                    : colabAccount?.connected
                    ? colabAccount.email
                    : "not linked"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isOnline && (
              <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                {latency != null ? `${latency}ms` : "--"} · {formatUptime(uptime)}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[10px] font-medium uppercase ${
                isOnline
                  ? "bg-emerald-500/15 text-emerald-300"
                  : isStarting
                  ? "bg-amber-500/15 text-amber-300"
                  : isError
                  ? "bg-rose-500/15 text-rose-300"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isOnline
                    ? "bg-emerald-400"
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
          </div>
        </div>

        {/* Account Quota Line (Kaggle) OR Drive Binding Line (Colab) */}
        {kind === "kaggle" ? (
          <div className="flex items-center justify-between gap-3 text-[11px]">
            {kaggleAccount?.quota ? (
              <>
                <span className="flex items-center gap-1.5 font-mono text-zinc-300">
                  <Clock className="h-3 w-3 text-zinc-500" />
                  {formatHoursMinutes(remainSec)} / {formatHoursMinutes(totalSec)} left
                </span>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full ${
                        remainPct < 15
                          ? "bg-rose-500"
                          : remainPct < 35
                          ? "bg-amber-500"
                          : "bg-indigo-400"
                      }`}
                      style={{ width: `${remainPct}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-zinc-400">{remainPct}%</span>
                </div>
              </>
            ) : (
              <span className="text-zinc-500">
                {kaggleAccount?.quotaError || "Add Kaggle key in Settings → Stored Keys"}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span className="truncate">
              {colabAccount?.connected
                ? `Linked: ${colabAccount.email}`
                : "Click Setup to bind Gmail or Colab URL"}
            </span>
            <span className="font-mono text-[10px] text-zinc-500">
              {colabAccount?.driveFileId ? "Drive .ipynb Bound" : "Dynamic Launcher"}
            </span>
          </div>
        )}

        {/* Per-GPU Dense Slot Table Rows */}
        <div className="divide-y divide-zinc-800/80 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/60">
          {vms.map((v) => {
            const total = v.vramTotalGb || 16;
            const used = v.vramUsedGb || 0;
            const pct = Math.min(100, Math.round((used / total) * 100));
            const gpuOnline = v.status === "ONLINE" || v.status === "BUSY";
            const isEditingName = editingTargetName === v.target;

            return (
              <div
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase text-zinc-100">
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
                        className="h-5 w-28 rounded border border-zinc-700 bg-zinc-900 px-1.5 text-[11px] text-white"
                      />
                      <button
                        type="submit"
                        className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] text-white"
                      >
                        OK
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTargetName(v.target);
                        setNameDraft(v.displayName || v.target.toUpperCase());
                      }}
                      className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      <span>{v.displayName || v.target.toUpperCase()}</span>
                      <Pencil className="h-2.5 w-2.5 text-zinc-600" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  <div className="hidden items-center gap-1.5 sm:flex">
                    <div className="h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full ${
                          pct > 85 ? "bg-rose-500" : gpuOnline ? "bg-emerald-500" : "bg-zinc-700"
                        }`}
                        style={{ width: `${gpuOnline ? Math.max(4, pct) : 0}%` }}
                      />
                    </div>
                    <span className="font-mono text-[10px] tabular-nums text-zinc-400">
                      {used.toFixed(1)}/{total.toFixed(0)}G
                    </span>
                  </div>

                  <a
                    href={gpuOnline ? `/api/vm/${v.target}/webui` : undefined}
                    target="_blank"
                    rel="noreferrer"
                    aria-disabled={!gpuOnline}
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-medium ${
                      gpuOnline
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                        : "pointer-events-none border-zinc-800 bg-zinc-900 text-zinc-600"
                    }`}
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    UI
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Compact Boot Config Grid */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Worker Profile
            </label>
            <select
              value={activeProfile.id}
              disabled={anyActive || savingConfig}
              onChange={(e) =>
                patchBootConfig(
                  primaryTarget,
                  { workerProfile: e.target.value },
                  `Profile set to ${getWorkerProfile(e.target.value).shortTag}`
                )
              }
              className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-[11px] text-zinc-200 disabled:opacity-50"
            >
              {WORKER_PROFILE_LIST.map((p) => (
                <option key={p.id} value={p.id} className="bg-zinc-900">
                  {p.shortTag} · {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Idle Watchdog
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
                    ? `Using global timeout (${globalIdleTimeoutMinutes}m)`
                    : `Slot timeout set to ${next}m`
                );
              }}
              className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-[11px] text-zinc-200 disabled:opacity-50"
            >
              <option value="global" className="bg-zinc-900">
                Global ({globalIdleTimeoutMinutes === 0 ? "Off" : `${globalIdleTimeoutMinutes}m`})
              </option>
              <option value="10" className="bg-zinc-900">10m</option>
              <option value="15" className="bg-zinc-900">15m</option>
              <option value="30" className="bg-zinc-900">30m</option>
              <option value="60" className="bg-zinc-900">60m</option>
              <option value="0" className="bg-zinc-900">Disabled</option>
            </select>
          </div>
        </div>

        {/* Inline Pre-warm Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Flame className="h-3 w-3 text-zinc-500" />
            <span className="text-[10px] font-medium text-zinc-500">Pre-warm:</span>
            {selectedPrewarm.length === 0 ? (
              <span className="text-[10px] text-zinc-600">None</span>
            ) : (
              selectedPrewarm.map((m) => (
                <span
                  key={`${m.category}/${m.filename}`}
                  className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                >
                  {m.filename}
                  {!anyActive && (
                    <button
                      type="button"
                      onClick={() => handleRemovePrewarm(m.filename, m.category)}
                      className="text-zinc-500 hover:text-white"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </span>
              ))
            )}
          </div>

          <select
            value=""
            disabled={anyActive || savingConfig || selectedPrewarm.length >= 3}
            onChange={(e) => handleAddPrewarm(e.target.value)}
            className="max-w-[165px] rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300 disabled:opacity-40"
          >
            <option value="" className="bg-zinc-900">
              + Queue model ({selectedPrewarm.length}/3)
            </option>
            {catalogChoices.map((m) => (
              <option key={m.slug} value={m.slug} className="bg-zinc-900">
                [{m.modality}] {m.displayName}
              </option>
            ))}
          </select>
        </div>

        {isStarting && (
          <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium">
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
                          ? "bg-emerald-400"
                          : isRunning
                          ? "animate-pulse bg-amber-400"
                          : "bg-zinc-800"
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
          </div>
        )}

        {isError && firstError && (
          <div className="flex items-start gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-2">{firstError}</span>
          </div>
        )}
      </div>

      {/* Compact Footer Controls */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-2.5">
        <span className="inline-flex max-w-[200px] items-center gap-1.5 truncate font-mono text-[10px] text-zinc-500">
          <span className="truncate">
            {firstTunnel
              ? `${firstTunnel.replace(/^https?:\/\//, "")}${isLlmWorkerProfile(activeProfile.id) ? "/v1" : ""}`
              : "Caddy Route-less"}
          </span>
          {firstTunnel && isLlmWorkerProfile(activeProfile.id) && (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(`${firstTunnel.replace(/\/$/, "")}/v1`);
                toast.success("Copied OpenAI /v1 endpoint URL");
              }}
              title="Copy /v1 LLM endpoint URL"
              className="shrink-0 text-cyan-400 hover:text-cyan-300"
            >
              <Copy className="h-3 w-3" />
            </button>
          )}
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {kind === "kaggle" ? (
            <button
              type="button"
              onClick={() => handleBootOrKill(false)}
              disabled={actionLoading || !kaggleAccount?.configured}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition disabled:opacity-40 ${
                anyActive
                  ? "border border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
                  : "bg-indigo-600 text-white hover:bg-indigo-500"
              }`}
            >
              {actionLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Power className="h-3 w-3" />
              )}
              {anyActive ? "Stop" : "Boot Dual-T4"}
            </button>
          ) : (
            <a
              href={`/api/vm/colab/${encodeURIComponent(primaryTarget)}/launch`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
            >
              <ExternalLink className="h-3 w-3" />
              Open Colab
            </a>
          )}

          {anyActive && primaryVm?.publicUrl && (
            <button
              type="button"
              onClick={handleHotReload}
              disabled={hotReloadLoading || actionLoading}
              title="Hot reload worker processes in <3s without terminating VM or re-downloading models"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 transition disabled:opacity-40"
            >
              {hotReloadLoading ? (
                <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
              ) : (
                <Zap className="h-3 w-3 text-cyan-400" />
              )}
              Hot Reload
            </button>
          )}

          <button
            type="button"
            onClick={() => handleBootOrKill(true)}
            disabled={actionLoading || !anyActive}
            title="Zero-Quota Panic Kill"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10 disabled:opacity-35"
          >
            <Skull className="h-3 w-3" />
          </button>

          <button
            type="button"
            onClick={handleInspectCatalog}
            disabled={!isOnline || catalogLoading}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            {catalogLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ListChecks className="h-3 w-3" />
            )}
            Catalog
          </button>

          <button
            type="button"
            onClick={() => setLogsTarget(primaryTarget)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            <Terminal className="h-3 w-3" />
            Logs
          </button>

          {kind === "colab" && (
            <>
              <button
                type="button"
                onClick={onOpenColabSetup}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
              >
                <Settings2 className="h-3 w-3" />
                Setup
              </button>
              <button
                type="button"
                onClick={() => onCopyCell?.(primaryTarget)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
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
                className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
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

      <Dialog
        open={Boolean(liveCatalogModal)}
        onOpenChange={(open) => !open && setLiveCatalogModal(null)}
      >
        <DialogContent className="border-zinc-800 bg-[#111114] text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              Live ComfyUI Inspection ({liveCatalogModal?.target.toUpperCase()})
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              {liveCatalogModal?.totalNodesAvailable || 0} nodes ·{" "}
              {liveCatalogModal?.checkpoints.length || 0} checkpoints in `/tmp/models`.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300">
            {liveCatalogModal?.checkpoints.length ? (
              liveCatalogModal.checkpoints.map((ckpt) => <div key={ckpt}>{ckpt}</div>)
            ) : (
              <div className="text-zinc-500">No checkpoints currently cached on this GPU.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
