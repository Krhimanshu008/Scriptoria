"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Images, Loader2, RefreshCw, Download, Wand2 } from "lucide-react";
import { useClusterStore } from "@/store/cluster-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface HistoryJobItem {
  id: string;
  target: string;
  prompt: string;
  negativePrompt: string | null;
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: string | null;
  executionTimeMs: number | null;
  createdAt: string;
  outputs: Array<{
    filename: string;
    gdriveFileId: string;
    gdrivePath: string;
    previewUrl: string;
  }>;
}

export default function HistoryPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<HistoryJobItem | null>(null);
  const remixFromHistory = useClusterStore((s) => s.remixFromHistory);

  const { data, isLoading, refetch, isFetching } = useQuery<{ items: HistoryJobItem[] }>({
    queryKey: ["outputs-history"],
    queryFn: async () => {
      const res = await fetch("/api/outputs?limit=50");
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const items = data?.items ?? [];

  function handleRemix(item: HistoryJobItem) {
    remixFromHistory(item);
    toast.success("Loaded prompt & parameters into Studio");
    setSelected(null);
    router.push("/studio");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Output Gallery</h1>
          <p className="text-xs text-zinc-500">
            Streamed directly from Google Drive Vault (`/api/outputs/[fileId]`).
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-xs text-zinc-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading gallery...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-zinc-800 bg-[#111114] py-16 text-xs text-zinc-500">
          <Images className="mb-2 h-8 w-8 text-zinc-600" />
          <p>No completed generations yet. Dispatch a prompt from Studio to populate outputs.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            const first = item.outputs[0];
            if (!first?.previewUrl) return null;
            return (
              <div
                key={item.id}
                onClick={() => setSelected(item)}
                className="group cursor-pointer overflow-hidden rounded-lg border border-zinc-800 bg-[#111114] transition hover:border-zinc-600"
              >
                <div className="aspect-square overflow-hidden bg-zinc-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={first.previewUrl}
                    alt={item.prompt}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="space-y-1 p-2.5">
                  <p className="line-clamp-2 text-xs text-zinc-200">{item.prompt}</p>
                  <div className="flex items-center justify-between font-mono text-[10px] text-zinc-500">
                    <span>{item.target.toUpperCase()}</span>
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="glass-popover max-w-3xl border-white/15 text-zinc-100">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono text-sm">
                  {selected.target.toUpperCase()} · {selected.checkpoint}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                  {selected.outputs[0]?.previewUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={selected.outputs[0].previewUrl}
                      alt={selected.prompt}
                      className="h-full w-full object-contain"
                    />
                  )}
                </div>
                <div className="space-y-3 text-xs">
                  <div>
                    <div className="font-semibold text-zinc-400">Prompt</div>
                    <p className="mt-1 rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-zinc-200">
                      {selected.prompt}
                    </p>
                  </div>
                  {selected.negativePrompt && (
                    <div>
                      <div className="font-semibold text-zinc-400">Negative Prompt</div>
                      <p className="mt-1 rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-zinc-400">
                        {selected.negativePrompt}
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-zinc-300">
                    <div>Size: {selected.width}×{selected.height}</div>
                    <div>Steps: {selected.steps} · CFG: {selected.cfg}</div>
                    <div>Seed: {selected.seed || "Random"}</div>
                    <div>
                      Time:{" "}
                      {selected.executionTimeMs
                        ? `${(selected.executionTimeMs / 1000).toFixed(1)}s`
                        : "--"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleRemix(selected)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      <Wand2 className="h-3.5 w-3.5" /> Reuse in Studio
                    </button>
                    {selected.outputs[0]?.previewUrl && (
                      <a
                        href={selected.outputs[0].previewUrl}
                        download={selected.outputs[0].filename}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
                      >
                        <Download className="h-3.5 w-3.5" /> Download Full Image
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
