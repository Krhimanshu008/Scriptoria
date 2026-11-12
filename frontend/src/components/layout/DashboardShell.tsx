"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Server,
  HardDriveDownload,
  Images,
  Settings,
  PowerOff,
  LogOut,
  Loader2,
  Sparkles,
  Cpu,
  Bot,
  Zap,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth/session";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { useClusterStore } from "@/store/cluster-store";
import { formatStreamSummary } from "@/lib/format";
import { toast } from "sonner";

const NAV_GROUPS = [
  {
    section: "Compute",
    items: [
      { href: "/vms", label: "GPU Cluster", icon: Server },
      { href: "/tpu-cluster", label: "TPU Cluster", icon: Zap },
      { href: "/models", label: "Models & Drive", icon: HardDriveDownload },
    ],
  },
  {
    section: "Intelligence & Studio",
    items: [
      { href: "/llm-studio", label: "LLM Studio", icon: Bot },
      { href: "/studio", label: "Studio", icon: Sparkles },
      { href: "/history", label: "Outputs", icon: Images },
    ],
  },
  {
    section: "System",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

function pageTitleForPath(pathname: string): string {
  if (pathname.startsWith("/llm-studio")) return "LLM Studio";
  if (pathname.startsWith("/tpu-cluster")) return "TPU Cluster (v5e-8)";
  if (pathname.startsWith("/vms")) return "GPU Cluster";
  if (pathname.startsWith("/studio")) return "Studio Workstation";
  if (pathname.startsWith("/models")) return "Models & Drive";
  if (pathname.startsWith("/history")) return "Output Gallery";
  if (pathname.startsWith("/settings")) return "Settings & Vault";
  return "Scriptoria";
}

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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const renderSidebarNav = (isCompact: boolean, onNavigate?: () => void) => (
    <div className="flex h-full flex-col justify-between bg-[#0c0c0f]">
      <div>
        {/* Brand Row */}
        <div
          className={`flex h-12 items-center border-b border-zinc-800/90 ${
            isCompact ? "justify-center px-2" : "justify-between px-3.5"
          }`}
        >
          <Link
            href="/"
            onClick={onNavigate}
            className="flex min-w-0 items-center gap-2.5 text-zinc-100"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-indigo-400">
              <Server className="h-3.5 w-3.5" />
            </div>
            {!isCompact && (
              <span className="truncate text-[13px] font-semibold tracking-tight text-white">
                Scriptoria
              </span>
            )}
          </Link>

          {!isCompact && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              className="hidden rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 md:inline-flex"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {isCompact && (
          <div className="hidden justify-center border-b border-zinc-800/80 py-2 md:flex">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
              className="rounded p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              <PanelLeftOpen className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Categorized Navigation */}
        <nav className="space-y-5 px-2.5 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.section} className="space-y-1">
              {!isCompact && (
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {group.section}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    onClick={onNavigate}
                    title={isCompact ? item.label : undefined}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition ${
                      isCompact ? "justify-center px-0" : ""
                    } ${
                      active
                        ? "bg-zinc-800/90 text-white"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        active ? "text-indigo-400" : "text-zinc-500"
                      }`}
                    />
                    {!isCompact && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      {/* Sidebar Footer: Cluster & User */}
      <div className="border-t border-zinc-800/90 p-2.5">
        {!isCompact ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-[11px]">
              <span className="flex items-center gap-1.5 text-zinc-400">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    onlineVms.length > 0 ? "bg-emerald-500" : "bg-zinc-600"
                  }`}
                />
                GPUs
              </span>
              <span className="font-mono tabular-nums text-zinc-200">
                {onlineVms.length}/{vms.length || 6} · {totalVram.toFixed(0)}G
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 px-1">
              <span className="truncate text-[11px] text-zinc-400" title={user.email}>
                {user.email}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                title="Sign out"
                className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <span
              title={`Online: ${onlineVms.length}/${vms.length || 6} (${totalVram.toFixed(0)} GB)`}
              className={`h-2 w-2 rounded-full ${
                onlineVms.length > 0 ? "bg-emerald-500" : "bg-zinc-600"
              }`}
            />
            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#09090b] text-zinc-100">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-zinc-800/90 transition-[width] duration-150 md:block ${
          collapsed ? "w-14" : "w-56"
        }`}
      >
        {renderSidebarNav(collapsed)}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 h-full w-56 border-r border-zinc-800 bg-[#0c0c0f]">
            {renderSidebarNav(false, () => setMobileOpen(false))}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Slim 48px Header */}
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-zinc-800/90 bg-[#09090b]/95 px-4 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white md:hidden"
              title="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <span className="truncate text-sm font-medium text-zinc-100">
              {pageTitleForPath(pathname)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {activeStream?.active && (
              <div className="hidden items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-[11px] text-zinc-200 sm:flex">
                <HardDriveDownload className="h-3.5 w-3.5 text-indigo-400" />
                <span className="max-w-[180px] truncate">{activeStream.modelName}</span>
                <span className="text-zinc-400">{activeStream.percentage}%</span>
                <button
                  type="button"
                  onClick={() => setActiveStream(null)}
                  className="text-zinc-500 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleEmergencyStopAll}
              disabled={stoppingAll || onlineVms.length === 0}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-40 whitespace-nowrap"
            >
              {stoppingAll ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <PowerOff className="h-3 w-3" />
              )}
              <span>Stop All</span>
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 md:p-5">{children}</main>
      </div>
    </div>
  );
}
