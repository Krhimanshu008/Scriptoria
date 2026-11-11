"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HardDriveDownload, RefreshCw, Loader2, FolderOpen, Cloud } from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { useClusterStore } from "@/store/cluster-store";
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

function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export default function ModelsPage() {
  const [category, setCategory] = useState("checkpoints");
  const [target, setTarget] = useState("gpu0");
  const setActiveStream = useClusterStore((s) => s.setActiveStream);
  const activeStream = useClusterStore((s) => s.activeStream);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: vmData } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const vms = vmData?.vms ?? [];

  const { data, isLoading, error, refetch, isFetching } = useQuery<{
    baseFolder: string;
    category: string;
    files: GDriveModelFile[];
    source: string;
  }>({
    queryKey: ["gdrive-models", category, target],
    queryFn: async () => {
      const res = await fetch(
        `/api/models/list?category=${encodeURIComponent(category)}&target=${encodeURIComponent(target)}`
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to list Google Drive models");
      return body;
    },
    retry: false,
  });

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleStreamModel(fileName: string) {
    try {
      const res = await fetch("/api/models/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, category, name: fileName }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to start model stream");
        return;
      }

      toast.success(`Streaming ${fileName} to ${target} (/tmp/models/${category})`);
      setActiveStream({
        target,
        modelName: fileName,
        category,
        percentage: 5,
        speedText: "Starting Rclone...",
        active: true,
      });

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const sRes = await fetch(`/api/models/stream-status/${encodeURIComponent(target)}`);
          const stats = await sRes.json();
          const transferring = stats.transferring || [];
          if (transferring.length > 0) {
            const item = transferring[0];
            const pct = item.percentage || 0;
            const spd = item.speedAvg
              ? `${(item.speedAvg / 1024 ** 2).toFixed(1)} MB/s`
              : "Transferring";
            const eta = item.eta != null ? `ETA ${item.eta}s` : "";
            setActiveStream({
              target,
              modelName: fileName,
              category,
              percentage: pct,
              speedText: eta ? `${spd} · ${eta}` : spd,
              active: true,
            });
          } else if ((stats.bytes ?? 0) > 0) {
            setActiveStream({
              target,
              modelName: fileName,
              category,
              percentage: 100,
              speedText: "Complete",
              active: true,
            });
            toast.success(`${fileName} ready in /tmp/models/${category} on ${target}`);
            if (pollRef.current) clearInterval(pollRef.current);
            setTimeout(() => setActiveStream(null), 3500);
          }
        } catch {
          // ignore transient polling errors
        }
      }, 1500);
    } catch {
      toast.error("Network error initiating stream");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Google Drive Model Manager</h1>
          <p className="text-xs text-zinc-400">
            Stream checkpoints &amp; LoRAs directly from Google Drive into VM `/tmp/models` at 100–300 MB/s via Rclone (:5572).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
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
            onClick={() => refetch()}
            disabled={isFetching}
            className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
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
        <div className="rounded-2xl border border-indigo-500/40 bg-indigo-950/20 p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-mono font-semibold text-indigo-300">
              Streaming {activeStream.modelName} ➔ {activeStream.target}
            </span>
            <span className="font-mono text-zinc-200">
              {activeStream.percentage}% ({activeStream.speedText})
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${activeStream.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Drive File List */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-3 text-xs text-zinc-400">
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
            <a href="/settings/vault" className="underline font-semibold">
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
            {data?.files.map((file) => (
              <div
                key={file.id}
                className="flex flex-wrap items-center justify-between gap-4 py-3"
              >
                <div>
                  <div className="font-mono text-xs font-semibold text-zinc-100">{file.name}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    Size: {formatBytes(file.sizeBytes)}
                    {file.modifiedTime
                      ? ` · Modified ${new Date(file.modifiedTime).toLocaleDateString()}`
                      : ""}
                  </div>
                </div>

                <Button
                  size="sm"
                  onClick={() => handleStreamModel(file.name)}
                  className="bg-indigo-600 text-xs text-white hover:bg-indigo-500"
                >
                  <HardDriveDownload className="mr-1.5 h-3.5 w-3.5" />
                  Stream to /tmp ({target})
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

