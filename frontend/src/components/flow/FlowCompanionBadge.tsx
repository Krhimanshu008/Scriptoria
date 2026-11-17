// frontend/src/components/flow/FlowCompanionBadge.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import type {
  FlowCompanionStatus,
  FlowConnectionState,
  FlowQueueActionType,
} from "@/types/flow-contracts";

interface FlowCompanionBadgeProps {
  readonly projectId?: string;
  readonly pollIntervalMs?: number;
  readonly className?: string;
  readonly onOpenSetup?: () => void;
  readonly onStatusChange?: (status: FlowCompanionStatus) => void;
}

const DEFAULT_FLOW_PROJECT = "ea1ed436-e578-4327-9c9b-4f6b2e7e551d";

const STATE_CONFIG: Record<
  FlowConnectionState,
  {
    readonly label: string;
    readonly dotClass: string;
    readonly badgeClass: string;
    readonly pulse: boolean;
  }
> = {
  IDLE: {
    label: "Flow Companion Ready",
    dotClass: "bg-emerald-400",
    badgeClass:
      "border-emerald-500/30 bg-emerald-950/60 text-emerald-200 hover:border-emerald-400/50",
    pulse: false,
  },
  BUSY_GENERATING: {
    label: "Flow Generating…",
    dotClass: "bg-amber-400",
    badgeClass:
      "border-amber-500/40 bg-amber-950/70 text-amber-200 hover:border-amber-400/60",
    pulse: true,
  },
  SYNCING_INGREDIENTS: {
    label: "Syncing @Ingredients…",
    dotClass: "bg-sky-400",
    badgeClass:
      "border-sky-500/40 bg-sky-950/70 text-sky-200 hover:border-sky-400/60",
    pulse: true,
  },
  CONNECTING: {
    label: "Connecting Bridge…",
    dotClass: "bg-blue-400",
    badgeClass: "border-blue-500/30 bg-blue-950/60 text-blue-200",
    pulse: true,
  },
  PAUSED: {
    label: "Queue Paused",
    dotClass: "bg-purple-400",
    badgeClass: "border-purple-500/30 bg-purple-950/60 text-purple-200",
    pulse: false,
  },
  ERROR: {
    label: "Companion Error",
    dotClass: "bg-rose-500",
    badgeClass: "border-rose-500/40 bg-rose-950/70 text-rose-200",
    pulse: false,
  },
  DISCONNECTED: {
    label: "Companion Offline",
    dotClass: "bg-zinc-500",
    badgeClass:
      "border-zinc-700/80 bg-zinc-900/90 text-zinc-400 hover:border-zinc-600",
    pulse: false,
  },
};

export function FlowCompanionBadge({
  projectId = "default-project",
  pollIntervalMs = 4000,
  className = "",
  onOpenSetup,
  onStatusChange,
}: FlowCompanionBadgeProps) {
  const [status, setStatus] = useState<FlowCompanionStatus>({
    session_id: "init",
    connection_state: "CONNECTING",
    flow_project_id: DEFAULT_FLOW_PROJECT,
    active_tab_url: null,
    extension_version: "1.0.0",
    user_agent: null,
    active_task_id: null,
    queued_tasks_count: 0,
    completed_tasks_count: 0,
    failed_tasks_count: 0,
    available_ingredients: [],
    last_heartbeat_at: new Date().toISOString(),
    last_error: null,
  });
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/flow/dispatch", {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as FlowCompanionStatus;
      setStatus(data);
      onStatusChange?.(data);
    } catch (_err) {
      const fallback: FlowCompanionStatus = {
        ...status,
        connection_state: "DISCONNECTED",
      };
      setStatus(fallback);
      onStatusChange?.(fallback);
    }
  }, [onStatusChange, status]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchStatus, pollIntervalMs]);

  const sendQueueAction = async (action: FlowQueueActionType) => {
    setIsActionPending(true);
    try {
      const res = await fetch("/api/flow/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "QUEUE_ACTION",
          payload: {
            action,
            project_id: projectId,
          },
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as FlowCompanionStatus;
        setStatus(updated);
      }
    } finally {
      setIsActionPending(false);
    }
  };

  const config =
    STATE_CONFIG[status.connection_state] || STATE_CONFIG.DISCONNECTED;
  const flowUrl = `https://flow.google.com/project/${
    status.flow_project_id || DEFAULT_FLOW_PROJECT
  }`;

  return (
    <div className={`relative inline-block text-left ${className}`}>
      {/* Status Pill Button */}
      <button
        type="button"
        onClick={() => setIsDrawerOpen((prev) => !prev)}
        className={`inline-flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200 shadow-sm ${config.badgeClass}`}
        title="Click to inspect Google AI Flow Companion telemetry"
      >
        <span className="relative flex h-2.5 w-2.5">
          {config.pulse && (
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${config.dotClass}`}
            />
          )}
          <span
            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${config.dotClass}`}
          />
        </span>

        <span>{config.label}</span>

        <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] opacity-90">
          Q:{status.queued_tasks_count} · ✓:{status.completed_tasks_count}
        </span>
      </button>

      {/* Telemetry & Quick Control Popover */}
      {isDrawerOpen && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-zinc-800 bg-zinc-950/95 p-4 text-xs text-zinc-200 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <div>
              <p className="font-semibold text-white">
                Google AI Flow Companion
              </p>
              <p className="font-mono text-[10px] text-zinc-400">
                Project: {status.flow_project_id.slice(0, 18)}…
              </p>
            </div>
            <a
              href={flowUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:border-zinc-500 hover:text-white"
            >
              Open Flow ↗
            </a>
          </div>

          {/* Metrics Grid */}
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-2">
              <div className="text-[10px] uppercase text-zinc-400">Queued</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-amber-300">
                {status.queued_tasks_count}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-2">
              <div className="text-[10px] uppercase text-zinc-400">Saved</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-emerald-300">
                {status.completed_tasks_count}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-2">
              <div className="text-[10px] uppercase text-zinc-400">Failed</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-rose-400">
                {status.failed_tasks_count}
              </div>
            </div>
          </div>

          {/* Detected @Ingredients */}
          <div className="mt-3">
            <p className="text-[11px] font-medium text-zinc-400">
              Detected @Ingredients ({status.available_ingredients.length})
            </p>
            {status.available_ingredients.length > 0 ? (
              <div className="mt-1.5 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                {status.available_ingredients.map((handle) => (
                  <span
                    key={handle}
                    className="rounded border border-sky-500/30 bg-sky-950/50 px-1.5 py-0.5 font-mono text-[10px] text-sky-300"
                  >
                    @{handle}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[11px] italic text-zinc-500">
                No @ingredients detected in current Flow drawer.
              </p>
            )}
          </div>

          {/* Error Banner if present */}
          {status.last_error && (
            <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-950/40 p-2 text-[11px] text-rose-300">
              {status.last_error}
            </div>
          )}

          {/* Quick Setup Modal Launcher when Disconnected */}
          {status.connection_state === "DISCONNECTED" && onOpenSetup && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/40 p-2.5 text-center">
              <p className="text-[11px] text-amber-200 mb-1.5 font-medium">Extension offline or not installed.</p>
              <button
                type="button"
                onClick={() => {
                  setIsDrawerOpen(false);
                  onOpenSetup();
                }}
                className="w-full rounded bg-amber-500 py-1 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition"
              >
                🔌 Install / Connect Companion
              </button>
            </div>
          )}

          {/* Queue Control Actions */}
          <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-zinc-800 pt-3">
            <button
              type="button"
              disabled={isActionPending}
              onClick={() => sendQueueAction("PING_COMPANION")}
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              Ping Tab
            </button>

            {status.connection_state === "PAUSED" ? (
              <button
                type="button"
                disabled={isActionPending}
                onClick={() => sendQueueAction("RESUME")}
                className="flex-1 rounded-md border border-emerald-600/50 bg-emerald-950/70 px-2.5 py-1.5 text-[11px] font-medium text-emerald-200 hover:bg-emerald-900/70 disabled:opacity-50"
              >
                Resume Queue
              </button>
            ) : (
              <button
                type="button"
                disabled={isActionPending}
                onClick={() => sendQueueAction("PAUSE")}
                className="flex-1 rounded-md border border-amber-600/40 bg-amber-950/60 px-2.5 py-1.5 text-[11px] font-medium text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
              >
                Pause Queue
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default FlowCompanionBadge;
