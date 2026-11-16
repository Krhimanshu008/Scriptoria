"use client";

import React, { useState } from "react";
import {
  Cloud,
  Database,
  Server,
  Cpu,
  Power,
  RefreshCw,
  Plus,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Zap,
  Settings2,
  ChevronDown,
  Loader2,
  ExternalLink,
} from "lucide-react";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import type { KaggleAccountSummary, ColabAccountSummary } from "@/app/api/vm/accounts/route";
import { TestbenchVmModal } from "./TestbenchVmModal";
import { ContractHashBadge } from "./ContractHashBadge";
import { CloudClusterPopover } from "./CloudClusterPopover";
import { toast } from "sonner";

export interface BookSummary {
  book_id: string;
  slug: string;
  title: string;
  author: string;
  source_filename: string;
  format: string;
  total_chapters: number;
  status: string;
}

export interface HealthState {
  r2?: { connected?: boolean; latency_ms?: number; object_count?: number; bucket?: string };
  supabase?: { connected?: boolean; books_count?: number; status?: string };
  turso?: { connected?: boolean; status?: string };
  vm_swarm?: { online?: boolean; active_targets?: Array<{ target: string; public_url: string }> };
}

interface TestbenchTopBarProps {
  books: BookSummary[];
  activeBookId: string;
  onSelectBook: (id: string) => void;
  health: HealthState | null;
  onRefreshHealth: () => void;
  onOpenUploadModal: () => void;
  vms?: PublicVmInstance[];
  kaggleAccounts?: KaggleAccountSummary[];
  colabAccounts?: ColabAccountSummary[];
  onRefreshVms?: () => void;
}

export function TestbenchTopBar({
  books,
  activeBookId,
  onSelectBook,
  health,
  onRefreshHealth,
  onOpenUploadModal,
  vms = [],
  kaggleAccounts = [],
  colabAccounts = [],
  onRefreshVms,
}: TestbenchTopBarProps) {
  const [isKilling, setIsKilling] = useState(false);
  const [isBooting, setIsBooting] = useState(false);
  const [vmModalOpen, setVmModalOpen] = useState(false);

  const activeBook = books.find((b) => b.book_id === activeBookId);

  // Swarm state computation
  const isSwarmOnline = Boolean(
    health?.vm_swarm?.online || vms.some((v) => v.status === "ONLINE" || v.status === "BUSY")
  );
  const startingVm = vms.find((v) => v.status === "STARTING");
  const isStarting = !isSwarmOnline && Boolean(startingVm);
  const primaryOnlineVm = vms.find((v) => v.status === "ONLINE" || v.status === "BUSY");

  // Emergency Panic Kill
  const handlePanicKill = async () => {
    setIsKilling(true);
    try {
      const res = await fetch("/api/pipeline/vm/panic-kill", { method: "POST" });
      const data = await res.json();
      toast.success("Emergency /vm-kill signal sent! Cloud GPUs terminated.", {
        description: JSON.stringify(data.results || {}),
      });
      onRefreshHealth();
      onRefreshVms?.();
    } catch (err: any) {
      toast.error("Failed to dispatch panic kill: " + err.message);
    } finally {
      setIsKilling(false);
    }
  };

  // Direct Boot (defaults to primary configured target e.g. gpu0)
  const handleBootPrimary = async (target = "gpu0") => {
    setIsBooting(true);
    try {
      const res = await fetch(`/api/vm/${encodeURIComponent(target)}/toggle`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Failed to boot ${target}`);
        return;
      }
      toast.success(`⚡ Boot signal sent to ${target.toUpperCase()}! Initializing kernel & tunnel...`);
      onRefreshHealth();
      onRefreshVms?.();
    } catch (err: any) {
      toast.error("Boot request failed: " + err.message);
    } finally {
      setIsBooting(false);
    }
  };

  const getStatusBadge = (status?: string) => {
    const s = status?.toUpperCase() || "UNKNOWN";
    if (s === "COMPILED" || s === "RAG_READY") {
      return "bg-emerald-950/80 text-emerald-400 border-emerald-800";
    }
    if (s === "PARSED") {
      return "bg-cyan-950/80 text-cyan-400 border-cyan-800";
    }
    if (s.startsWith("EXTRACT")) {
      return "bg-amber-950/80 text-amber-400 border-amber-800";
    }
    return "bg-zinc-800 text-zinc-300 border-zinc-700";
  };

  return (
    <>
      <header className="sticky top-0 z-40 flex h-13 w-full shrink-0 items-center justify-between border-b border-zinc-800 bg-[#09090b]/95 px-3 md:px-4 backdrop-blur-sm select-none gap-2">
        {/* Left: Brand + Active Book Switcher & Status */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="hidden xl:flex items-center gap-2 border-r border-zinc-800/80 pr-3">
            <span className="text-xs font-bold tracking-tight text-white">Pipeline Testbench</span>
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30">
              v2.0
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-700/80 text-zinc-100 shrink-0">
              <BookOpen className="h-4 w-4 text-amber-400" />
            </div>

            <select
              value={activeBookId}
              onChange={(e) => onSelectBook(e.target.value)}
              className="h-8 max-w-[150px] sm:max-w-[200px] md:max-w-[240px] rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs font-medium text-zinc-100 hover:border-zinc-600 focus:border-amber-500 focus:outline-none truncate"
            >
              {books.map((b) => (
                <option key={b.book_id} value={b.book_id}>
                  {b.title}
                </option>
              ))}
              {books.length === 0 && <option value="">No books loaded</option>}
            </select>

            {activeBook && (
              <span
                className={`hidden md:inline-flex h-8 items-center rounded-md border px-2 text-[11px] font-semibold uppercase tracking-wider shrink-0 ${getStatusBadge(
                  activeBook.status
                )}`}
              >
                {activeBook.status} ({activeBook.total_chapters} ch)
              </span>
            )}

            <button
              onClick={onOpenUploadModal}
              className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800 shrink-0"
              title="Upload new novel to R2 lake"
            >
              <Plus className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden sm:inline">Upload</span>
            </button>
          </div>
        </div>

        {/* Center: Live Cloud Health & Contract Parity Badges (Compact & Popover) */}
        <div className="flex items-center gap-2 flex-nowrap shrink-0">
          {/* Contract Hash Parity Badge */}
          <ContractHashBadge />

          {/* Unified Cloud Lake Cluster Popover (R2, Supabase, Turso, VM Swarm) */}
          <CloudClusterPopover
            health={health}
            onRefreshHealth={onRefreshHealth}
            isSwarmOnline={isSwarmOnline}
            onBootSwarm={() => handleBootPrimary("gpu0")}
            onPanicKill={handlePanicKill}
          />
        </div>

        {/* Right: Primary Controls (Swarm Boot/Kill & Manage Modal) */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Quick Targets Modal Trigger */}
          <button
            onClick={() => setVmModalOpen(true)}
            className="hidden sm:flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 px-2.5 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 transition shrink-0"
            title="Configure VM Swarm Targets & LLM Profiles"
          >
            <Settings2 className="h-3.5 w-3.5 text-zinc-400" />
            <span className="hidden md:inline">Manage Swarm</span>
          </button>

          {/* DYNAMIC PRIMARY BUTTON */}
          {isSwarmOnline ? (
            /* ONLINE -> Switches dynamically to /vm-kill Panic button */
            <button
              onClick={handlePanicKill}
              disabled={isKilling}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-red-700/80 bg-red-950/80 px-3 text-xs font-semibold text-red-300 shadow-sm transition-all hover:bg-red-900 hover:border-red-500 active:scale-95 disabled:opacity-50 shrink-0"
              title="Swarm is ONLINE. Click to immediately terminate GPU sessions and save quota."
            >
              <Power className={`h-3.5 w-3.5 text-red-400 ${isKilling ? "animate-spin" : ""}`} />
              <span>{isKilling ? "Stopping..." : "🛑 /vm-kill Panic"}</span>
            </button>
          ) : isStarting ? (
            /* STARTING -> Progress indicator + Cancel option */
            <button
              onClick={handlePanicKill}
              disabled={isKilling}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-600/80 bg-amber-950/80 px-3 text-xs font-semibold text-amber-300 shadow-sm transition-all hover:bg-amber-900 active:scale-95 shrink-0"
              title="VM Kernel is booting. Click to cancel."
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
              <span>Starting ({startingVm?.stepProgress || 1}/5)</span>
            </button>
          ) : (
            /* OFFLINE -> Direct 1-Click BOOT SWARM Button */
            <button
              onClick={() => handleBootPrimary("gpu0")}
              disabled={isBooting}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-500 bg-amber-500 px-3 text-xs font-semibold text-zinc-950 shadow-sm transition-all hover:bg-amber-400 active:scale-95 disabled:opacity-50 shrink-0"
              title="Swarm is OFFLINE. Click to boot Kaggle Dual-T4 Swarm (gpu0) with 1 click!"
            >
              {isBooting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5 fill-current" />
              )}
              <span>{isBooting ? "Booting..." : "⚡ Boot Swarm"}</span>
            </button>
          )}
        </div>
      </header>

      {/* VM Swarm & Target Configuration Modal */}
      <TestbenchVmModal
        open={vmModalOpen}
        onOpenChange={setVmModalOpen}
        vms={vms}
        kaggleAccounts={kaggleAccounts}
        colabAccounts={colabAccounts}
        onRefresh={() => {
          onRefreshHealth();
          onRefreshVms?.();
        }}
      />
    </>
  );
}
