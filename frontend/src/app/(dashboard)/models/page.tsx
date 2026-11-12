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
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { VmStoredModelItem } from "@/lib/orchestrator/rclone-client";
import { useClusterStore } from "@/store/cluster-store";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const CATEGORIES = [
  "checkpoints",
  "loras",
  "vae",
  "controlnet",
  "ipadapter",
  "upscale_models",
];

interface GDriveModelFile {
  id: string;
  name: string;
  category: string;
  sizeBytes: number;
  modifiedTime?: string;
}

export default function ModelsPage() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("checkpoints");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

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

  const { data, isLoading, error, refetch, isFetching } = useQuery<{
    baseFolder: string;
    category: string;
    files: GDriveModelFile[];
    source: string;
  }>({
    queryKey: ["gdrive-models", category],
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
          <h1 className="text-xl font-bold tracking-tight text-white">Google Drive Model Manager</h1>
          <p className="text-xs text-zinc-400">
            Stream checkpoints &amp; LoRAs directly from Google Drive into VM `/tmp/models` via Rclone (:5572) and monitor loaded `/tmp` storage.
          </p>
        </div>

        <div className="flex items-center gap-3">
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
            onClick={() => {
              refetch();
              if (isTargetOnline) refetchStorage();
            }}
            disabled={isFetching || fetchingStorage}
            className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
          >
            <RefreshCw
              className={`mr-2 h-3.5 w-3.5 ${isFetching || fetchingStorage ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

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
              {activeStream.completed ? "Loaded" : "Streaming"} {activeStream.modelName} ➔{" "}
              {activeStream.target.toUpperCase()}
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
  );
}
