"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Cloud,
  Database,
  Server,
  Cpu,
  ChevronDown,
  RefreshCw,
  Check,
  Copy,
  ExternalLink,
  Zap,
  Power,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import type { HealthState } from "./TestbenchTopBar";

interface CloudClusterPopoverProps {
  health: HealthState | null;
  onRefreshHealth: () => void;
  traceId?: string | null;
  isSwarmOnline?: boolean;
}

export function CloudClusterPopover({
  health,
  onRefreshHealth,
  traceId,
  isSwarmOnline = false,
}: CloudClusterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [copiedTrace, setCopiedTrace] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  // Compute online count
  const r2Ok = Boolean(health?.r2?.connected);
  const supaOk = Boolean(health?.supabase?.connected);
  const tursoOk = Boolean(health?.turso?.connected);
  const swarmOk = isSwarmOnline;

  const onlineServices = [r2Ok, supaOk, tursoOk].filter(Boolean).length;
  const totalCore = 3; // R2, Supabase, Turso

  const handleCopyTrace = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!traceId) return;
    try {
      await navigator.clipboard.writeText(traceId);
      setCopiedTrace(true);
      setTimeout(() => setCopiedTrace(false), 2000);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="relative shrink-0" ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex h-8 items-center gap-1.5 sm:gap-2 rounded-lg border px-2 sm:px-2.5 text-xs font-medium transition-all shrink-0 ${
          open
            ? "border-sky-500/60 bg-sky-950/40 text-sky-200 shadow-sm"
            : "border-zinc-800 bg-zinc-900/90 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800"
        }`}
        title="Click to view Cloud Lake & Infrastructure Telemetry (R2, Supabase, Turso, Swarm)"
      >
        <Cloud
          className={`h-3.5 w-3.5 ${
            r2Ok ? "text-cyan-400" : "text-amber-400 animate-pulse"
          }`}
        />
        <span className="font-semibold text-zinc-200 hidden sm:inline">Cloud Lake</span>

        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold border ${
            onlineServices === totalCore
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              : onlineServices > 0
              ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
              : "bg-red-500/15 text-red-400 border-red-500/30"
          }`}
        >
          {onlineServices}/{totalCore}
          <span className="hidden md:inline"> {onlineServices === totalCore ? "Ready" : "Degraded"}</span>
        </span>

        <ChevronDown
          className={`h-3 w-3 text-zinc-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Floating Dark Glass Popover */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl border border-zinc-700/80 bg-zinc-950/95 p-4 text-xs shadow-2xl backdrop-blur-xl z-50 animate-in fade-in zoom-in-95 duration-100">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-sky-400" />
              <span className="font-bold text-zinc-100 text-sm">
                Infrastructure Lake Telemetry
              </span>
            </div>
            <button
              type="button"
              onClick={onRefreshHealth}
              className="flex items-center gap-1 rounded bg-zinc-900 border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:text-white hover:border-zinc-700 transition"
              title="Refresh infrastructure probes"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Probe</span>
            </button>
          </div>

          {/* Grid of Subsystems */}
          <div className="flex flex-col gap-2.5">
            {/* 1. Cloudflare R2 */}
            <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2.5">
              <div className="flex items-center gap-2.5">
                <div
                  className={`rounded-md p-1.5 ${
                    r2Ok
                      ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30"
                      : "bg-red-500/10 text-red-400 border border-red-500/30"
                  }`}
                >
                  <Cloud className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-zinc-200">Cloudflare R2 Storage Lake</div>
                  <div className="text-[11px] text-zinc-400">
                    {r2Ok
                      ? `${health?.r2?.latency_ms ?? 0}ms latency · ${
                          health?.r2?.object_count ?? 0
                        } objects`
                      : "Unreachable / Error"}
                  </div>
                </div>
              </div>
              <span
                className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 border ${
                  r2Ok
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-red-500/10 text-red-400 border-red-500/30"
                }`}
              >
                {r2Ok ? "Connected" : "Offline"}
              </span>
            </div>

            {/* 2. Supabase PostgreSQL */}
            <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2.5">
              <div className="flex items-center gap-2.5">
                <div
                  className={`rounded-md p-1.5 ${
                    supaOk
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                      : "bg-red-500/10 text-red-400 border border-red-500/30"
                  }`}
                >
                  <Database className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-zinc-200">Supabase Catalog</div>
                  <div className="text-[11px] text-zinc-400">
                    {supaOk
                      ? `${health?.supabase?.books_count ?? 0} novels cataloged`
                      : "Catalog connection pending"}
                  </div>
                </div>
              </div>
              <span
                className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 border ${
                  supaOk
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-red-500/10 text-red-400 border-red-500/30"
                }`}
              >
                {supaOk ? "Connected" : "Offline"}
              </span>
            </div>

            {/* 3. Turso libSQL */}
            <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2.5">
              <div className="flex items-center gap-2.5">
                <div
                  className={`rounded-md p-1.5 ${
                    tursoOk
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                  }`}
                >
                  <Database className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-zinc-200">Turso libSQL Hybrid Cache</div>
                  <div className="text-[11px] text-zinc-400">
                    {tursoOk ? "Online / Ready (104 KB budget)" : "Local sqlite mode"}
                  </div>
                </div>
              </div>
              <span
                className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 border ${
                  tursoOk
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}
              >
                {tursoOk ? "Connected" : "Local"}
              </span>
            </div>

            {/* 4. VM Swarm Dual-T4 */}
            <div className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2.5">
              <div className="flex items-center gap-2.5">
                <div
                  className={`rounded-md p-1.5 ${
                    swarmOk
                      ? "bg-purple-500/10 text-purple-400 border border-purple-500/30"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                  }`}
                >
                  <Cpu className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-zinc-200">Kaggle VM Swarm (Dual-T4)</div>
                  <div className="text-[11px] text-zinc-400">
                    {swarmOk ? "Active extraction workers online" : "Idle / Boot on demand"}
                  </div>
                </div>
              </div>
              <span
                className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 border ${
                  swarmOk
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}
              >
                {swarmOk ? "Online" : "Idle"}
              </span>
            </div>
          </div>

          {/* Footer: Trace ID */}
          {traceId && (
            <div className="mt-3 flex items-center justify-between border-t border-zinc-800/80 pt-2.5 text-[11px] text-zinc-400">
              <span className="font-mono text-zinc-500">Active Trace ID:</span>
              <button
                type="button"
                onClick={handleCopyTrace}
                className="flex items-center gap-1.5 font-mono text-sky-400 hover:text-sky-300 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 transition"
              >
                <span>{traceId.slice(0, 12)}…</span>
                {copiedTrace ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3 text-zinc-400" />
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
