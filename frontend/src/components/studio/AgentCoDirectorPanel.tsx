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
  "Inspect my online GPUs, VRAM & cached checkpoints right now.",
  "Dispatch prompt across all online GPUs simultaneously in parallel.",
  "Search catalog and cache WAI-Illustrious or Flux GGUF on GPU0.",
  "Design a 16GB T4 workflow using SDXL + FaceDetailer upscale.",
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
    <div className="flex h-[620px] flex-col rounded-lg border border-zinc-800 bg-[#111114] p-3.5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-indigo-400" />
          <div>
            <div className="text-xs font-semibold text-white">AI Co-Director</div>
            <div className="text-[10px] text-zinc-500">Tool-Calling Orchestrator</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode((m) => (m === "COPILOT" ? "AUTONOMOUS" : "COPILOT"))}
            title="Switch Co-Pilot (Approve) vs Autonomous"
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium transition ${
              mode === "AUTONOMOUS"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {mode === "AUTONOMOUS" ? (
              <Zap className="h-3 w-3" />
            ) : (
              <ShieldAlert className="h-3 w-3" />
            )}
            {mode === "AUTONOMOUS" ? "Auto" : "Co-Pilot"}
          </button>

          <button
            type="button"
            onClick={handleNewSession}
            title="New conversation"
            className="rounded border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Messages Feed */}
      <div className="my-2.5 flex-1 space-y-2.5 overflow-y-auto pr-1 text-xs">
        {messages.length === 0 ? (
          <div className="space-y-2.5 pt-2">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-2.5 text-[11px] text-zinc-400">
              <Sparkles className="mb-1 h-3.5 w-3.5 text-indigo-400" />
              Inspect live GPUs, check cached `/tmp/models`, design T4 workflows, or launch multi-GPU batches.
            </div>
            <div className="space-y-1.5">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleSend(p)}
                  className="block w-full rounded-md border border-zinc-800 bg-zinc-950/50 px-2.5 py-2 text-left text-[11px] text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900"
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
              className={`space-y-1.5 rounded-md border p-2.5 ${
                m.role === "user"
                  ? "ml-4 border-indigo-500/30 bg-indigo-500/10 text-zinc-100"
                  : "mr-1 border-zinc-800 bg-zinc-950/80 text-zinc-200"
              }`}
            >
              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span className="font-semibold uppercase">
                  {m.role === "user" ? "You" : "Director"}
                </span>
                <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
              </div>

              <div className="whitespace-pre-wrap text-[11.5px] leading-relaxed">
                {m.content}
              </div>

              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {m.toolCalls.map((tc, idx) => (
                    <span
                      key={`${tc.name}-${idx}`}
                      className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9.5px] text-zinc-300"
                    >
                      <Wrench className="h-2.5 w-2.5 text-zinc-500" />
                      {tc.name}
                    </span>
                  ))}
                </div>
              )}

              {m.proposedAction && (
                <div className="mt-1.5 space-y-2 rounded-md border border-amber-500/35 bg-amber-500/10 p-2">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-amber-200">
                    <span>{m.proposedAction.toolName}</span>
                    <span className="uppercase">{m.proposedAction.status}</span>
                  </div>
                  <pre className="max-h-24 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-1.5 font-mono text-[10px] text-zinc-300">
                    {JSON.stringify(m.proposedAction.args, null, 2)}
                  </pre>

                  {m.proposedAction.status === "PENDING_APPROVAL" && (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={approvingId === m.id}
                        onClick={() => handleDecision(m.id, "approve")}
                        className="flex flex-1 items-center justify-center gap-1 rounded bg-emerald-600 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                      >
                        {approvingId === m.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={approvingId === m.id}
                        onClick={() => handleDecision(m.id, "reject")}
                        className="flex items-center justify-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                      >
                        <XCircle className="h-3 w-3" />
                        Reject
                      </button>
                    </div>
                  )}

                  {m.proposedAction.result !== undefined && (
                    <pre className="max-h-20 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-1.5 font-mono text-[10px] text-emerald-300">
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
        className="flex items-center gap-1.5 border-t border-zinc-800 pt-2.5"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          placeholder="Ask AI Co-Director..."
          className="h-8 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-white placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </form>
    </div>
  );
}

