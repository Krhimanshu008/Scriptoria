"use client";

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Send,
  Sparkles,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Wrench,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

interface AgentToolTrace {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface ProposedAction {
  toolName: string;
  args: Record<string, unknown>;
  status: "PENDING_APPROVAL" | "EXECUTED" | "REJECTED";
  result?: unknown;
}

interface AgentMessageItem {
  id: string;
  role: string;
  content: string;
  toolCalls?: AgentToolTrace[] | null;
  proposedAction?: ProposedAction | null;
  createdAt: string;
}

const STARTER_PROMPTS = [
  "Inspect my online GPUs & cached checkpoints right now.",
  "Design a 16GB T4 anime portrait workflow using WAI-Illustrious + FaceDetailer.",
  "Plan a multi-GPU batch (visual + TTS audio) for a 2-scene fantasy battle.",
];

export function AgentCoDirectorPanel() {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState<"COPILOT" | "AUTONOMOUS">("COPILOT");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const { data, refetch } = useQuery<{
    sessions: Array<{ id: string; title: string; mode: string }>;
    activeSession: { id: string; title: string; mode: string } | null;
    messages: AgentMessageItem[];
  }>({
    queryKey: ["agent-chat", sessionId],
    queryFn: async () => {
      const url = sessionId
        ? `/api/agent/chat?sessionId=${encodeURIComponent(sessionId)}`
        : "/api/agent/chat";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load agent session");
      return res.json();
    },
  });

  const messages = data?.messages ?? [];
  const activeSessionId = sessionId || data?.activeSession?.id || null;

  async function handleSend(promptText?: string) {
    const text = (promptText ?? input).trim();
    if (!text || sending) return;
    if (!promptText) setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          message: text,
          mode,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Agent request failed");
        return;
      }
      if (body.sessionId) setSessionId(body.sessionId);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["batch-jobs"] });
    } catch {
      toast.error("Failed to reach Agentic Co-Director");
    } finally {
      setSending(false);
    }
  }

  async function handleDecision(messageId: string, decision: "approve" | "reject") {
    setApprovingId(messageId);
    try {
      const res = await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, decision }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to process approval");
        return;
      }
      toast.success(
        decision === "approve" ? "Executed approved plan!" : "Rejected proposed action"
      );
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["batch-jobs"] });
    } finally {
      setApprovingId(null);
    }
  }

  function handleNewSession() {
    setSessionId("__new__");
    setTimeout(() => {
      setSessionId(null);
      refetch();
    }, 10);
  }

  return (
    <div className="glass-panel flex h-full min-h-[640px] flex-col rounded-2xl p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 text-white shadow">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-white">Agentic AI Co-Director</div>
            <div className="text-[10px] text-zinc-400">Tool-Calling Cluster &amp; Catalog Brain</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode((m) => (m === "COPILOT" ? "AUTONOMOUS" : "COPILOT"))}
            title="Switch Co-Pilot (Approve) vs Autonomous"
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${
              mode === "AUTONOMOUS"
                ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
                : "border-emerald-400/35 bg-emerald-500/15 text-emerald-200"
            }`}
          >
            {mode === "AUTONOMOUS" ? (
              <Zap className="h-3 w-3" />
            ) : (
              <ShieldAlert className="h-3 w-3" />
            )}
            {mode === "AUTONOMOUS" ? "Autonomous" : "Co-Pilot"}
          </button>

          <button
            type="button"
            onClick={handleNewSession}
            title="New conversation"
            className="glass-pill rounded-lg p-1.5 text-zinc-300 hover:bg-white/10"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Messages Feed */}
      <div className="my-3 flex-1 space-y-3 overflow-y-auto pr-1 text-xs">
        {messages.length === 0 ? (
          <div className="space-y-3 pt-4">
            <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] text-zinc-300">
              <Sparkles className="mb-1 h-4 w-4 text-violet-400" />
              I can inspect your live GPUs, check cached `/tmp/models`, search your 5 TB Drive &amp; HF/Civitai catalog, enforce T4 VRAM limits, and schedule multi-GPU batch renders.
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Try asking:
              </div>
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleSend(p)}
                  className="block w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-[11px] text-zinc-300 transition hover:border-indigo-400/40 hover:bg-white/[0.07]"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`space-y-2 rounded-xl p-3 ${
                m.role === "user"
                  ? "ml-6 border border-indigo-400/30 bg-indigo-500/15 text-zinc-100"
                  : "mr-2 border border-white/10 bg-black/35 text-zinc-200"
              }`}
            >
              <div className="flex items-center justify-between text-[10px] text-zinc-400">
                <span className="font-semibold uppercase">
                  {m.role === "user" ? "You" : "Co-Director"}
                </span>
                <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
              </div>

              <div className="whitespace-pre-wrap leading-relaxed text-[11.5px]">
                {m.content}
              </div>

              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {m.toolCalls.map((tc, idx) => (
                    <span
                      key={`${tc.name}-${idx}`}
                      className="inline-flex items-center gap-1 rounded-md border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9.5px] text-cyan-200"
                    >
                      <Wrench className="h-2.5 w-2.5" />
                      {tc.name}
                    </span>
                  ))}
                </div>
              )}

              {m.proposedAction && (
                <div className="mt-2 space-y-2 rounded-xl border border-amber-400/30 bg-amber-500/[0.08] p-2.5">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-amber-200">
                    <span>Proposed Action: {m.proposedAction.toolName}</span>
                    <span className="uppercase">{m.proposedAction.status}</span>
                  </div>
                  <pre className="max-h-28 overflow-auto rounded bg-black/50 p-2 font-mono text-[10px] text-zinc-300">
                    {JSON.stringify(m.proposedAction.args, null, 2)}
                  </pre>

                  {m.proposedAction.status === "PENDING_APPROVAL" && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={approvingId === m.id}
                        onClick={() => handleDecision(m.id, "approve")}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
                      >
                        {approvingId === m.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        Approve &amp; Execute
                      </button>
                      <button
                        type="button"
                        disabled={approvingId === m.id}
                        onClick={() => handleDecision(m.id, "reject")}
                        className="flex items-center justify-center gap-1 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-white/10"
                      >
                        <XCircle className="h-3 w-3" />
                        Reject
                      </button>
                    </div>
                  )}

                  {m.proposedAction.result !== undefined && (
                    <pre className="max-h-24 overflow-auto rounded bg-emerald-950/40 p-2 font-mono text-[10px] text-emerald-200">
                      {JSON.stringify(m.proposedAction.result, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Input Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex items-center gap-2 border-t border-white/10 pt-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          placeholder="Ask AI Co-Director to plan, optimize, or launch workflows..."
          className="glass-input flex-1 rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-500"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}

