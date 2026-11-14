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
} from "lucide-react";
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
  r2: { connected: boolean; latency_ms?: number; object_count?: number; bucket?: string };
  supabase: { connected: boolean; books_count?: number; status?: string };
  turso: { connected: boolean; status?: string };
  vm_swarm: { online: boolean; active_targets?: Array<{ target: string; public_url: string }> };
}

interface TestbenchTopBarProps {
  books: BookSummary[];
  activeBookId: string;
  onSelectBook: (id: string) => void;
  health: HealthState | null;
  onRefreshHealth: () => void;
  onOpenUploadModal: () => void;
}

export function TestbenchTopBar({
  books,
  activeBookId,
  onSelectBook,
  health,
  onRefreshHealth,
  onOpenUploadModal,
}: TestbenchTopBarProps) {
  const [isKilling, setIsKilling] = useState(false);
  const activeBook = books.find((b) => b.book_id === activeBookId);

  const handlePanicKill = async () => {
    setIsKilling(true);
    try {
      const res = await fetch("/api/pipeline/vm/panic-kill", { method: "POST" });
      const data = await res.json();
      toast.success("Emergency /vm-kill signal sent! Cloud GPUs terminated.", {
        description: JSON.stringify(data.results || {}),
      });
      onRefreshHealth();
    } catch (err: any) {
      toast.error("Failed to dispatch panic kill: " + err.message);
    } finally {
      setIsKilling(false);
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
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-6 backdrop-blur">
      {/* Left: Active Book Switcher */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800/80 border border-zinc-700/60 text-zinc-100">
          <BookOpen className="h-5 w-5 text-amber-400" />
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <select
              value={activeBookId}
              onChange={(e) => onSelectBook(e.target.value)}
              className="h-8 max-w-[280px] rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-sm font-medium text-zinc-100 hover:border-zinc-600 focus:border-amber-500 focus:outline-none"
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
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${getStatusBadge(
                  activeBook.status
                )}`}
              >
                {activeBook.status} ({activeBook.total_chapters} ch)
              </span>
            )}

            <button
              onClick={onOpenUploadModal}
              className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-700"
            >
              <Plus className="h-3.5 w-3.5 text-amber-400" />
              Upload Book
            </button>
          </div>
        </div>
      </div>

      {/* Center: Live Cloud Health Pills */}
      <div className="hidden lg:flex items-center gap-2.5">
        {/* R2 Pill */}
        <div
          onClick={onRefreshHealth}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs transition-all hover:border-zinc-600"
          title="Click to refresh cloud health"
        >
          <Cloud
            className={`h-3.5 w-3.5 ${
              health?.r2.connected ? "text-cyan-400" : "text-red-400 animate-pulse"
            }`}
          />
          <span className="font-medium text-zinc-300">R2:</span>
          {health?.r2.connected ? (
            <span className="text-zinc-400">
              {health.r2.latency_ms}ms · {health.r2.object_count ?? 0} objs
            </span>
          ) : (
            <span className="text-red-400">Error</span>
          )}
        </div>

        {/* Supabase Pill */}
        <div
          onClick={onRefreshHealth}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs transition-all hover:border-zinc-600"
          title="Click to refresh cloud health"
        >
          <Database
            className={`h-3.5 w-3.5 ${
              health?.supabase.connected ? "text-emerald-400" : "text-red-400 animate-pulse"
            }`}
          />
          <span className="font-medium text-zinc-300">Supabase:</span>
          <span className="text-zinc-400">
            {health?.supabase.connected ? `${health.supabase.books_count} books` : "Offline"}
          </span>
        </div>

        {/* Turso Pill */}
        <div
          onClick={onRefreshHealth}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs transition-all hover:border-zinc-600"
          title="Click to refresh cloud health"
        >
          <Server
            className={`h-3.5 w-3.5 ${
              health?.turso.connected ? "text-indigo-400" : "text-red-400 animate-pulse"
            }`}
          />
          <span className="font-medium text-zinc-300">Turso:</span>
          <span className="text-zinc-400">
            {health?.turso.connected ? "104 KB / 8 MB" : "Offline"}
          </span>
        </div>

        {/* VM Swarm Pill */}
        <div
          onClick={onRefreshHealth}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs transition-all hover:border-zinc-600"
          title="Click to refresh cloud health"
        >
          <Cpu
            className={`h-3.5 w-3.5 ${
              health?.vm_swarm.online ? "text-green-400 animate-pulse" : "text-zinc-500"
            }`}
          />
          <span className="font-medium text-zinc-300">VM Swarm:</span>
          <span
            className={
              health?.vm_swarm.online ? "font-semibold text-green-400" : "text-zinc-500"
            }
          >
            {health?.vm_swarm.online ? "ONLINE (dual-T4)" : "OFFLINE"}
          </span>
        </div>

        <button
          onClick={onRefreshHealth}
          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Refresh All Cloud Health"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Right: Emergency Panic Kill Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handlePanicKill}
          disabled={isKilling}
          className="flex items-center gap-2 rounded-lg border border-red-700/80 bg-red-950/80 px-3.5 py-1.5 text-xs font-semibold text-red-300 shadow-sm transition-all hover:bg-red-900 hover:border-red-500 active:scale-95 disabled:opacity-50"
          title="Emergency Stop: Immediately dispatches /vm-kill to Kaggle/Colab to preserve weekly GPU quota"
        >
          <Power className={`h-4 w-4 text-red-400 ${isKilling ? "animate-spin" : ""}`} />
          <span>{isKilling ? "Terminating..." : "🛑 /vm-kill Panic"}</span>
        </button>
      </div>
    </header>
  );
}
