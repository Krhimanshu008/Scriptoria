"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Images, Loader2, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [selected, setSelected] = useState<HistoryJobItem | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<{ items: HistoryJobItem[] }>({
    queryKey: ["outputs-history"],
    queryFn: async () => {
      const res = await fetch("/api/outputs?limit=50");
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Permanent Output Gallery</h1>
          <p className="text-xs text-zinc-400">
            Streamed directly from your Google Drive Vault (`/api/outputs/[fileId]`) — available 24/7 even while all GPUs are offline.
          </p>
        </div>

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

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-xs text-zinc-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading permanent gallery...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 py-20 text-xs text-zinc-500">
          <Images className="mb-3 h-10 w-10 text-zinc-700" />
          <p>No completed generations yet. Dispatch a prompt from Studio to populate your gallery.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            const first = item.outputs[0];
            if (!first?.previewUrl) return null;
            return (
              <div
                key={item.id}
                onClick={() => setSelected(item)}
                className="group cursor-pointer overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 transition hover:border-indigo-500/50"
              >
                <div className="aspect-square overflow-hidden bg-zinc-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={first.previewUrl}
                    alt={item.prompt}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="space-y-1 p-3">
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
        <DialogContent className="max-w-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
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
                  {selected.outputs[0]?.previewUrl && (
                    <a
                      href={selected.outputs[0].previewUrl}
                      download={selected.outputs[0].filename}
                      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
                    >
                      <Download className="h-3.5 w-3.5" /> Download Full Image
                    </a>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

