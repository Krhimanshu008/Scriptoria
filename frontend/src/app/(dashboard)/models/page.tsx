"use client";

import React, { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  HardDriveDownload,
  RefreshCw,
  Loader2,
  FolderOpen,
  Cloud,
  HardDrive,
  Trash2,
  CheckCircle2,
  Sparkles,
  Plus,
  Search,
  Zap,
  CloudUpload,
  Cpu,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { VmStoredModelItem } from "@/lib/orchestrator/rclone-client";
import { useClusterStore } from "@/store/cluster-store";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const CATEGORIES = [
  "checkpoints",
  "unet",
  "text_encoders",
  "vae",
  "loras",
  "controlnet",
  "ipadapter",
  "clip_vision",
  "upscale_models",
  "ultralytics",
  "sams",
  "tts",
  "audio_sfx",
  "audio_bgm",
  "lipsync",
];

const MODALITIES = ["ALL", "IMAGE", "AUDIO", "VIDEO", "SHARED"];

interface CatalogModelItem {
  id: string;
  slug: string;
  displayName: string;
  modality: string;
  category: string;
  subdir: string;
  filename: string;
  sizeBytes: number | null;
  vramEstimateGb: number;
  compatibleBase: string;
  requiredCustomNodes: string[];
  recommendedConfig: { notes?: string; steps?: number; cfg?: number; sampler?: string } | null;
  hfRepoId: string | null;
  hfFilePath: string | null;
  civitaiModelId: string | null;
  civitaiVersionId: string | null;
  directUrl: string | null;
  backupStatus: string;
  gdrivePath: string | null;
}

interface GDriveModelFile {
  id: string;
  name: string;
  category: string;
  sizeBytes: number;
  modifiedTime?: string;
}

export default function ModelsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"catalog" | "drive">("catalog");
  const [modality, setModality] = useState("ALL");
  const [catalogCat, setCatalogCat] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("checkpoints");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [fetchingSlug, setFetchingSlug] = useState<string | null>(null);
  const [mirroring, setMirroring] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [inspectUrl, setInspectUrl] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFilename, setNewFilename] = useState("");
  const [newCategory, setNewCategory] = useState("checkpoints");
  const [newModality, setNewModality] = useState("IMAGE");
  const [newBase, setNewBase] = useState("SDXL");
  const [newSizeBytes, setNewSizeBytes] = useState<string>("");
  const [newHfRepo, setNewHfRepo] = useState("");
  const [newHfPath, setNewHfPath] = useState("");
  const [newCivitaiModel, setNewCivitaiModel] = useState("");
  const [newCivitaiVer, setNewCivitaiVer] = useState("");
  const [newDirectUrl, setNewDirectUrl] = useState("");
  const [newSha256, setNewSha256] = useState("");
  const [savingNew, setSavingNew] = useState(false);

  const target = useClusterStore((s) => s.selectedTarget);
  const setSelectedTarget = useClusterStore((s) => s.setSelectedTarget);
  const startStream = useClusterStore((s) => s.startStream);
  const activeStream = useClusterStore((s) => s.activeStream);

  const { data: vmData } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 4000,
  });

  const vms = vmData?.vms ?? [];
  const activeVm = vms.find((v) => v.target === target);
  const isTargetOnline = activeVm?.status === "ONLINE";

  const {
    data: catalogRes,
    isLoading: catalogLoading,
    refetch: refetchCatalog,
    isFetching: catalogFetching,
  } = useQuery<{ models: CatalogModelItem[] }>({
    queryKey: ["master-catalog", modality, catalogCat],
    queryFn: async () => {
      const qs = new URLSearchParams({ modality, category: catalogCat });
      const res = await fetch(`/api/catalog?${qs.toString()}`);
      if (!res.ok) throw new Error("Failed to load model catalog");
      return res.json();
    },
    staleTime: 30_000,
  });

  const { data, isLoading, error, refetch, isFetching } = useQuery<{
    baseFolder: string;
    category: string;
    files: GDriveModelFile[];
    source: string;
  }>({
    queryKey: ["gdrive-models", category],
    enabled: tab === "drive",
    queryFn: async () => {
      const res = await fetch(
        `/api/models/list?category=${encodeURIComponent(category)}&target=${encodeURIComponent(target)}`
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to list Google Drive models");
      return body;
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });

  const {
    data: storageData,
    isFetching: fetchingStorage,
    refetch: refetchStorage,
  } = useQuery<{
    target: string;
    disk: { totalGb: number; usedGb: number; freeGb: number } | null;
    files: VmStoredModelItem[];
    source: string;
  }>({
    queryKey: ["vm-storage", target],
    enabled: Boolean(isTargetOnline),
    queryFn: async () => {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/storage`);
      if (!res.ok) throw new Error("Failed to read VM /tmp/models");
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });

  const cachedFiles = storageData?.files ?? [];
  const cachedSet = new Set(cachedFiles.map((f) => `${f.category}/${f.name}`));

  const catalogModels = (catalogRes?.models ?? []).filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.displayName.toLowerCase().includes(q) ||
      m.filename.toLowerCase().includes(q) ||
      m.compatibleBase.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q)
    );
  });

  async function handleFastEnsure(model: CatalogModelItem, preferSource: "auto" | "gdrive" = "auto") {
    setFetchingSlug(model.slug);
    try {
      const res = await fetch("/api/catalog/ensure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          slug: model.slug,
          backupToGdrive: true,
          preferSource,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || `Failed to fetch ${model.filename}`);
        return;
      }

      if (body.status === "skipped") {
        toast.success(`${model.filename} is already cached on ${target.toUpperCase()} (/tmp)`);
        queryClient.invalidateQueries({ queryKey: ["vm-storage", target] });
        return;
      }

      if (body.transport === "sidecar-fetch") {
        toast.success(
          `Direct ${String(body.source || "HF/Civitai").toUpperCase()} fetch started for ${model.filename} (+ 5TB Drive backup)`
        );
        startStream({
          target,
          fetchJobId: body.fetchJobId ?? null,
          transport: "sidecar-fetch",
          modelName: model.filename,
          category: model.category,
        });
      } else {
        toast.success(`Streaming ${model.filename} from 5TB Drive -> ${target.toUpperCase()}`);
        startStream({
          target,
          jobId: body.jobid ?? null,
          transport: "rclone-gdrive",
          modelName: model.filename,
          category: model.category,
        });
      }
      refetchCatalog();
    } catch {
      toast.error("Network error initiating model fetch");
    } finally {
      setFetchingSlug(null);
    }
  }

  async function handleCpuMirrorBatch() {
    setMirroring(true);
    try {
      const res = await fetch("/api/catalog/mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountAlias: "acc1", limit: 6 }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to launch CPU mirror job");
        return;
      }
      if (body.queuedCount === 0) {
        toast.success(body.message || "All remote catalog models are already backed up.");
      } else {
        toast.success(
          `Queued 0-GPU-Quota Kaggle CPU mirror for ${body.queuedCount} model(s) -> 5TB Drive!`
        );
      }
    } finally {
      setMirroring(false);
    }
  }

  async function handleInspectRemoteUrl() {
    if (!inspectUrl.trim()) return;
    setInspecting(true);
    try {
      const res = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inspect_url", url: inspectUrl.trim() }),
      });
      const body = await res.json();
      if (!res.ok || !body.metadata) {
        toast.error(body.error || "Could not parse URL");
        return;
      }
      const m = body.metadata;
      setNewName(m.displayName || "");
      setNewFilename(m.filename || "");
      if (m.suggestedCategory) setNewCategory(m.suggestedCategory);
      if (m.compatibleBase) setNewBase(m.compatibleBase);
      if (m.sizeBytes) setNewSizeBytes(String(m.sizeBytes));
      setNewHfRepo(m.hfRepoId || "");
      setNewHfPath(m.hfFilePath || "");
      setNewCivitaiModel(m.civitaiModelId || "");
      setNewCivitaiVer(m.civitaiVersionId || "");
      setNewDirectUrl(m.directUrl || "");
      setNewSha256(m.sha256 || "");
      toast.success(`Resolved ${m.sourceKind.toUpperCase()} metadata for ${m.filename}`);
    } finally {
      setInspecting(false);
    }
  }

  async function handleSaveCustomModel(e: React.FormEvent) {
    e.preventDefault();
    setSavingNew(true);
    try {
      const res = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: newName,
          filename: newFilename,
          category: newCategory,
          modality: newModality,
          compatibleBase: newBase,
          sizeBytes: newSizeBytes ? Number(newSizeBytes) : null,
          hfRepoId: newHfRepo || null,
          hfFilePath: newHfPath || null,
          civitaiModelId: newCivitaiModel || null,
          civitaiVersionId: newCivitaiVer || null,
          directUrl: newDirectUrl || null,
          sha256: newSha256 || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to save model");
        return;
      }
      toast.success(`Added ${newName} to Master Catalog`);
      setShowAddForm(false);
      setInspectUrl("");
      setNewName("");
      setNewFilename("");
      refetchCatalog();
    } finally {
      setSavingNew(false);
    }
  }

  async function handleStreamModel(
    fileName: string,
    opts?: { expectedSizeBytes?: number; force?: boolean }
  ) {
    try {
      const res = await fetch("/api/models/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          category,
          name: fileName,
          expectedSizeBytes: opts?.expectedSizeBytes,
          force: opts?.force ?? false,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to start model stream");
        return;
      }

      if (body.status === "skipped") {
        toast.success(`${fileName} is already cached on ${target.toUpperCase()} (/tmp)`);
        queryClient.invalidateQueries({ queryKey: ["vm-storage", target] });
        queryClient.invalidateQueries({ queryKey: ["vm-catalog", target] });
        return;
      }

      toast.success(
        body.status === "already_transferring"
          ? `Attached to active download: ${fileName}`
          : `Streaming ${fileName} ➔ ${target.toUpperCase()} (/tmp/models/${category})`
      );
      startStream({
        target,
        jobId: body.jobid ?? null,
        transport: "rclone-gdrive",
        modelName: fileName,
        category,
      });
    } catch {
      toast.error("Network error initiating stream");
    }
  }

  async function handleDeleteCached(fileCat: string, fileName: string) {
    const key = `${fileCat}/${fileName}`;
    if (!confirm(`Remove ${key} from ${target.toUpperCase()} /tmp cache?`)) return;
    setDeletingKey(key);
    try {
      const res = await fetch(
        `/api/vm/${encodeURIComponent(target)}/storage?category=${encodeURIComponent(fileCat)}&name=${encodeURIComponent(fileName)}`,
        { method: "DELETE" }
      );
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to remove cached file");
        return;
      }
      toast.success(`Removed ${fileName} from ${target.toUpperCase()} /tmp`);
      queryClient.invalidateQueries({ queryKey: ["vm-storage", target] });
      queryClient.invalidateQueries({ queryKey: ["vm-catalog", target] });
    } catch {
      toast.error("Failed to remove file from VM");
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Master Model Catalog &amp; 5 TB Drive Vault
          </h1>
          <p className="text-xs text-zinc-400">
            Fetch Image, Audio &amp; Video models directly from HuggingFace / Civitai into VM{" "}
            <code>/tmp/models</code> with automatic 5 TB Google Drive backup.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={target}
            onChange={(e) => setSelectedTarget(e.target.value, true)}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
          >
            {(vms.length > 0
              ? vms
              : [
                  { target: "gpu0", status: "OFFLINE" },
                  { target: "gpu1", status: "OFFLINE" },
                  { target: "gpu2", status: "OFFLINE" },
                  { target: "gpu3", status: "OFFLINE" },
                  { target: "gcgpu", status: "OFFLINE" },
                  { target: "gcgpu1", status: "OFFLINE" },
                ]
            ).map((v) => (
              <option key={v.target} value={v.target}>
                {v.target.toUpperCase()} ({v.status})
              </option>
            ))}
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCpuMirrorBatch}
            disabled={mirroring}
            title="Use Kaggle CPU worker (0 GPU quota) to mirror unbacked-up models from HF/Civitai into your 5TB Drive"
            className="border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-200 hover:bg-emerald-500/20"
          >
            {mirroring ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Cpu className="mr-1.5 h-3.5 w-3.5" />
            )}
            0-GPU Mirror to 5TB Drive
          </Button>

          <Button
            size="sm"
            onClick={() => setShowAddForm((v) => !v)}
            className="bg-indigo-600 text-xs text-white hover:bg-indigo-500"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add HF / Civitai URL
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchCatalog();
              if (tab === "drive") refetch();
              if (isTargetOnline) refetchStorage();
            }}
            disabled={isFetching || fetchingStorage || catalogFetching}
            className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${
                isFetching || fetchingStorage || catalogFetching ? "animate-spin" : ""
              }`}
            />
            Sync
          </Button>
        </div>
      </div>

      {/* Add Model via HF / Civitai URL */}
      {showAddForm && (
        <form onSubmit={handleSaveCustomModel} className="glass-panel space-y-4 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles className="h-4 w-4 text-amber-400" />
              Add Model from HuggingFace, Civitai, or Direct URL
            </span>
          </div>

          <div className="flex gap-2">
            <Input
              value={inspectUrl}
              onChange={(e) => setInspectUrl(e.target.value)}
              placeholder="Paste https://huggingface.co/... or https://civitai.com/models/..."
            />
            <Button
              type="button"
              onClick={handleInspectRemoteUrl}
              disabled={inspecting || !inspectUrl.trim()}
              className="shrink-0 bg-amber-600 text-xs text-white hover:bg-amber-500"
            >
              {inspecting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Auto-Detect
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label>Display Name</Label>
              <Input required value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Exact Filename</Label>
              <Input required value={newFilename} onChange={(e) => setNewFilename(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Modality</Label>
              <select
                value={newModality}
                onChange={(e) => setNewModality(e.target.value)}
                className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
              >
                {["IMAGE", "AUDIO", "VIDEO", "SHARED"].map((m) => (
                  <option key={m} value={m} className="bg-zinc-900">
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>ComfyUI Category</Label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="glass-input w-full rounded-xl px-3 py-2 text-xs text-zinc-100"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-zinc-900">
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>HF Repo ID (optional)</Label>
              <Input value={newHfRepo} onChange={(e) => setNewHfRepo(e.target.value)} placeholder="owner/repo" />
            </div>
            <div className="space-y-1">
              <Label>Civitai Version ID (optional)</Label>
              <Input value={newCivitaiVer} onChange={(e) => setNewCivitaiVer(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Compatible Base</Label>
              <Input value={newBase} onChange={(e) => setNewBase(e.target.value)} placeholder="SDXL / Flux1 / Audio" />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={savingNew} className="bg-indigo-600 text-white">
              {savingNew ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Save to Catalog
            </Button>
          </div>
        </form>
      )}

      {/* Active Stream Card */}
      {activeStream?.active && (
        <div
          className={`rounded-2xl border p-4 ${
            activeStream.completed
              ? "border-emerald-500/40 bg-emerald-950/20"
              : "border-indigo-500/40 bg-indigo-950/20"
          }`}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span
              className={`font-mono font-semibold ${
                activeStream.completed ? "text-emerald-300" : "text-indigo-300"
              }`}
            >
              {activeStream.completed ? "Loaded" : "Fetching"} {activeStream.modelName} ➔{" "}
              {activeStream.target.toUpperCase()} ({activeStream.transport || "stream"})
            </span>
            <span className="font-mono text-zinc-200">
              {activeStream.percentage}% · {activeStream.speedText}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full transition-all duration-300 ${
                activeStream.completed ? "bg-emerald-500" : "bg-indigo-500"
              }`}
              style={{ width: `${activeStream.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        <button
          type="button"
          onClick={() => setTab("catalog")}
          className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition ${
            tab === "catalog"
              ? "bg-indigo-600 text-white"
              : "bg-white/[0.04] text-zinc-400 hover:text-white"
          }`}
        >
          Master Catalog ({catalogModels.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("drive")}
          className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition ${
            tab === "drive"
              ? "bg-indigo-600 text-white"
              : "bg-white/[0.04] text-zinc-400 hover:text-white"
          }`}
        >
          5 TB Google Drive Browser &amp; /tmp Cache
        </button>
      </div>

      {tab === "catalog" ? (
        <div className="space-y-4">
          {/* Modality & Search Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {MODALITIES.map((mod) => (
                <button
                  key={mod}
                  type="button"
                  onClick={() => setModality(mod)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                    modality === mod
                      ? "border-indigo-500 bg-indigo-600 text-white"
                      : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {mod}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={catalogCat}
                onChange={(e) => setCatalogCat(e.target.value)}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200"
              >
                <option value="all">All Categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models, GGUF, TTS..."
                  className="glass-input w-56 rounded-xl py-1.5 pl-8 pr-3 text-xs text-zinc-100"
                />
              </div>
            </div>
          </div>

          <div className="glass-panel divide-y divide-white/10 rounded-2xl p-4">
            {catalogLoading ? (
              <div className="flex items-center justify-center py-12 text-xs text-zinc-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Master Catalog...
              </div>
            ) : catalogModels.length === 0 ? (
              <div className="py-10 text-center text-xs text-zinc-500">
                No catalog models match your current filter.
              </div>
            ) : (
              catalogModels.map((m) => {
                const relPath = m.subdir ? `${m.subdir}/${m.filename}` : m.filename;
                const isCached = cachedSet.has(`${m.category}/${relPath}`);
                const hasDirect = Boolean(m.hfRepoId || m.civitaiModelId || m.civitaiVersionId || m.directUrl);

                return (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-4 py-3.5"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-white">{m.displayName}</span>
                        <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
                          {m.modality} · {m.category}
                        </span>
                        <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                          {m.compatibleBase} · {m.vramEstimateGb} GB VRAM
                        </span>
                        {m.hfRepoId && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                            HF
                          </span>
                        )}
                        {(m.civitaiModelId || m.civitaiVersionId) && (
                          <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                            Civitai
                          </span>
                        )}
                        {m.backupStatus === "BACKED_UP" && (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                            <CloudUpload className="h-3 w-3" /> 5TB Drive ✓
                          </span>
                        )}
                        {m.backupStatus === "BACKING_UP" && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                            Backing up...
                          </span>
                        )}
                        {isCached && (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" /> On {target.toUpperCase()}
                          </span>
                        )}
                      </div>

                      <div className="font-mono text-[11px] text-zinc-400">
                        {relPath}
                        {m.sizeBytes ? ` · ${formatBytes(m.sizeBytes)}` : ""}
                        {m.hfRepoId ? ` · ${m.hfRepoId}` : ""}
                      </div>

                      {m.recommendedConfig?.notes && (
                        <p className="text-[11px] text-zinc-500">{m.recommendedConfig.notes}</p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        disabled={!isTargetOnline || fetchingSlug === m.slug || (!hasDirect && m.backupStatus !== "BACKED_UP")}
                        onClick={() => handleFastEnsure(m, "auto")}
                        className="bg-indigo-600 text-xs text-white hover:bg-indigo-500 disabled:opacity-40"
                      >
                        {fetchingSlug === m.slug ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Zap className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {isCached ? `Verify (${target})` : `Fast Fetch ➔ ${target}`}
                      </Button>

                      {m.backupStatus === "BACKED_UP" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isTargetOnline || fetchingSlug === m.slug}
                          onClick={() => handleFastEnsure(m, "gdrive")}
                          className="border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
                        >
                          <HardDriveDownload className="mr-1 h-3.5 w-3.5" />
                          From Drive
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Category Pills */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                  category === cat
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Loaded Models Inside Active VM (/tmp/models) */}
          <div className="glass-panel rounded-2xl p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-zinc-200">
                <HardDrive className="h-4 w-4 text-emerald-400" />
                <span>Loaded on {target.toUpperCase()} (`/tmp/models`)</span>
                {storageData?.disk && (
                  <span className="ml-2 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                    Free: {storageData.disk.freeGb} GB / {storageData.disk.totalGb} GB
                  </span>
                )}
              </div>
              {isTargetOnline && (
                <button
                  type="button"
                  onClick={() => refetchStorage()}
                  className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white"
                >
                  <RefreshCw className={`h-3 w-3 ${fetchingStorage ? "animate-spin" : ""}`} />
                  Scan /tmp
                </button>
              )}
            </div>

            {!isTargetOnline ? (
              <div className="text-xs text-zinc-500">
                {target.toUpperCase()} is currently offline. Select an ONLINE GPU above to view loaded models and free `/tmp` space.
              </div>
            ) : cachedFiles.length === 0 ? (
              <div className="text-xs text-zinc-500">
                {fetchingStorage ? "Scanning /tmp/models..." : "No models loaded in /tmp/models yet."}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {cachedFiles.map((item) => {
                  const key = `${item.category}/${item.name}`;
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800/90 bg-zinc-900/60 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono font-medium text-zinc-100">{item.name}</div>
                        <div className="text-[10px] text-zinc-500">
                          {item.category} · {formatBytes(item.sizeBytes)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteCached(item.category, item.name)}
                        disabled={deletingKey === key}
                        title="Delete from VM /tmp"
                        className="rounded-lg border border-zinc-800 p-1.5 text-zinc-400 hover:border-rose-500/40 hover:text-rose-400 disabled:opacity-40"
                      >
                        {deletingKey === key ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Drive File List */}
          <div className="glass-panel rounded-2xl p-5">
            <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3 text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-indigo-400" />
                <span className="font-mono">
                  gdrive:{data?.baseFolder || "Scriptoria"}/models/{category}
                </span>
              </div>
              {data?.source && (
                <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-500">
                  <Cloud className="h-3.5 w-3.5" /> {data.source}
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-xs text-zinc-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Google Drive folder...
              </div>
            ) : error ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-amber-300">
                {(error as Error).message}. Ensure your Google Drive OAuth JSON is configured in the{" "}
                <a href="/settings/vault" className="font-semibold underline">
                  Settings Vault
                </a>
                .
              </div>
            ) : (data?.files?.length ?? 0) === 0 ? (
              <div className="py-12 text-center text-xs text-zinc-500">
                No files found inside <code className="text-zinc-300">{data?.baseFolder}/models/{category}</code>.
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/80">
                {data?.files.map((file) => {
                  const isCached = cachedSet.has(`${category}/${file.name}`);
                  return (
                    <div
                      key={file.id}
                      className="flex flex-wrap items-center justify-between gap-4 py-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-zinc-100">{file.name}</span>
                          {isCached && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" /> Loaded on {target.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-zinc-500">
                          Size: {formatBytes(file.sizeBytes)}
                          {file.modifiedTime
                            ? ` · Modified ${new Date(file.modifiedTime).toLocaleDateString()}`
                            : ""}
                        </div>
                      </div>

                      <Button
                        size="sm"
                        disabled={!isTargetOnline}
                        onClick={() =>
                          handleStreamModel(file.name, {
                            expectedSizeBytes: file.sizeBytes,
                            force: isCached,
                          })
                        }
                        className="bg-indigo-600 text-xs text-white hover:bg-indigo-500 disabled:opacity-40"
                      >
                        <HardDriveDownload className="mr-1.5 h-3.5 w-3.5" />
                        {isCached ? `Re-stream to ${target}` : `Stream to /tmp (${target})`}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
