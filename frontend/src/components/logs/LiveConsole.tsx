"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Terminal, Trash2 } from "lucide-react";
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
  if (level === "WARN") return "text-amber-400";
  switch (category) {
    case "KAGGLE":
      return "text-cyan-400";
    case "COLAB":
      return "text-amber-400";
    case "RCLONE":
      return "text-violet-400";
    case "COMFYUI":
      return "text-indigo-400";
    default:
      return "text-zinc-400";
  }
}

export function LiveConsole() {
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
    refetchInterval: 3000,
  });

  const logs = data?.logs ?? [];

  useEffect(() => {
    if (autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs.length, autoScroll]);

  async function handleClear() {
    const res = await fetch("/api/logs", { method: "DELETE" });
    if (res.ok) {
      toast.success("Cleared console logs");
      refetch();
    }
  }

  return (
    <div className="flex h-80 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d1117] shadow-xl">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2 font-mono font-semibold text-zinc-200">
          <Terminal className="h-4 w-4 text-indigo-400" />
          <span>Cluster Audit &amp; Heartbeat Stream</span>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 focus:outline-none"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === "ALL" ? "All Categories" : c}
              </option>
            ))}
          </select>

          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-800"
            />
            Auto-scroll
          </label>

          <button
            onClick={handleClear}
            title="Clear logs"
            className="text-zinc-400 transition hover:text-zinc-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={bodyRef}
        className="flex-1 space-y-1 overflow-y-auto p-4 font-mono text-[12px] leading-relaxed text-zinc-300"
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
    </div>
  );
}

