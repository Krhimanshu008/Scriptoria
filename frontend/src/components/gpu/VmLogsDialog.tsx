"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Terminal, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface LogRow {
  id?: string;
  category: string;
  level: string;
  message: string;
  createdAt?: string;
}

export function VmLogsDialog({
  target,
  open,
  onOpenChange,
}: {
  target: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isFetching, refetch } = useQuery<{
    target: string;
    containerLogs: LogRow[];
    dbLogs: LogRow[];
  }>({
    queryKey: ["vm-logs", target],
    enabled: Boolean(open && target),
    queryFn: async () => {
      const res = await fetch(`/api/vm/${encodeURIComponent(target!)}/logs`);
      if (!res.ok) throw new Error("Failed to load VM logs");
      return res.json();
    },
    refetchInterval: open ? 4000 : false,
  });

  const rows =
    (data?.containerLogs?.length ? data.containerLogs : data?.dbLogs) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="flex items-center gap-2 font-mono text-sm">
              <Terminal className="h-4 w-4 text-emerald-400" />
              {target ? `${target.toUpperCase()} Live Container & Sidecar Logs` : "VM Logs"}
            </DialogTitle>
            <button
              type="button"
              onClick={() => refetch()}
              className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </DialogHeader>

        <div className="max-h-[420px] overflow-y-auto rounded-xl border border-zinc-800 bg-black/70 p-3 font-mono text-[11px] space-y-1">
          {isFetching && rows.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-zinc-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Fetching sidecar logs...
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-zinc-500">
              No logs recorded for this slot yet.
            </div>
          ) : (
            rows.map((entry, idx) => (
              <div key={entry.id || idx} className="flex gap-2 leading-relaxed">
                <span className="shrink-0 text-zinc-500">[{entry.category}]</span>
                <span
                  className={
                    entry.level === "ERROR"
                      ? "text-rose-400"
                      : entry.level === "SUCCESS"
                      ? "text-emerald-400"
                      : entry.level === "WARN"
                      ? "text-amber-300"
                      : "text-zinc-200"
                  }
                >
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

