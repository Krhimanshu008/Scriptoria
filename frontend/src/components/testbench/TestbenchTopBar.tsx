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
      <header className="sticky top-0 z-40 flex h-13 w-full shrink-0 items-center justify-between border-b border-zinc-800 bg-[#09090b]/95 px-2.5 sm:px-3 md:px-4 backdrop-blur-sm select-none gap-2 overflow-x-auto overflow-y-hidden">
        {/* Left: Brand + Active Book Switcher & Status + Contract Hash */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
          <div className="hidden 2xl:flex items-center gap-2 border-r border-zinc-800/80 pr-3 shrink-0">
            <span className="text-xs font-bold tracking-tight text-white">Pipeline Testbench</span>
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30">
              v2.0
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <div className="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-700/80 text-zinc-100 shrink-0">
              <BookOpen className="h-4 w-4 text-amber-400" />
            </div>

            <select
              value={activeBookId}
              onChange={(e) => onSelectBook(e.target.value)}
              className="h-8 max-w-[120px] sm:max-w-[150px] md:max-w-[190px] rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs font-medium text-zinc-100 hover:border-zinc-600 focus:border-amber-500 focus:outline-none cursor-pointer truncate shrink-0"
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
                className={`hidden 2xl:inline-flex h-8 items-center rounded-md border px-2 text-[11px] font-semibold uppercase tracking-wider shrink-0 ${getStatusBadge(
                  activeBook.status
                )}`}
              >
                {activeBook.status} ({activeBook.total_chapters} ch)
              </span>
            )}

            <button
              onClick={onOpenUploadModal}
              className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 sm:px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800 shrink-0"
              title="Upload new novel to R2 lake"
            >
              <Plus className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden md:inline">Upload</span>
            </button>

            {/* Contract Hash Parity Badge */}
            <ContractHashBadge />
          </div>
        </div>

        {/* Right: Unified VM Compute Control + Cloud Lake Popover + Refresh */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0 ml-auto">
          {/* UNIFIED VM CONTROLLER: Select VM, Select Model/Profile, Single Boot/Kill Button */}
          <UnifiedVmController
            vms={vms}
            onRefreshVms={onRefreshVms}
            onRefreshHealth={onRefreshHealth}
          />

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
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition shrink-0"
            title="Refresh All Cloud Health & VM Swarm"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
    </>
  );
}
