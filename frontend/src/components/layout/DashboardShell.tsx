"use client";

import React, { useState } from "react";
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
} from "lucide-react";
import type { SessionUser } from "@/lib/auth/session";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { useClusterStore } from "@/store/cluster-store";
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
  });

  const vms = data?.vms ?? [];
  const onlineVms = vms.filter((v) => v.status === "ONLINE" || v.status === "BUSY");
  const totalVram = onlineVms.reduce((acc, v) => acc + (v.vramTotalGb || 16), 0);

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
            <Link href="/" className="flex items-center gap-2.5">
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
          <div className="border-t border-indigo-500/30 bg-indigo-950/30 px-6 py-2">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2 font-mono text-indigo-300">
                <HardDriveDownload className="h-4 w-4 animate-pulse" />
                <span>
                  Streaming {activeStream.modelName} ➔ {activeStream.target} (/tmp/models/
                  {activeStream.category})
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-40 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${activeStream.percentage}%` }}
                  />
                </div>
                <span className="font-mono text-zinc-200">
                  {activeStream.percentage}% ({activeStream.speedText})
                </span>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 p-6">{children}</main>
    </div>
  );
}

