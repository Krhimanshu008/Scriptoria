"use client";

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Download, ExternalLink } from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { GpuCard } from "@/components/gpu/GpuCard";
import { LiveConsole } from "@/components/logs/LiveConsole";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function ClusterPage() {
  const queryClient = useQueryClient();
  const [probing, setProbing] = useState(false);
  const [colabDialog, setColabDialog] = useState<{ url: string; target: string } | null>(null);

  const { data, isLoading } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (!res.ok) throw new Error("Failed to fetch VM status");
      return res.json();
    },
    refetchInterval: 5000,
  });

  async function handleForceProbe() {
    setProbing(true);
    try {
      const res = await fetch("/api/vm/status?probe=true");
      if (res.ok) {
        const fresh = await res.json();
        queryClient.setQueryData(["vm-status"], fresh);
      }
    } finally {
      setProbing(false);
    }
  }

  const vms = data?.vms ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">GPU Cluster Overview</h1>
          <p className="text-xs text-zinc-400">
            6 cloud GPU slots across Kaggle Dual-T4 (1x quota per pair) and Google Colab via Caddy route-less tunnels.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleForceProbe}
          disabled={probing}
          className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${probing ? "animate-spin" : ""}`} />
          Probe Live Health
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-80 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/50"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {vms.map((vm) => (
            <GpuCard
              key={vm.id}
              vm={vm}
              onRefresh={() => queryClient.invalidateQueries({ queryKey: ["vm-status"] })}
              onColabReady={(url, target) => setColabDialog({ url, target })}
            />
          ))}
        </div>
      )}

      <LiveConsole />

      <Dialog open={Boolean(colabDialog)} onOpenChange={(open) => !open && setColabDialog(null)}>
        <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Launch Google Colab Worker ({colabDialog?.target})</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Download the pre-authenticated `.ipynb` runner (contains your encrypted Rclone &amp; Caddy registration JWT), upload it to Google Colab, select T4 GPU, and run the cell.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            {colabDialog && (
              <a
                href={colabDialog.url}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                <Download className="h-4 w-4" />
                Download {colabDialog.target}.ipynb
              </a>
            )}
            <a
              href="https://colab.research.google.com/"
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
            >
              <ExternalLink className="h-4 w-4" />
              Open Google Colab
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

