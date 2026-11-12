"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Zap,
  RefreshCw,
  Cpu,
  Bot,
  Settings,
  Sparkles,
  Layers,
  ShieldCheck,
  Flame,
  Info,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { TpuAccountSummary } from "@/app/api/vm/accounts/route";
import type { PublicWorkspaceSettings } from "@/lib/settings/workspace-settings";
import { TpuClusterCard } from "@/components/tpu/TpuClusterCard";
import { toast } from "sonner";

function formatQuotaHours(sec: number): string {
  const mins = Math.max(0, Math.floor(sec / 60));
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${String(mins % 60).padStart(2, "0")}m`;
}

export default function TpuClusterPage() {
  const queryClient = useQueryClient();
  const [probing, setProbing] = useState(false);

  const { data: vmData, isLoading: vmsLoading } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (!res.ok) throw new Error("Failed to fetch VM status");
      return res.json();
    },
    refetchInterval: (query) => {
      const list = query.state.data?.vms ?? [];
      const anyStarting = list.some((v) => v.target.startsWith("tpu") && v.status === "STARTING");
      return anyStarting ? 2500 : 5000;
    },
    staleTime: 2500,
  });

  const { data: accountsData, refetch: refetchAccounts } = useQuery<{
    tpuAccounts: TpuAccountSummary[];
  }>({
    queryKey: ["vm-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/vm/accounts");
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: settingsData } = useQuery<{ settings: PublicWorkspaceSettings }>({
    queryKey: ["workspace-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
    staleTime: 30000,
  });

  const globalIdleTimeout = settingsData?.settings?.idleTimeoutMinutes ?? 15;

  const tpuVms = (vmData?.vms ?? []).filter((v) => v.target.startsWith("tpu"));
  const onlineTpuVms = tpuVms.filter((v) => v.status === "ONLINE" || v.status === "BUSY");
  const totalHbmGb = tpuVms.length * 128;
  const activeHbmGb = onlineTpuVms.length * 128;
  const usedHbmGb = onlineTpuVms.reduce((acc, v) => acc + (v.vramUsedGb || 0), 0);

  const tpuAccounts = accountsData?.tpuAccounts ?? [
    { accountAlias: "acc1", username: "Account 1", configured: false, target: "tpu0", quota: null },
    { accountAlias: "acc2", username: "Account 2", configured: false, target: "tpu1", quota: null },
    { accountAlias: "acc3", username: "Account 3", configured: false, target: "tpu2", quota: null },
    { accountAlias: "acc4", username: "Account 4", configured: false, target: "tpu3", quota: null },
  ];

  const combinedTpuQuotaSec = tpuAccounts.reduce(
    (acc, a) => acc + (a.quota?.tpuRemainingSeconds ?? 0),
    0
  );
  const hasAnyQuota = tpuAccounts.some((a) => a.quota?.tpuRemainingSeconds !== undefined);

  async function handleForceProbe() {
    setProbing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["vm-status"] }),
        refetchAccounts(),
      ]);
      toast.success("Refreshed TPU cluster telemetry & quota.");
    } catch {
      toast.error("Failed to probe TPU status.");
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-white">TPU Compute Cluster</h1>
            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400 border border-amber-500/30">
              Google Cloud v5e-8
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            Dedicated 8-chip TPU pods (128 GB HBM) for unquantized Qwen 27B inference. Runs independently of GPU quotas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleForceProbe}
            disabled={probing}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${probing ? "animate-spin" : ""}`} />
            <span>Probe</span>
          </button>

          <Link
            href="/settings"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>Settings</span>
          </Link>

          <Link
            href="/llm-studio"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-gradient-to-r from-amber-600 to-amber-500 px-3 text-xs font-semibold text-white shadow hover:from-amber-500 hover:to-amber-400 transition"
          >
            <Bot className="h-3.5 w-3.5" />
            <span>Open LLM Studio</span>
          </Link>
        </div>
      </div>

      {/* Segmented Telemetry Strip */}
      <div className="grid grid-cols-2 divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800 bg-[#111114] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-[11px] font-medium text-zinc-500">Active TPU Pods</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-amber-400">
            {onlineTpuVms.length}{" "}
            <span className="text-xs font-normal text-zinc-500">/ {tpuAccounts.length || 4} slots</span>
          </span>
        </div>

        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-[11px] font-medium text-zinc-500">Total HBM Pool</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-zinc-100">
            {activeHbmGb > 0 ? `${activeHbmGb}G` : `${totalHbmGb || 512}G`}{" "}
            <span className="text-xs font-normal text-zinc-500">
              ({usedHbmGb.toFixed(1)}G used)
            </span>
          </span>
        </div>

        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-[11px] font-medium text-zinc-500">Weekly TPU Quota</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-zinc-100">
            {hasAnyQuota ? formatQuotaHours(combinedTpuQuotaSec) : "80h 00m (4x20h)"}
          </span>
        </div>

        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-[11px] font-medium text-zinc-500">Serving Engine</span>
          <span className="font-mono text-xs font-semibold text-emerald-400">
            vLLM &bull; ~130 tok/s MTP
          </span>
        </div>
      </div>

      {/* TPU Cluster Cards Grid */}
      {vmsLoading && tpuVms.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-64 animate-pulse rounded-xl border border-zinc-800 bg-[#111114]"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {tpuAccounts.map((acc) => {
            const vm = tpuVms.find(
              (v) => v.accountAlias === acc.accountAlias || v.target === acc.target
            );
            return (
              <TpuClusterCard
                key={`tpu-${acc.accountAlias}`}
                account={acc}
                vm={vm}
                globalIdleTimeoutMinutes={globalIdleTimeout}
                onRefresh={() => {
                  queryClient.invalidateQueries({ queryKey: ["vm-status"] });
                  refetchAccounts();
                }}
              />
            );
          })}
        </div>
      )}

      {/* Architecture Highlights & Information Banner */}
      <div className="rounded-xl border border-zinc-800/80 bg-[#111114]/80 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Info className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-zinc-200">
              Why run a dedicated TPU v5e-8 Cluster alongside GPU?
            </h3>
            <div className="grid grid-cols-1 gap-3 pt-2 text-xs text-zinc-400 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
                <span className="font-semibold text-zinc-200 block mb-1">
                  1. Independent 20h/wk Quota
                </span>
                Kaggle tracks GPU and TPU quotas in strictly separate pools. You can run 1 Dual-T4 GPU worker and 1 TPU v5e-8 worker at the exact same time on the same Kaggle account without sharing hours.
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
                <span className="font-semibold text-zinc-200 block mb-1">
                  2. 128 GB Unified HBM Memory
                </span>
                Dual-T4 GPUs have 30 GB total VRAM (15 GB + 15 GB) split over PCIe. TPU v5e-8 provides 128 GB of ultra-fast HBM, running unquantized Qwen 27B BF16 natively with 262K context.
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
                <span className="font-semibold text-zinc-200 block mb-1">
                  3. ~130 tok/s Speculative MTP
                </span>
                vLLM uses Multi-Token Prediction (MTP) drafter heads on TPU to stream ~130 tokens/second, making long reasoning chains and agent coding tasks 4-5x faster than quantized GPU setups.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

