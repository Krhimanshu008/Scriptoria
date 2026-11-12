"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Images,
  Loader2,
  RefreshCw,
  Download,
  Wand2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Search,
  ExternalLink,
} from "lucide-react";
import { useClusterStore } from "@/store/cluster-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [activeOutputIdx, setActiveOutputIdx] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);
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

  const q = searchQuery.trim().toLowerCase();
  const items = (data?.items ?? []).filter((item) => {
    if (!item.outputs?.[0]?.previewUrl) return false;
    if (!q) return true;
    return (
      item.prompt.toLowerCase().includes(q) ||
      item.checkpoint.toLowerCase().includes(q) ||
      item.target.toLowerCase().includes(q)
    );
  });

  const selected =
    selectedIdx !== null && selectedIdx >= 0 && selectedIdx < items.length
      ? items[selectedIdx]
      : null;

  const openLightbox = (idx: number) => {
    setSelectedIdx(idx);
    setActiveOutputIdx(0);
  };

  const itemCount = items.length;

  const stepLightbox = (delta: number) => {
    if (selectedIdx === null || itemCount === 0) return;
    setSelectedIdx((selectedIdx + delta + itemCount) % itemCount);
    setActiveOutputIdx(0);
  };

  useEffect(() => {
    if (selectedIdx === null || itemCount === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setSelectedIdx((selectedIdx - 1 + itemCount) % itemCount);
        setActiveOutputIdx(0);
      } else if (e.key === "ArrowRight") {
        setSelectedIdx((selectedIdx + 1) % itemCount);
        setActiveOutputIdx(0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIdx, itemCount]);

  function handleRemix(item: HistoryJobItem) {
    remixFromHistory(item);
    toast.success("Loaded prompt & parameters into Studio");
    setSelectedIdx(null);
    router.push("/studio");
  }

  async function handleCopy(field: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1800);
  }

  const currentOutput =
    selected?.outputs[activeOutputIdx] || selected?.outputs[0] || null;

  return (
    <div className="space-y-4">
      {/* Header & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-white">Output Gallery</h1>
          <p className="text-xs text-zinc-500">
            Streamed directly from Google Drive Vault (`/api/outputs/[fileId]`).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter prompt, model, GPU..."
              className="h-8 w-52 rounded-md border border-zinc-800 bg-zinc-950 pl-8 pr-2.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
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
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-xs text-zinc-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading gallery...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-zinc-800 bg-[#111114] py-16 text-xs text-zinc-500">
          <Images className="mb-2 h-8 w-8 text-zinc-600" />
          <p>
            {q
              ? "No outputs match your search filter."
              : "No completed generations yet. Dispatch a prompt from Studio to populate outputs."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {items.map((item, idx) => {
            const first = item.outputs[0];
            if (!first?.previewUrl) return null;
            return (
              <div
                key={item.id}
                onClick={() => openLightbox(idx)}
                className="group cursor-pointer overflow-hidden rounded-lg border border-zinc-800 bg-[#111114] transition hover:border-zinc-600"
              >
                <div className="relative aspect-square overflow-hidden bg-zinc-950">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={first.previewUrl}
                    alt={item.prompt}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9.5px] text-zinc-300">
                    {item.width}×{item.height}
                  </span>
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

      {/* Wide Pro Split-Pane Lightbox Output Viewer */}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelectedIdx(null)}
      >
        <DialogContent className="max-h-[90vh] w-[94vw] max-w-5xl gap-0 overflow-hidden border border-zinc-800 bg-[#0d0d10] p-0 text-zinc-100 sm:max-w-5xl">
          <DialogTitle className="sr-only">
            Output Preview {selected?.checkpoint || ""}
          </DialogTitle>

          {selected && (
            <div className="flex max-h-[90vh] flex-col lg:flex-row">
              {/* Left Canvas Stage */}
              <div className="relative flex min-h-[340px] flex-1 flex-col items-center justify-center bg-[#070709] p-4 lg:min-h-[540px]">
                {currentOutput?.previewUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={currentOutput.previewUrl}
                    alt={selected.prompt}
                    className="max-h-[70vh] w-auto max-w-full rounded object-contain"
                  />
                )}

                {items.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => stepLightbox(-1)}
                      title="Previous (←)"
                      className="absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/90 text-zinc-200 transition hover:bg-zinc-800"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => stepLightbox(1)}
                      title="Next (→)"
                      className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/90 text-zinc-200 transition hover:bg-zinc-800"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                )}

                {/* Multi-image batch switcher if job produced >1 image */}
                {selected.outputs.length > 1 && (
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    {selected.outputs.map((out, i) => (
                      <button
                        key={out.gdriveFileId || out.filename}
                        type="button"
                        onClick={() => setActiveOutputIdx(i)}
                        className={`overflow-hidden rounded border ${
                          i === activeOutputIdx
                            ? "border-indigo-500 ring-1 ring-indigo-500"
                            : "border-zinc-800 opacity-65 hover:opacity-100"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={out.previewUrl}
                          alt={out.filename}
                          className="h-11 w-11 object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}

                {currentOutput?.previewUrl && (
                  <a
                    href={currentOutput.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/90 px-2 py-1 font-mono text-[10px] text-zinc-300 hover:bg-zinc-800"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open Original
                  </a>
                )}
              </div>

              {/* Right Fixed Inspector Sidebar */}
              <div className="flex w-full shrink-0 flex-col justify-between border-t border-zinc-800 bg-[#111114] p-4 lg:w-[340px] lg:border-l lg:border-t-0">
                <div className="space-y-3.5 overflow-y-auto pr-1">
                  {/* Top Metadata Header */}
                  <div className="space-y-1 pr-6">
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-zinc-200">
                        {selected.target}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-500">
                        {new Date(selected.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="truncate font-mono text-xs font-medium text-zinc-100" title={selected.checkpoint}>
                      {selected.checkpoint}
                    </div>
                  </div>

                  {/* Prompt Box */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
                      <span>Prompt</span>
                      <button
                        type="button"
                        onClick={() => handleCopy("prompt", selected.prompt)}
                        className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white"
                      >
                        {copiedField === "prompt" ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        Copy
                      </button>
                    </div>
                    <p className="max-h-36 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-2.5 text-xs leading-relaxed text-zinc-200">
                      {selected.prompt}
                    </p>
                  </div>

                  {/* Negative Prompt Box */}
                  {selected.negativePrompt && (
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium text-zinc-400">Negative Prompt</div>
                      <p className="max-h-24 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-2.5 text-[11px] leading-relaxed text-zinc-400">
                        {selected.negativePrompt}
                      </p>
                    </div>
                  )}

                  {/* Specs Table */}
                  <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-zinc-800 bg-zinc-800 font-mono text-[11px]">
                    <div className="bg-zinc-950 px-2.5 py-2">
                      <div className="text-[9.5px] uppercase text-zinc-500">Dimensions</div>
                      <div className="text-zinc-200">{selected.width} × {selected.height}</div>
                    </div>
                    <div className="bg-zinc-950 px-2.5 py-2">
                      <div className="text-[9.5px] uppercase text-zinc-500">Steps · CFG</div>
                      <div className="text-zinc-200">{selected.steps} · {selected.cfg}</div>
                    </div>
                    <div className="bg-zinc-950 px-2.5 py-2">
                      <div className="text-[9.5px] uppercase text-zinc-500">Seed</div>
                      <button
                        type="button"
                        onClick={() => selected.seed && handleCopy("seed", selected.seed)}
                        className="flex items-center gap-1 text-zinc-200 hover:text-white"
                      >
                        <span className="truncate">{selected.seed || "Random"}</span>
                        {copiedField === "seed" && <Check className="h-2.5 w-2.5 text-emerald-400" />}
                      </button>
                    </div>
                    <div className="bg-zinc-950 px-2.5 py-2">
                      <div className="text-[9.5px] uppercase text-zinc-500">Render Time</div>
                      <div className="text-zinc-200">
                        {selected.executionTimeMs
                          ? `${(selected.executionTimeMs / 1000).toFixed(1)}s`
                          : "--"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sticky Footer Actions */}
                <div className="mt-4 flex flex-col gap-2 border-t border-zinc-800 pt-3">
                  <button
                    type="button"
                    onClick={() => handleRemix(selected)}
                    className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Reuse in Studio
                  </button>
                  {currentOutput?.previewUrl && (
                    <a
                      href={currentOutput.previewUrl}
                      download={currentOutput.filename}
                      className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-500"
                    >
                      <Download className="h-3.5 w-3.5" /> Download Full Image
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
