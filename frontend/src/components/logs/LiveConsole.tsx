"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Terminal, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface LogEntry {
  id: string;
  category: string;
  level: string;
  message: string;
  createdAt: string;
}

const CATEGORIES = ["ALL", "ACTION", "KAGGLE", "COLAB", "RCLONE", "COMFYUI", "NETWORK", "ERROR"];

function getCategoryColor(category: string, level: string): string {
  if (level === "ERROR") return "text-rose-400 font-semibold";
  if (level === "SUCCESS") return "text-emerald-400 font-semibold";
  if (level === "WARN") return "text-amber-300";
  switch (category) {
    case "KAGGLE":
      return "text-cyan-300";
    case "COLAB":
      return "text-amber-300";
    case "RCLONE":
      return "text-violet-300";
    case "COMFYUI":
      return "text-indigo-300";
    default:
      return "text-zinc-400";
  }
}

export function LiveConsole({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [category, setCategory] = useState("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const { data, refetch } = useQuery<{ logs: LogEntry[] }>({
    queryKey: ["system-logs", category],
    queryFn: async () => {
      const res = await fetch(`/api/logs?limit=100&category=${encodeURIComponent(category)}`);
      if (!res.ok) throw new Error("Failed to load logs");
      return res.json();
    },
    refetchInterval: 4000,
  });

  const logs = data?.logs ?? [];
  const latest = logs[logs.length - 1];

  useEffect(() => {
    if (expanded && autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [expanded, logs.length, autoScroll]);

  async function handleClear() {
    const res = await fetch("/api/logs", { method: "DELETE" });
    if (res.ok) {
      toast.success("Cleared console logs");
      refetch();
    }
  }

  return (
    <div className="glass-panel overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <Terminal className="h-4 w-4 shrink-0 text-indigo-400" />
          <span className="font-mono font-semibold text-white whitespace-nowrap">
            Audit Stream ({logs.length})
          </span>
          {!expanded && latest && (
            <span className="hidden truncate font-mono text-[11px] text-zinc-400 sm:inline">
              — <span className={getCategoryColor(latest.category, latest.level)}>[{latest.category}]</span>{" "}
              {latest.message}
            </span>
          )}
        </button>

        <div className="flex items-center gap-3">
          {expanded && (
            <>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="glass-input rounded-lg px-2 py-1 text-[11px] text-zinc-200 focus:outline-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-zinc-900">
                    {c === "ALL" ? "All Categories" : c}
                  </option>
                ))}
              </select>

              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded border-white/20 bg-white/10"
                />
                Auto-scroll
              </label>

              <button
                onClick={handleClear}
                title="Clear logs"
                className="text-zinc-400 transition hover:text-white"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="glass-pill flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:text-white"
          >
            {expanded ? (
              <>
                Collapse <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Expand <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div
          ref={bodyRef}
          className="h-64 space-y-1 overflow-y-auto border-t border-white/10 bg-black/35 p-4 font-mono text-[12px] leading-relaxed text-zinc-300"
        >
          {logs.length === 0 ? (
            <div className="italic text-zinc-500">
              [SYSTEM] No logs recorded yet. Boot a cluster node or trigger an action.
            </div>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="break-words">
                <span className="text-zinc-600">
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </span>{" "}
                <span className={getCategoryColor(entry.category, entry.level)}>
                  [{entry.category}]
                </span>{" "}
                <span>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
