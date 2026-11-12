"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Server,
  HardDriveDownload,
  Sparkles,
  Images,
  KeyRound,
  PowerOff,
  LogOut,
  Loader2,
  Cpu,
  X,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth/session";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { useClusterStore } from "@/store/cluster-store";
import { formatStreamSummary } from "@/lib/format";
import { toast } from "sonner";

const NAV_ITEMS = [
  { href: "/", label: "Cluster", icon: Cpu },
  { href: "/models", label: "Models", icon: HardDriveDownload },
  { href: "/studio", label: "Studio", icon: Sparkles },
  { href: "/history", label: "History", icon: Images },
  { href: "/settings/vault", label: "Vault", icon: KeyRound },
];

export function DashboardShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [stoppingAll, setStoppingAll] = useState(false);

  const activeStream = useClusterStore((s) => s.activeStream);
  const setActiveStream = useClusterStore((s) => s.setActiveStream);
  const syncTargetWithVms = useClusterStore((s) => s.syncTargetWithVms);
  const pollingJobId = useClusterStore((s) => s.studio.pollingJobId);
  const pollingTarget = useClusterStore((s) => s.studio.pollingTarget);
  const updateStudio = useClusterStore((s) => s.updateStudio);

  const { data } = useQuery<{ vms: PublicVmInstance[] }>({
    queryKey: ["vm-status"],
    queryFn: async () => {
      const res = await fetch("/api/vm/status");
      if (res.status === 401) {
        router.replace("/login");
        throw new Error("Unauthorized");
      }
      if (!res.ok) throw new Error("Failed to fetch VM status");
      return res.json();
    },
    refetchInterval: 5000,
    staleTime: 4000,
  });

  const vms = data?.vms ?? [];
  const onlineVms = vms.filter((v) => v.status === "ONLINE" || v.status === "BUSY");
  const totalVram = onlineVms.reduce((acc, v) => acc + (v.vramTotalGb || 16), 0);

  // Sync preferred online GPU automatically across all pages
  useEffect(() => {
    if (data?.vms?.length) {
      syncTargetWithVms(data.vms);
    }
  }, [data?.vms, syncTargetWithVms]);

  // Background Rclone stream progress poller (persists across route switches)
  useEffect(() => {
    if (!activeStream?.active || activeStream.completed) return;

    const target = activeStream.target;
    const modelName = activeStream.modelName;
    const category = activeStream.category;
    const jobId = activeStream.jobId;

    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const qs = new URLSearchParams();
        if (jobId) qs.set("jobId", String(jobId));
        if (modelName) qs.set("file", modelName);

        const res = await fetch(
          `/api/models/stream-status/${encodeURIComponent(target)}?${qs.toString()}`
        );
        if (!res.ok || cancelled) return;

        const stats = await res.json();
        if (stats.status === "transferring" || stats.active) {
          const speedMbps = Number(stats.speedMbps || 0);
          const bytesDone = Number(stats.bytesDone || 0);
          const totalBytes = Number(stats.totalBytes || 0);
          const etaSeconds = stats.etaSeconds != null ? Number(stats.etaSeconds) : null;
          const percentage = Number(stats.percentage || 0);

          setActiveStream({
            target,
            jobId,
            modelName,
            category,
            percentage,
            speedMbps,
            bytesDone,
            totalBytes,
            etaSeconds,
            speedText: formatStreamSummary({ speedMbps, bytesDone, totalBytes, etaSeconds }),
            active: true,
            completed: false,
            error: null,
          });
        } else if (stats.completed) {
          setActiveStream({
            target,
            jobId,
            modelName,
            category,
            percentage: 100,
            speedMbps: 0,
            bytesDone: stats.totalBytes || stats.bytes || 0,
            totalBytes: stats.totalBytes || stats.bytes || 0,
            etaSeconds: 0,
            speedText: "Ready on /tmp",
            active: true,
            completed: true,
            error: null,
          });
          toast.success(`${modelName} loaded into /tmp/models/${category} on ${target.toUpperCase()}`);
          queryClient.invalidateQueries({ queryKey: ["vm-catalog", target] });
          queryClient.invalidateQueries({ queryKey: ["vm-storage", target] });
          setTimeout(() => {
            const cur = useClusterStore.getState().activeStream;
            if (cur?.completed && cur.modelName === modelName) {
              useClusterStore.getState().setActiveStream(null);
            }
          }, 4000);
        } else if (stats.failed) {
          toast.error(stats.error || `Failed streaming ${modelName}`);
          setActiveStream(null);
        }
      } catch {
        // Ignore transient network hiccups during polling
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    activeStream?.active,
    activeStream?.completed,
    activeStream?.target,
    activeStream?.modelName,
    activeStream?.category,
    activeStream?.jobId,
    queryClient,
    setActiveStream,
  ]);

  // Background Studio generation job poller (persists across route switches)
  useEffect(() => {
    if (!pollingJobId) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/workflow/${encodeURIComponent(pollingJobId)}/status`);
        if (!res.ok || cancelled) return;
        const sData = await res.json();

        if (sData.status === "COMPLETED") {
          updateStudio({
            outputs: sData.outputs || [],
            durationMs: sData.executionTimeMs || null,
            pollingJobId: null,
            pollingTarget: null,
            submitting: false,
            queueElapsedMs: null,
            queuePending: 0,
          });
          toast.success("Generation completed & saved permanently to Google Drive!");
          queryClient.invalidateQueries({ queryKey: ["outputs-history"] });
        } else if (sData.status === "FAILED") {
          updateStudio({
            pollingJobId: null,
            pollingTarget: null,
            submitting: false,
            queueElapsedMs: null,
            queuePending: 0,
          });
          toast.error(sData.errorMessage || "Workflow failed on GPU");
        } else {
          updateStudio({
            queueElapsedMs: sData.elapsedMs ?? null,
            queuePending: sData.queuePending ?? 0,
          });
        }
      } catch {
        // keep polling
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollingJobId, pollingTarget, queryClient, updateStudio]);

  async function handleEmergencyStopAll() {
    if (!confirm("Immediately terminate ALL active Kaggle/Colab GPU sessions?")) return;
    setStoppingAll(true);
    try {
      const seenGroups = new Set<string>();
      for (const vm of vms) {
        if (vm.status !== "OFFLINE" && !seenGroups.has(vm.sessionGroup)) {
          seenGroups.add(vm.sessionGroup);
          await fetch(`/api/vm/${vm.target}/toggle`, { method: "POST" });
        }
      }
      toast.success("Stop signal dispatched to all active sessions.");
      await queryClient.invalidateQueries({ queryKey: ["vm-status"] });
    } catch {
      toast.error("Failed to stop all VMs");
    } finally {
      setStoppingAll(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          {/* Brand + Nav */}
          <div className="flex items-center gap-6">
            <Link href="/" prefetch={true} className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-lg shadow-indigo-500/20">
                <Server className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-bold tracking-tight text-white">Scriptoria</div>
                <div className="text-[10px] text-zinc-400">Next.js GPU Control Plane</div>
              </div>
            </Link>

            <nav className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/70 p-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "bg-indigo-600 text-white shadow"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Cluster Counters + Actions */}
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs sm:flex">
              <span className="text-zinc-400">
                Online GPUs:{" "}
                <strong className="text-emerald-400">
                  {onlineVms.length} / {vms.length || 6}
                </strong>
              </span>
              <span className="h-3 w-px bg-zinc-700" />
              <span className="text-zinc-400">
                VRAM: <strong className="text-indigo-400">{totalVram.toFixed(0)} GB</strong>
              </span>
            </div>

            <button
              onClick={handleEmergencyStopAll}
              disabled={stoppingAll || onlineVms.length === 0}
              className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold text-rose-400 transition hover:bg-rose-900/40 disabled:opacity-40"
            >
              {stoppingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PowerOff className="h-3.5 w-3.5" />
              )}
              <span>Stop All</span>
            </button>

            <div className="hidden items-center gap-2 text-xs text-zinc-400 md:flex">
              <span className="max-w-[140px] truncate">{user.email}</span>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Global Rclone Stream Progress Banner */}
        {activeStream?.active && (
          <div
            className={`border-t px-6 py-2 ${
              activeStream.completed
                ? "border-emerald-500/30 bg-emerald-950/30"
                : "border-indigo-500/30 bg-indigo-950/30"
            }`}
          >
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs">
              <div
                className={`flex items-center gap-2 font-mono ${
                  activeStream.completed ? "text-emerald-300" : "text-indigo-300"
                }`}
              >
                <HardDriveDownload className="h-4 w-4 animate-pulse" />
                <span>
                  {activeStream.completed ? "Loaded" : "Streaming"} {activeStream.modelName} ➔{" "}
                  {activeStream.target.toUpperCase()} (/tmp/models/{activeStream.category})
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-40 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`h-full transition-all duration-300 ${
                      activeStream.completed ? "bg-emerald-500" : "bg-indigo-500"
                    }`}
                    style={{ width: `${activeStream.percentage}%` }}
                  />
                </div>
                <span className="font-mono text-zinc-200">
                  {activeStream.percentage}% · {activeStream.speedText}
                </span>
                <button
                  onClick={() => setActiveStream(null)}
                  title="Dismiss banner"
                  className="text-zinc-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 p-6">{children}</main>
    </div>
  );
}
