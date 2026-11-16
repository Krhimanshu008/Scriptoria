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
import { UnifiedVmController } from "./UnifiedVmController";
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
      <header className="sticky top-0 z-40 w-full shrink-0 border-b border-zinc-800 bg-[#09090b]/95 backdrop-blur-sm select-none">
        {/* ==================================================================== */}
        {/* ROW 1: Project & Novel Context (Left) + Contract & Trace (Right)     */}
        {/* ==================================================================== */}
        <div className="flex h-11 w-full items-center justify-between border-b border-zinc-800/80 px-3 md:px-4 gap-2 sm:gap-3">
          {/* Group 1: Workspace & Novel Context */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-2 border-r border-zinc-800/90 pr-2.5 sm:pr-3 shrink-0">
              <span className="text-xs font-bold tracking-tight text-white">Pipeline Testbench</span>
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30">
                v2.0
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 border border-zinc-700/80 text-zinc-100 shrink-0">
                <BookOpen className="h-3.5 w-3.5 text-amber-400" />
              </div>

              <select
                value={activeBookId}
                onChange={(e) => onSelectBook(e.target.value)}
                aria-label="Active Novel"
                className="h-7 max-w-[150px] sm:max-w-[200px] md:max-w-[260px] rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs font-medium text-zinc-100 hover:border-zinc-600 focus:border-amber-500 focus:outline-none cursor-pointer truncate shrink-0"
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
                  className={`inline-flex h-7 items-center rounded-md border px-2 text-[10px] font-semibold uppercase tracking-wider shrink-0 ${getStatusBadge(
                    activeBook.status
                  )}`}
                >
                  {activeBook.status} ({activeBook.total_chapters} ch)
                </span>
              )}

              <button
                onClick={onOpenUploadModal}
                className="flex h-7 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 sm:px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800 shrink-0"
                title="Upload new novel to R2 lake"
              >
                <Plus className="h-3.5 w-3.5 text-amber-400" />
                <span className="hidden sm:inline">Upload</span>
              </button>
            </div>
          </div>

          {/* Group 2: System Contracts & Active Trace Group */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <ContractHashBadge />
          </div>
        </div>

        {/* ==================================================================== */}
        {/* ROW 2: Cloud GPU Compute Engine (Left) + Cloud Lake & Health (Right) */}
        {/* ==================================================================== */}
        <div className="flex h-11 w-full items-center justify-between px-3 md:px-4 gap-2 sm:gap-3 bg-zinc-950/70">
          {/* Group 3: Cloud GPU Swarm Compute Group */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-2 bg-zinc-900/90 border border-zinc-800 rounded-lg p-0.5 sm:p-1">
              <span className="hidden sm:flex items-center gap-1.5 px-2 text-[11px] font-semibold text-amber-400 uppercase tracking-wider border-r border-zinc-800 shrink-0">
                <Cpu className="h-3.5 w-3.5 text-amber-400" />
                <span>Compute Swarm</span>
              </span>

              {/* UNIFIED VM CONTROLLER: Select VM, Select Model/Profile, Single Boot/Kill Button */}
              <UnifiedVmController
                vms={vms}
                onRefreshVms={onRefreshVms}
                onRefreshHealth={onRefreshHealth}
              />
            </div>
          </div>

          {/* Group 4: Cloud Lake & Global Infrastructure Status */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {/* Cloud Lake Telemetry Popover (R2, Supabase, Turso) */}
            <CloudClusterPopover
              health={health}
              onRefreshHealth={onRefreshHealth}
              isSwarmOnline={isSwarmOnline}
            />

            <button
              onClick={() => {
                onRefreshHealth();
                onRefreshVms?.();
              }}
              className="h-8 px-2 sm:px-2.5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition shrink-0 text-xs"
              title="Refresh All Cloud Health & VM Swarm"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Refresh All</span>
            </button>
          </div>
        </div>
      </header>
    </>
  );
}
