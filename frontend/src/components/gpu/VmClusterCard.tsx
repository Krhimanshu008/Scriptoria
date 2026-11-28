"use client";

import {
  CANONICAL_LLM_PRESET,
  getDefaultPresetForLlmProfile,
} from "@/lib/llm/llm-model-presets";
import { getImagePacksForProfile } from "@/lib/catalog/image-model-packs";

import React, { useState } from "react";
import Link from "next/link";
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
  RefreshCw,
  X,
  Database,
  Plus,
  ChevronDown,
  ChevronRight,
  HardDrive,
  KeyRound,
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
  const attachedDatasets: string[] = primaryVm?.kaggleDatasets ?? [];
  const slotIdleOverride = primaryVm?.idleTimeoutMinutes ?? null;
  const [datasetDraft, setDatasetDraft] = useState("");
  const [buildingFastboot, setBuildingFastboot] = useState(false);
  const [fastbootBuildUrl, setFastbootBuildUrl] = useState<string | null>(null);
  const isLlmProfile = isLlmWorkerProfile(activeProfile.id);
  const defaultLlmPreset = getDefaultPresetForLlmProfile(activeProfile.id);
  const [selectedPackId, setSelectedPackId] = useState<string>("");
  const [selectedImageSlug, setSelectedImageSlug] = useState<string>("");
  const [showSingleFilePicker, setShowSingleFilePicker] = useState(false);
  const [showDiskFiles, setShowDiskFiles] = useState(false);
  const [modelControlLoading, setModelControlLoading] = useState<string | null>(null);
  const effectiveLlmPreset =
    activeProfile.id === "LLM_QWEN_VLM" ? CANONICAL_LLM_PRESET : defaultLlmPreset;
  const effectiveLlmPresetId = effectiveLlmPreset.id;
  const selectableProfiles = WORKER_PROFILE_LIST.filter(
    (p) =>
      p.accelerator !== "tpu" &&
      (!isLlmWorkerProfile(p.id) || p.id === CANONICAL_LLM_PRESET.profileId || p.id === activeProfile.id)
  );
  const profilePacks = getImagePacksForProfile(activeProfile.id);
  const effectivePackId = profilePacks.some((p) => p.id === selectedPackId)
    ? selectedPackId
    : profilePacks[0]?.id || "";
  const runtimeMode =
    primaryVm?.bootMetadata?.runtimeMode ||
    (isOnline ? (isLlmProfile ? "idle_empty" : "comfy_ready") : "offline");
  const activeModelName = primaryVm?.bootMetadata?.activeModelName ?? null;
  const autoLoadOnBoot = primaryVm?.bootMetadata?.autoLoadOnBoot === true;
  const freeDiskGb = primaryVm?.bootMetadata?.disk?.freeGb;
  const storageFiles = primaryVm?.bootMetadata?.storageFiles ?? [];
  const totalCachedGb =
    storageFiles.reduce((acc, f) => acc + (f.sizeBytes || 0), 0) / (1024 ** 3);
  const activeTransfer = primaryVm?.bootMetadata?.activeTransfer ?? null;
  const recentLog = primaryVm?.bootMetadata?.recentLog ?? null;
  const driveNeedsReconnect = primaryVm?.bootMetadata?.driveNeedsReconnect === true;
  const isModelReadyStep = isLlmProfile
    ? runtimeMode === "llm_ready" || storageFiles.some((f) => f.category === "llm")
    : storageFiles.length > 0;

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
      kaggleDatasets?: string[];
      autoLoadOnBoot?: boolean;
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

  async function handleAttachDataset() {
    const cleaned = datasetDraft.trim();
    if (!cleaned || !cleaned.includes("/")) {
      toast.error("Enter dataset as 'owner/dataset-slug' (e.g. himanshukr7532/scriptoria-comfy-env).");
      return;
    }
    if (attachedDatasets.includes(cleaned)) {
      setDatasetDraft("");
      return;
    }
    const next = [...attachedDatasets, cleaned].slice(0, 6);
    await patchBootConfig(primaryTarget, { kaggleDatasets: next }, `Attached FastBoot dataset ${cleaned}`);
    setDatasetDraft("");
  }

  async function handleRemoveDataset(slug: string) {
    const next = attachedDatasets.filter((d) => d !== slug);
    await patchBootConfig(primaryTarget, { kaggleDatasets: next }, `Detached ${slug}`);
  }

  async function handleTriggerDatasetBuild() {
    if (!primaryTarget || buildingFastboot) return;
    setBuildingFastboot(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(primaryTarget)}/build-fastboot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfile.id,
          ...(isLlmProfile ? { presetId: effectiveLlmPresetId } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to queue 0-GPU dataset build");
        return;
      }
      if (typeof body.url === "string") {
        setFastbootBuildUrl(body.url);
      }
      toast.success(
        isLlmProfile
          ? `Queued 0-GPU Qwen LLM Dataset builder (${body.presetId || activeProfile.shortTag})! Save Output → New Dataset when done.`
          : `Queued 0-GPU CPU FastBoot build (${activeProfile.shortTag})! Save Output → New Dataset when done.`
      );
      onRefresh();
    } finally {
      setBuildingFastboot(false);
    }
  }

  const profileModalities =
    activeProfile.id === "AUDIO_LIPSYNC"
      ? ["AUDIO", "VOICE"]
      : activeProfile.id === "VIDEO_MOTION"
      ? ["VIDEO"]
      : ["IMAGE"];
  const filteredByProfile = catalogChoices.filter((m) =>
    profileModalities.includes(String(m.modality || "").toUpperCase())
  );
  const profileCatalogChoices =
    filteredByProfile.length > 0 ? filteredByProfile : catalogChoices;

  async function handleModelControl(
    action:
      | "stage_llm"
      | "load_llm"
      | "unload_llm"
      | "keep_alive"
      | "free_vram"
      | "stage_image_model"
      | "stage_image_pack",
    extra?: { slug?: string; packId?: string; category?: string; filename?: string; force?: boolean }
  ) {
    if (!primaryTarget || modelControlLoading) return;
    setModelControlLoading(action);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(primaryTarget)}/model-control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "stage_llm" || action === "load_llm" ? { presetId: effectiveLlmPresetId } : {}),
          ...extra,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || `Failed to run ${action}`);
        return;
      }
      if (action === "stage_llm") {
        toast.success(`Staged ${effectiveLlmPreset.shortLabel} disk transfer on ${primaryTarget.toUpperCase()} (~5-10s).`);
      } else if (action === "load_llm") {
        toast.success(`Queued VRAM load for ${effectiveLlmPreset.shortLabel} on ${primaryTarget.toUpperCase()}.`);
      } else if (action === "unload_llm") {
        toast.success(`Unloaded LLM from VRAM -> Idle Empty Compute.`);
      } else if (action === "keep_alive") {
        toast.success(`Sent Watchdog +Keep Alive ping to ${primaryTarget.toUpperCase()}.`);
      } else if (action === "free_vram") {
        toast.success(`Cleared ComfyUI model cache & VRAM on ${primaryTarget.toUpperCase()}.`);
      } else if (action === "stage_image_model") {
        toast.success(
          body.result?.status === "skipped"
            ? "Image model already cached on VM!"
            : `Queued image model staging on ${primaryTarget.toUpperCase()}.`
        );
      } else if (action === "stage_image_pack") {
        const s = body.summary;
        toast.success(
          s
            ? `Pack '${body.packLabel}' on ${primaryTarget.toUpperCase()}: ${s.started} queued, ${s.skipped} cached${s.failed > 0 ? `, ${s.failed} failed` : ""}`
            : `Queued image model pack on ${primaryTarget.toUpperCase()}.`
        );
      }
      onRefresh();
    } catch {
      toast.error(`Network error executing ${action}`);
    } finally {
      setModelControlLoading(null);
    }
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
  const [syncLoading, setSyncLoading] = useState(false);
  const [permanentCellLoading, setPermanentCellLoading] = useState(false);
  const [permanentCopied, setPermanentCopied] = useState(false);
  const [rotateKeyOpen, setRotateKeyOpen] = useState(false);
  const [rotateKeyLoading, setRotateKeyLoading] = useState(false);

  const kaggleEditUrl =
    kind === "kaggle" && kaggleAccount?.username && kaggleAccount?.kernelSlug
      ? `https://www.kaggle.com/code/${kaggleAccount.username}/${kaggleAccount.kernelSlug}/edit`
      : null;

  async function fetchPermanentCellCode(): Promise<{
    pythonCode?: string;
    primaryUrl?: string;
    beaconUrl?: string | null;
    error?: string;
    ok: boolean;
  }> {
    if (!primaryTarget) return { ok: false, error: "No target available" };
    const res = await fetch(
      `/api/vm/kaggle/${encodeURIComponent(primaryTarget)}/notebook?format=python`
    );
    const data = await res.json();
    return {
      ok: res.ok,
      pythonCode: data.pythonCode,
      primaryUrl: data.primaryUrl,
      beaconUrl: data.beaconUrl,
      error: data.error,
    };
  }

  async function handleCopyPermanentCell() {
    if (!primaryTarget) return;
    setPermanentCellLoading(true);
    try {
      const data = await fetchPermanentCellCode();
      if (!data.ok || !data.pythonCode) {
        toast.error(data.error || "Failed to generate Permanent Cell code");
        return;
      }
      await navigator.clipboard.writeText(String(data.pythonCode));
      setPermanentCopied(true);
      setTimeout(() => setPermanentCopied(false), 2200);
      toast.success(
        `Copied permanent Kaggle cell (${data.beaconUrl ? "Drive beacon fallback enabled" : data.primaryUrl || "ready"}) — save in Kaggle & press Run anytime!`
      );
    } catch {
      toast.error("Failed to copy Permanent Kaggle Cell");
    } finally {
      setPermanentCellLoading(false);
    }
  }

  async function handleRotateKaggleKey() {
    if (!primaryTarget) return;
    setRotateKeyLoading(true);
    try {
      const res = await fetch(`/api/vm/kaggle/${encodeURIComponent(primaryTarget)}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate_key" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to rotate Kaggle runner key");
        return;
      }
      const nextCell = await fetchPermanentCellCode().catch(() => null);
      if (nextCell?.ok && nextCell.pythonCode) {
        await navigator.clipboard.writeText(String(nextCell.pythonCode)).catch(() => {});
      }
      setRotateKeyOpen(false);
      toast.success(
        nextCell?.ok && nextCell.pythonCode
          ? "Rotated permanent Kaggle key & copied updated cell to clipboard!"
          : "Rotated permanent Kaggle key. Copy a fresh Permanent Cell before your next run."
      );
      onRefresh();
    } catch {
      toast.error("Failed to rotate Kaggle runner key");
    } finally {
      setRotateKeyLoading(false);
    }
  }

  async function handleSyncVm() {
    if (!primaryTarget) return;
    setSyncLoading(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(primaryTarget)}/sync`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Sync request failed");
      }
      if (data.tunnelAlive) {
        toast.success(`VM Active & Verified! (${data.status})`);
      } else if (data.kaggleState) {
        const extraHint =
          (data.kaggleState === "cancelAcknowledged" || data.kaggleState === "complete") &&
          data.status === "OFFLINE"
            ? " — If a GPU Draft Session is open in Kaggle, use 'Draft Cell' and press Run."
            : "";
        toast.info(`Kaggle: ${data.kaggleState} (VM: ${data.status})${extraHint}`);
      } else {
        toast.success(`VM status synced: ${data.status}`);
      }
      onRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to sync VM status");
    } finally {
      setSyncLoading(false);
    }
  }

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
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to hot reload worker");
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
            {isOnline && (
              <span
                title={
                  isLlmProfile
                    ? activeModelName
                      ? `Loaded in VRAM: ${activeModelName}`
                      : "Pure Empty Compute: 0 models loaded"
                    : "ComfyUI Runtime Ready"
                }
                className={`hidden sm:inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                  isLlmProfile
                    ? runtimeMode === "llm_ready" && activeModelName
                      ? "bg-violet-500/15 text-violet-300 border border-violet-500/30"
                      : runtimeMode === "loading_model"
                      ? "bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse"
                      : "bg-cyan-500/10 text-cyan-300 border border-cyan-500/25"
                    : "bg-zinc-800/80 text-zinc-300 border border-zinc-700"
                }`}
              >
                {isLlmProfile
                  ? runtimeMode === "llm_ready" && activeModelName
                    ? `VRAM: ${activeModelName}`
                    : runtimeMode === "loading_model"
                    ? `Loading ${activeModelName || "model"}...`
                    : "Idle · Empty (0 Models)"
                  : "Comfy Ready"}
              </span>
            )}
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
          {vms.map((v, gpuIdx) => {
            const total = v.vramTotalGb || 16;
            const used = v.vramUsedGb || 0;
            const pct = Math.min(100, Math.round((used / total) * 100));
            const gpuOnline = v.status === "ONLINE" || v.status === "BUSY";
            const isEditingName = editingTargetName === v.target;
            const gpuDetail = primaryVm?.bootMetadata?.gpus?.[gpuIdx];

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
                  {gpuOnline && gpuDetail && (gpuDetail.tempC !== null || gpuDetail.powerW !== null) && (
                    <span
                      className={`hidden md:inline font-mono text-[10px] tabular-nums ${
                        (gpuDetail.tempC ?? 0) >= 82
                          ? "text-rose-300"
                          : (gpuDetail.tempC ?? 0) >= 75 || (gpuDetail.powerW ?? 0) >= 66
                          ? "text-amber-300"
                          : "text-zinc-400"
                      }`}
                    >
                      {gpuDetail.tempC !== null ? `${gpuDetail.tempC}°C` : "--"}
                      {gpuDetail.powerW !== null ? ` · ${gpuDetail.powerW}W` : ""}
                    </span>
                  )}
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
              {selectableProfiles.map((p) => (
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

        {/* Boot Policy & Optional Pre-warm Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex items-center gap-1.5 text-[10px] ${
                anyActive ? "text-zinc-500" : "cursor-pointer text-zinc-300 hover:text-white"
              }`}
              title="Off by default: boots pure empty GPU/CUDA runtime with 0 models downloaded. Enable to auto-download/load on boot."
            >
              <input
                type="checkbox"
                checked={autoLoadOnBoot}
                disabled={anyActive || savingConfig}
                onChange={(e) =>
                  patchBootConfig(
                    primaryTarget,
                    { autoLoadOnBoot: e.target.checked },
                    e.target.checked
                      ? `Enabled auto-load on boot for ${primaryTarget.toUpperCase()}`
                      : `Switched ${primaryTarget.toUpperCase()} to Pure Empty Compute Boot (0 models)`
                  )
                }
                className="h-3 w-3 rounded border-zinc-700 bg-zinc-900 accent-violet-500"
              />
              <span className="font-medium">Auto-load on boot</span>
              {!autoLoadOnBoot && (
                <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300">
                  Setup-Only Boot (0 models) · load packs after boot
                </span>
              )}
            </label>

            {!isLlmProfile && (
              <>
                <span className="text-zinc-700">|</span>
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
              </>
            )}
          </div>

          {!isLlmProfile && (
            <select
              value=""
              disabled={anyActive || savingConfig || selectedPrewarm.length >= 3}
              onChange={(e) => handleAddPrewarm(e.target.value)}
              className="max-w-[165px] rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300 disabled:opacity-40"
            >
              <option value="" className="bg-zinc-900">
                + Queue model ({selectedPrewarm.length}/3)
              </option>
              {profileCatalogChoices.map((m) => (
                <option key={m.slug} value={m.slug} className="bg-zinc-900">
                  [{m.modality}] {m.displayName}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* FastBoot / Qwen LLM Kaggle Dataset Row */}
        {kind === "kaggle" && activeProfile.accelerator !== "tpu" && (
          <div className="space-y-1.5 rounded-md border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Database className="h-3 w-3 text-cyan-400" />
                <span className="text-[10px] font-medium text-zinc-400">
                  {isLlmProfile ? "Qwen LLM Dataset:" : "FastBoot Dataset:"}
                </span>
                {attachedDatasets.length === 0 ? (
                  <span className="text-[10px] text-zinc-600">
                    {isLlmProfile ? "None (Empty boot 0 GB -> load on demand)" : "None (Cold Boot ~150s)"}
                  </span>
                ) : (
                  attachedDatasets.map((ds) => (
                    <span
                      key={ds}
                      className="inline-flex items-center gap-1 rounded border border-cyan-500/35 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-200"
                    >
                      {ds}
                      {!anyActive && (
                        <button
                          type="button"
                          onClick={() => handleRemoveDataset(ds)}
                          className="text-cyan-400/80 hover:text-white"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {isLlmProfile && (
                  <span
                    className="inline-flex h-6 items-center rounded border border-violet-500/30 bg-violet-950/30 px-2 font-mono text-[10px] text-violet-200"
                    title="Canonical single-model Qwen3.8-27B GGUF + mmproj-F16 dataset bundle (<19.5 GiB)"
                  >
                    {effectiveLlmPreset.shortLabel} (~{effectiveLlmPreset.approxDiskGb}G)
                  </span>
                )}
                <button
                  type="button"
                  disabled={buildingFastboot || savingConfig || !kaggleAccount?.configured}
                  onClick={handleTriggerDatasetBuild}
                  title={
                    isLlmProfile
                      ? "Run 0-GPU CPU Kaggle notebook to download Qwen GGUF + mmproj into Output for 1-click New Dataset"
                      : "Run 0-GPU CPU notebook on Kaggle to build comfy_env.tar.gz for FastBoot"
                  }
                  className="inline-flex items-center gap-1 rounded border border-indigo-500/35 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-40"
                >
                  {buildingFastboot ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Zap className="h-2.5 w-2.5" />}
                  {isLlmProfile ? "Build Qwen Dataset (0 GPU)" : "Build CPU Cache (0 GPU)"}
                </button>
              </div>
            </div>
            {!anyActive && (
              <div className="space-y-1.5">
                {fastbootBuildUrl && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[10px] text-indigo-200">
                    <span>
                      {isLlmProfile
                        ? "0-GPU Qwen download queued. When done, open Output -> New Dataset:"
                        : "CPU build queued (0 GPU quota). Once finished (~3m), save Output → New Dataset:"}
                    </span>
                    <a
                      href={fastbootBuildUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono font-semibold text-cyan-300 underline hover:text-white"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      Open {isLlmProfile ? "ml-llm-dataset-builder" : "ml-env-cache-builder"}
                    </a>
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAttachDataset();
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    value={datasetDraft}
                    onChange={(e) => setDatasetDraft(e.target.value)}
                    placeholder={
                      isLlmProfile
                        ? "Attach Qwen Kaggle dataset slug (e.g. krhimanshu001/scriptoria-qwen-llm)"
                        : "Attach Kaggle dataset slug (e.g. himanshukr7532/scriptoria-comfy-env)"
                    }
                    className="h-6 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 font-mono text-[10px] text-zinc-200 placeholder:text-zinc-600"
                  />
                  {attachedDatasets.length === 0 && kaggleAccount?.username && (
                    <button
                      type="button"
                      disabled={savingConfig}
                      onClick={() => {
                        const slug = isLlmProfile
                          ? `${kaggleAccount.username}/scriptoria-qwen-llm`
                          : `${kaggleAccount.username}/scriptoria-comfy-env`;
                        patchBootConfig(
                          primaryTarget,
                          { kaggleDatasets: [slug] },
                          `Attached dataset ${slug}`
                        );
                      }}
                      className="h-6 shrink-0 rounded border border-cyan-500/35 bg-cyan-500/10 px-2 font-mono text-[10px] text-cyan-200 hover:bg-cyan-500/20"
                    >
                      + {kaggleAccount.username}/{isLlmProfile ? "scriptoria-qwen-llm" : "scriptoria-comfy-env"}
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={savingConfig || !datasetDraft.trim()}
                    className="inline-flex h-6 items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 text-[10px] font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
                  >
                    <Plus className="h-2.5 w-2.5" />
                    Attach
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* Decoupled Online Model & VRAM Loader Strip */}
        {isOnline && (
          <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/75 px-2.5 py-2">
            {/* Guided 3-Step Flow */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-1.5 text-[10px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-emerald-300">
                  1. Setup Boot ✓
                </span>
                <span className="text-zinc-600">→</span>
                <span
                  className={`rounded px-1.5 py-0.5 font-mono ${
                    isModelReadyStep
                      ? "bg-emerald-500/15 text-emerald-300"
                      : activeTransfer
                      ? "bg-cyan-500/15 text-cyan-300"
                      : "bg-amber-500/15 text-amber-300"
                  }`}
                >
                  2.{" "}
                  {activeTransfer
                    ? "Staging Model..."
                    : isModelReadyStep
                    ? "Model Ready ✓"
                    : "Stage / Load Model"}
                </span>
                <span className="text-zinc-600">→</span>
                <Link
                  href={isLlmProfile ? "/llm-studio" : "/studio"}
                  className="rounded border border-indigo-500/35 bg-indigo-500/15 px-1.5 py-0.5 font-mono font-medium text-indigo-200 hover:bg-indigo-500/25"
                >
                  3. Open {isLlmProfile ? "LLM Studio" : "Studio"} →
                </Link>
              </div>
              {typeof freeDiskGb === "number" && (
                <span className="font-mono text-zinc-500">
                  /tmp free: <span className="text-zinc-300">{freeDiskGb.toFixed(1)} GB</span>
                </span>
              )}
            </div>

            {driveNeedsReconnect && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                  Google Drive OAuth expired (invalid_grant). Retries paused.
                </span>
                <Link
                  href="/settings/vault"
                  className="rounded border border-amber-400/40 bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-100 hover:bg-amber-500/30"
                >
                  Reconnect Drive →
                </Link>
              </div>
            )}

            {activeTransfer && (
              <div className="space-y-1 rounded border border-cyan-500/35 bg-cyan-950/25 px-2 py-1.5 text-[10px]">
                <div className="flex items-center justify-between gap-2 font-mono text-cyan-200">
                  <span className="truncate font-medium">
                    Downloading {activeTransfer.filename}
                    {(activeTransfer.queueCount ?? 1) > 1
                      ? ` (+${(activeTransfer.queueCount ?? 1) - 1} queued)`
                      : ""}
                  </span>
                  <span className="shrink-0">
                    {activeTransfer.percentage}%
                    {activeTransfer.speedMbps ? ` · ${activeTransfer.speedMbps.toFixed(1)} MB/s` : ""}
                    {activeTransfer.totalBytes
                      ? ` · ${((activeTransfer.bytesDone || 0) / 1024 ** 3).toFixed(1)}/${(activeTransfer.totalBytes / 1024 ** 3).toFixed(1)} GB`
                      : ""}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-300"
                    style={{
                      width: `${Math.max(2, Math.min(100, activeTransfer.percentage))}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
              <span className="font-semibold uppercase tracking-wide text-zinc-400">
                {isLlmProfile ? "LLM Model & VRAM Loader" : `Model Pack Loader (${activeProfile.shortTag})`}
              </span>
              {isLlmProfile ? (
                activeModelName ? (
                  <span className="font-mono text-[10px] text-violet-300 truncate max-w-[200px]">
                    Active: {activeModelName}
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-zinc-500">VRAM empty (0 models)</span>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSingleFilePicker((v) => !v)}
                  className="font-mono text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  {showSingleFilePicker ? "Hide single file" : "+ Single file"}
                </button>
              )}
            </div>

            {isLlmProfile ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-flex h-7 min-w-0 flex-1 items-center rounded border border-violet-500/35 bg-violet-950/25 px-2 font-mono text-[10px] text-violet-100"
                  title={effectiveLlmPreset.notes}
                >
                  {effectiveLlmPreset.shortLabel} (~{effectiveLlmPreset.approxDiskGb}G disk · {effectiveLlmPreset.approxVramGb}G VRAM · 53:47 split)
                </span>
                <button
                  type="button"
                  disabled={Boolean(modelControlLoading)}
                  onClick={() => handleModelControl("stage_llm")}
                  className="inline-flex h-7 items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 text-[10px] font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-45"
                  title="Download/verify GGUF onto /tmp disk only (0 VRAM used)"
                >
                  {modelControlLoading === "stage_llm" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                  Stage Disk
                </button>
                <button
                  type="button"
                  disabled={Boolean(modelControlLoading)}
                  onClick={() => handleModelControl("load_llm")}
                  className="inline-flex h-7 items-center gap-1 rounded border border-violet-500/45 bg-violet-600/20 px-2.5 text-[10px] font-medium text-violet-200 hover:bg-violet-600/35 disabled:opacity-45"
                  title="Mount or download GGUF and launch llama-server into VRAM"
                >
                  {modelControlLoading === "load_llm" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                  Load VRAM
                </button>
                <button
                  type="button"
                  disabled={Boolean(modelControlLoading) || (runtimeMode === "idle_empty" && !activeModelName)}
                  onClick={() => handleModelControl("unload_llm")}
                  className="inline-flex h-7 items-center gap-1 rounded border border-rose-500/35 bg-rose-500/10 px-2 text-[10px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
                  title="Unload model processes and free all GPU VRAM -> Idle Empty"
                >
                  {modelControlLoading === "unload_llm" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                  Unload
                </button>
                <button
                  type="button"
                  disabled={Boolean(modelControlLoading)}
                  onClick={() => handleModelControl("keep_alive")}
                  className="inline-flex h-7 items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 px-2 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                  title="Reset idle watchdog timer without interrupting inference"
                >
                  {modelControlLoading === "keep_alive" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                  +Keep Alive
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={effectivePackId}
                    disabled={Boolean(modelControlLoading)}
                    onChange={(e) => setSelectedPackId(e.target.value)}
                    className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 font-mono text-[10px] text-zinc-200"
                  >
                    {profilePacks.map((pack) => (
                      <option key={pack.id} value={pack.id} className="bg-zinc-900">
                        {pack.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={Boolean(modelControlLoading) || !effectivePackId}
                    onClick={() =>
                      handleModelControl("stage_image_pack", {
                        packId: effectivePackId,
                      })
                    }
                    className="inline-flex h-7 items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-2.5 text-[10px] font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-45"
                    title="Queue all checkpoints, encoders, LoRAs, and VAE in this pack onto /tmp/models"
                  >
                    {modelControlLoading === "stage_image_pack" && (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    )}
                    Stage Pack
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(modelControlLoading)}
                    onClick={() => handleModelControl("free_vram")}
                    className="inline-flex h-7 items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-2 text-[10px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-45"
                    title="Call ComfyUI /free to unload checkpoint & clear VRAM"
                  >
                    {modelControlLoading === "free_vram" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                    Free VRAM
                  </button>
                </div>

                {showSingleFilePicker && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={selectedImageSlug || profileCatalogChoices[0]?.slug || ""}
                      disabled={Boolean(modelControlLoading)}
                      onChange={(e) => setSelectedImageSlug(e.target.value)}
                      className="h-7 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 font-mono text-[10px] text-zinc-200"
                    >
                      {profileCatalogChoices.map((m) => (
                        <option key={m.slug} value={m.slug} className="bg-zinc-900">
                          [{m.modality}] {m.displayName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={
                        Boolean(modelControlLoading) ||
                        !(selectedImageSlug || profileCatalogChoices[0]?.slug)
                      }
                      onClick={() =>
                        handleModelControl("stage_image_model", {
                          slug: selectedImageSlug || profileCatalogChoices[0]?.slug,
                        })
                      }
                      className="inline-flex h-7 items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 text-[10px] font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-45"
                    >
                      {modelControlLoading === "stage_image_model" && (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      )}
                      Stage File
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Expandable On-Disk Cache Inventory & Last Activity */}
            <div className="space-y-1 border-t border-zinc-800/70 pt-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                <button
                  type="button"
                  onClick={() => setShowDiskFiles((v) => !v)}
                  className="inline-flex items-center gap-1 font-mono text-zinc-400 hover:text-zinc-200"
                >
                  {showDiskFiles ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <HardDrive className="h-3 w-3 text-zinc-500" />
                  <span>
                    On disk: <strong className="text-zinc-200">{storageFiles.length}</strong> file
                    {storageFiles.length === 1 ? "" : "s"} ({totalCachedGb.toFixed(1)} GB)
                  </span>
                </button>
              </div>

              {showDiskFiles && (
                <div className="max-h-28 space-y-0.5 overflow-y-auto rounded border border-zinc-800/80 bg-zinc-900/60 px-2 py-1.5 font-mono text-[10px]">
                  {storageFiles.length === 0 ? (
                    <div className="text-zinc-500">
                      0 models cached on disk yet (Setup-Only Boot). Stage a pack or model above.
                    </div>
                  ) : (
                    storageFiles.map((f) => {
                      const sizeMb = (f.sizeBytes || 0) / (1024 * 1024);
                      const sizeLabel =
                        sizeMb >= 1024
                          ? `${(sizeMb / 1024).toFixed(2)} GB`
                          : `${sizeMb.toFixed(0)} MB`;
                      return (
                        <div
                          key={`${f.category}/${f.name}`}
                          className="flex items-center justify-between gap-2 text-zinc-300"
                        >
                          <span className="truncate">
                            <span className="text-zinc-500">{f.category}/</span>
                            {f.name}
                          </span>
                          <span className="shrink-0 text-zinc-400">{sizeLabel}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {recentLog && (
                <div className="truncate font-mono text-[10px] text-zinc-500">
                  &gt; {recentLog}
                </div>
              )}
            </div>
          </div>
        )}

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

          <button
            type="button"
            onClick={handleSyncVm}
            disabled={syncLoading || actionLoading}
            title="Fetch & sync active status from Kaggle and live VM tunnel"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-blue-500/40 bg-blue-500/15 px-2 text-xs font-medium text-blue-200 hover:bg-blue-500/25 transition disabled:opacity-40"
          >
            {syncLoading ? (
              <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
            ) : (
              <RefreshCw className="h-3 w-3 text-blue-400" />
            )}
            Fetch VM
          </button>

          {kind === "kaggle" && (
            <>
              <button
                type="button"
                onClick={handleCopyPermanentCell}
                disabled={permanentCellLoading || !kaggleAccount?.configured}
                title="Copy reusable permanent Kaggle Interactive cell (no expiry; auto-discovers tunnel URL via Drive beacon)"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
              >
                {permanentCellLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : permanentCopied ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                Permanent Cell
              </button>

              {kaggleEditUrl && (
                <a
                  href={kaggleEditUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${kaggleAccount?.kernelSlug} in Kaggle Interactive Editor (/edit)`}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] font-medium text-zinc-200 hover:border-violet-500/40 hover:bg-zinc-800"
                >
                  Open Kaggle
                  <ExternalLink className="h-3 w-3 text-zinc-400" />
                </a>
              )}

              <button
                type="button"
                onClick={() => setRotateKeyOpen(true)}
                disabled={!kaggleAccount?.configured}
                title="Rotate permanent Kaggle runner key (revokes old saved cells)"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] font-medium text-zinc-300 hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-200 disabled:opacity-40"
              >
                <KeyRound className="h-3 w-3" />
                Rotate Key
              </button>
            </>
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

      <Dialog open={rotateKeyOpen} onOpenChange={setRotateKeyOpen}>
        <DialogContent className="border-zinc-800 bg-[#111114] text-zinc-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-amber-400" />
              Rotate Permanent Kaggle Runner Key
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Rotating the key for{" "}
              <span className="font-mono text-zinc-200">
                {kaggleAccount?.displayName || primaryTarget}
              </span>{" "}
              immediately invalidates any previously copied Kaggle Permanent Cells for this VM
              slot. Clicking Stop only ends the active container and keeps your existing key intact.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRotateKeyOpen(false)}
              disabled={rotateKeyLoading}
              className="inline-flex h-8 items-center rounded-md border border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRotateKaggleKey}
              disabled={rotateKeyLoading}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {rotateKeyLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )}
              Rotate Key &amp; Copy Cell
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
