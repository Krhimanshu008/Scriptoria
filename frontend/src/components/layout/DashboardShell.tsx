"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Server,
  HardDriveDownload,
  Images,
  KeyRound,
  PowerOff,
  LogOut,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth/session";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { useClusterStore } from "@/store/cluster-store";
import { formatStreamSummary } from "@/lib/format";
import { toast } from "sonner";

const NAV_ITEMS = [
  { href: "/", label: "Command Center", icon: Sparkles },
  { href: "/models", label: "Models", icon: HardDriveDownload },
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
    refetchInterval: (query) => {
      const list = query.state.data?.vms ?? [];
      return list.some((v) => v.status === "STARTING") ? 2500 : 5000;
    },
    staleTime: 2500,
  });

  const vms = data?.vms ?? [];
  const onlineVms = vms.filter((v) => v.status === "ONLINE" || v.status === "BUSY");
  const totalVram = onlineVms.reduce((acc, v) => acc + (v.vramTotalGb || 16), 0);

  useEffect(() => {
    if (data?.vms?.length) {
      syncTargetWithVms(data.vms);
    }
  }, [data?.vms, syncTargetWithVms]);

  useEffect(() => {
    if (!activeStream?.active || activeStream.completed) return;

    const target = activeStream.target;
    const modelName = activeStream.modelName;
    const category = activeStream.category;
    const jobId = activeStream.jobId;
    const fetchJobId = activeStream.fetchJobId;

    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        let res: Response;
        if (fetchJobId) {
          res = await fetch(
            `/api/catalog/ensure-status/${encodeURIComponent(target)}?fetchJobId=${encodeURIComponent(fetchJobId)}`
          );
        } else {
          const qs = new URLSearchParams();
          if (jobId) qs.set("jobId", String(jobId));
          if (modelName) qs.set("file", modelName);

          res = await fetch(
            `/api/models/stream-status/${encodeURIComponent(target)}?${qs.toString()}`
          );
        }
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
            fetchJobId,
            transport: fetchJobId ? "sidecar-fetch" : "rclone-gdrive",
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
            fetchJobId,
            transport: fetchJobId ? "sidecar-fetch" : "rclone-gdrive",
            modelName,
            category,
            percentage: 100,
            speedMbps: 0,
            bytesDone: stats.totalBytes || stats.bytes || 0,
            totalBytes: stats.totalBytes || stats.bytes || 0,
            etaSeconds: 0,
            speedText: fetchJobId ? "Cached on /tmp (Drive backup queued)" : "Ready on /tmp",
            active: true,
            completed: true,
            error: null,
          });
          toast.success(`${modelName} loaded into /tmp/models/${category} on ${target.toUpperCase()}`);
          queryClient.invalidateQueries({ queryKey: ["vm-catalog", target] });
          queryClient.invalidateQueries({ queryKey: ["vm-storage", target] });
          queryClient.invalidateQueries({ queryKey: ["master-catalog"] });
          setTimeout(() => {
            const cur = useClusterStore.getState().activeStream;
            if (cur?.completed && cur.modelName === modelName) {
              useClusterStore.getState().setActiveStream(null);
            }
          }, 4000);
        } else if (stats.failed) {
          toast.error(stats.error || `Failed fetching ${modelName}`);
          setActiveStream(null);
        }
      } catch {
        // Ignore transient polling errors
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
    activeStream?.fetchJobId,
    queryClient,
    setActiveStream,
  ]);

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
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#05070e] text-zinc-100">
      {/* Ambient Glassmorphism Depth Orbs */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-indigo-600/20 blur-[130px]" />
        <div className="absolute right-[-6rem] top-16 h-[28rem] w-[28rem] rounded-full bg-cyan-500/15 blur-[140px]" />
        <div className="absolute bottom-[-8rem] left-1/3 h-96 w-96 rounded-full bg-violet-600/15 blur-[140px]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070b16]/65 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-2.5">
          {/* Brand + Nav */}
          <div className="flex items-center gap-5">
            <Link href="/" prefetch={true} className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-400 text-white shadow-lg shadow-indigo-500/25">
                <Server className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-bold tracking-tight text-white">Scriptoria</div>
                <div className="text-[10px] text-zinc-400">Glass GPU Studio</div>
              </div>
            </Link>

            <nav className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1 backdrop-blur-md">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === "/"
                    ? pathname === "/" || pathname.startsWith("/studio")
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition whitespace-nowrap ${
                      active
                        ? "bg-gradient-to-r from-indigo-600/90 to-indigo-500/80 text-white shadow-md shadow-indigo-500/20"
                        : "text-zinc-400 hover:bg-white/[0.06] hover:text-white"
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
          <div className="flex items-center gap-2.5">
            <div className="glass-pill hidden items-center gap-3 rounded-xl px-3 py-1.5 text-xs sm:flex">
              <span className="text-zinc-400 whitespace-nowrap">
                Online:{" "}
                <strong className="text-emerald-400">
                  {onlineVms.length} / {vms.length || 6}
                </strong>
              </span>
              <span className="h-3 w-px bg-white/15" />
              <span className="text-zinc-400 whitespace-nowrap">
                VRAM: <strong className="text-cyan-300">{totalVram.toFixed(0)} GB</strong>
              </span>
            </div>

            <button
              onClick={handleEmergencyStopAll}
              disabled={stoppingAll || onlineVms.length === 0}
              className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-300 backdrop-blur-md transition hover:bg-rose-500/25 disabled:opacity-40 whitespace-nowrap"
            >
              {stoppingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PowerOff className="h-3.5 w-3.5" />
              )}
              <span>Stop All</span>
            </button>

            <div className="hidden items-center gap-2 text-xs text-zinc-400 md:flex">
              <span className="max-w-[130px] truncate">{user.email}</span>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="rounded-lg border border-white/10 bg-white/[0.04] p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Global Rclone Stream Progress Banner */}
        {activeStream?.active && (
          <div
            className={`border-t px-5 py-2 backdrop-blur-xl ${
              activeStream.completed
                ? "border-emerald-400/30 bg-emerald-500/10"
                : "border-indigo-400/30 bg-indigo-500/10"
            }`}
          >
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs">
              <div
                className={`flex items-center gap-2 font-mono ${
                  activeStream.completed ? "text-emerald-300" : "text-indigo-200"
                }`}
              >
                <HardDriveDownload className="h-4 w-4 animate-pulse" />
                <span>
                  {activeStream.completed ? "Loaded" : "Streaming"} {activeStream.modelName} ➔{" "}
                  {activeStream.target.toUpperCase()} (/tmp/models/{activeStream.category})
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-40 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full transition-all duration-300 ${
                      activeStream.completed ? "bg-emerald-400" : "bg-indigo-400"
                    }`}
                    style={{ width: `${activeStream.percentage}%` }}
                  />
                </div>
                <span className="font-mono text-zinc-100">
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

      <main className="relative z-10 mx-auto w-full max-w-[1440px] flex-1 p-5">{children}</main>
    </div>
  );
}
