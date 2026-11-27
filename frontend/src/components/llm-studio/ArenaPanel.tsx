"use client";

import React, { useState } from "react";
import {
  GitCompare,
  Loader2,
  Scale,
  Clock,
  Gauge,
  CheckCircle2,
  XCircle,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DispatchLlmResult, LlmChatMode } from "@/lib/llm/dispatch-llm";
import { type LlmTargetOption, parseTargetOption } from "./types";

interface ArenaSlotResult {
  label: string;
  data?: DispatchLlmResult;
  error?: string;
}

interface JudgeVerdict {
  winner: string;
  score_a: number;
  score_b: number;
  rationale: string;
}

export function ArenaPanel({ targetOptions }: { targetOptions: LlmTargetOption[] }) {
  const defaultB = targetOptions[1]?.value || targetOptions[0]?.value || "auto::default";
  const defaultA = targetOptions[0]?.value || "auto::default";

  const [slotATarget, setSlotATarget] = useState<string>(defaultA);
  const [slotBTarget, setSlotBTarget] = useState<string>(defaultB);
  const [slotAModelOverride, setSlotAModelOverride] = useState<string>("");
  const [slotBModelOverride, setSlotBModelOverride] = useState<string>("");
  const [mode, setMode] = useState<LlmChatMode>("chat");
  const [systemPrompt, setSystemPrompt] = useState<string>(
    "You are a concise, high-accuracy technical assistant."
  );
  const [jsonSchema, setJsonSchema] = useState<string>("");
  const [prompt, setPrompt] = useState<string>(
    "Design an idempotent retry queue in PostgreSQL using SELECT FOR UPDATE SKIP LOCKED. Include deadlock pitfalls and index design."
  );

  const [running, setRunning] = useState(false);
  const [judging, setJudging] = useState(false);
  const [resultA, setResultA] = useState<ArenaSlotResult | null>(null);
  const [resultB, setResultB] = useState<ArenaSlotResult | null>(null);
  const [verdict, setVerdict] = useState<JudgeVerdict | null>(null);

  async function runComparison() {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setVerdict(null);

    const runSlot = async (combined: string, modelOverride: string): Promise<ArenaSlotResult> => {
      const { targetVm, targetService } = parseTargetOption(combined);
      const optLabel = targetOptions.find((o) => o.value === combined)?.label || combined;
      try {
        const res = await fetch("/api/llm-studio/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: prompt }],
            systemPrompt,
            mode,
            jsonSchema: jsonSchema.trim() || undefined,
            reasoningEffort: "low",
            temperature: 0.25,
            maxTokens: 2048,
            fallbackToVault: true,
            targetVm,
            targetService,
            modelOverride: modelOverride.trim() || undefined,
          }),
        });
        const json = (await res.json()) as DispatchLlmResult & { error?: string };
        if (!res.ok) return { label: optLabel, error: json.error || `HTTP ${res.status}` };
        return { label: optLabel, data: json };
      } catch (err) {
        return { label: optLabel, error: err instanceof Error ? err.message : "Failed" };
      }
    };

    const [a, b] = await Promise.all([
      runSlot(slotATarget, slotAModelOverride),
      runSlot(slotBTarget, slotBModelOverride),
    ]);
    setResultA(a);
    setResultB(b);
    setRunning(false);
  }

  async function runAutoJudge() {
    if (!resultA?.data || !resultB?.data || judging) return;
    setJudging(true);
    try {
      const res = await fetch("/api/llm-studio/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `Original Prompt:\n${prompt}\n\n---\nCandidate A (${resultA.data.model}):\n${resultA.data.answer}\n\n---\nCandidate B (${resultB.data.model}):\n${resultB.data.answer}\n\nScore both from 1-10 on correctness, depth, and clarity, then return JSON.`,
            },
          ],
          systemPrompt:
            "You are an impartial rubric evaluator comparing Candidate A and Candidate B. Return strict JSON.",
          mode: "json",
          jsonSchema: JSON.stringify({
            required: ["winner", "score_a", "score_b", "rationale"],
          }),
          temperature: 0.1,
          maxTokens: 1024,
          fallbackToVault: true,
          targetVm: "auto",
          targetService: "qc",
        }),
      });
      const json = (await res.json()) as DispatchLlmResult & { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const cleaned = json.answer
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const parsed = JSON.parse(cleaned) as JudgeVerdict;
      setVerdict(parsed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auto-Judge failed");
    } finally {
      setJudging(false);
    }
  }

  const fasterSlot =
    resultA?.data && resultB?.data
      ? resultA.data.latencyMs <= resultB.data.latencyMs
        ? "A"
        : "B"
      : null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-violet-300">Candidate A Target</span>
              <Badge variant="outline" className="text-[10px]">Slot A</Badge>
            </div>
            <select
              value={slotATarget}
              onChange={(e) => setSlotATarget(e.target.value)}
              className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-100 outline-none focus:border-violet-500"
            >
              {targetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  [{o.badge}] {o.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={slotAModelOverride}
              onChange={(e) => setSlotAModelOverride(e.target.value)}
              placeholder="Optional model override (e.g. gemini-2.5-flash)"
              className="h-7 w-full rounded border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200 placeholder:text-zinc-600"
            />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-cyan-300">Candidate B Target</span>
              <Badge variant="outline" className="text-[10px]">Slot B</Badge>
            </div>
            <select
              value={slotBTarget}
              onChange={(e) => setSlotBTarget(e.target.value)}
              className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-100 outline-none focus:border-cyan-500"
            >
              {targetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  [{o.badge}] {o.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={slotBModelOverride}
              onChange={(e) => setSlotBModelOverride(e.target.value)}
              placeholder="Optional model override"
              className="h-7 w-full rounded border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200 placeholder:text-zinc-600"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="mb-1 block text-[11px] font-medium text-zinc-400">
              Shared Benchmark Prompt
            </label>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-xs text-zinc-100 outline-none focus:border-violet-500"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-zinc-400">Eval Mode & Controls</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as LlmChatMode)}
              className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100"
            >
              <option value="chat">Freeform Text</option>
              <option value="json">Strict JSON Schema</option>
            </select>
            {mode === "json" && (
              <input
                type="text"
                placeholder='{"required": ["items"]}'
                value={jsonSchema}
                onChange={(e) => setJsonSchema(e.target.value)}
                className="h-7 w-full rounded border border-zinc-800 bg-zinc-900 px-2 font-mono text-xs text-zinc-100"
              />
            )}
            <input
              type="text"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Shared system prompt"
              className="h-7 w-full rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200"
            />
            <div className="flex gap-2 pt-0.5">
              <Button onClick={runComparison} disabled={running} className="flex-1">
                {running ? <Loader2 className="size-3.5 animate-spin" /> : <GitCompare className="size-3.5" />}
                {running ? "Running A/B..." : "Run A/B Compare"}
              </Button>
              <Button
                variant="outline"
                onClick={runAutoJudge}
                disabled={judging || !resultA?.data || !resultB?.data}
              >
                {judging ? <Loader2 className="size-3.5 animate-spin" /> : <Scale className="size-3.5" />}
                Judge
              </Button>
            </div>
          </div>
        </div>
      </div>

      {verdict && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Trophy className="size-5 text-amber-400" />
            <div>
              <div className="text-xs font-semibold text-amber-200">
                Auto-Judge Winner: {String(verdict.winner).toUpperCase()} (A: {verdict.score_a}/10 · B: {verdict.score_b}/10)
              </div>
              <p className="text-xs text-amber-100/80 mt-0.5">{verdict.rationale}</p>
            </div>
          </div>
        </div>
      )}

      {(resultA || resultB) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[
            { key: "A" as const, res: resultA, accent: "border-violet-500/40" },
            { key: "B" as const, res: resultB, accent: "border-cyan-500/40" },
          ].map(({ key, res, accent }) => (
            <div
              key={key}
              className={`rounded-xl border bg-zinc-950/90 p-4 space-y-3 ${
                res?.data ? accent : "border-zinc-800"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Badge variant="default">Candidate {key}</Badge>
                  <span className="text-xs font-medium text-zinc-200">
                    {res?.data?.model || res?.label || "Idle"}
                  </span>
                  {fasterSlot === key && (
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
                      Faster
                    </Badge>
                  )}
                </div>

                {res?.data && (
                  <div className="flex items-center gap-2.5 text-[11px] text-zinc-400">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" /> {res.data.latencyMs}ms
                    </span>
                    {res.data.tokPerSec !== null && (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Gauge className="size-3" /> {res.data.tokPerSec} t/s
                      </span>
                    )}
                    {res.data.jsonValidation && (
                      res.data.jsonValidation.isValidJson ? (
                        <CheckCircle2 className="size-3.5 text-emerald-400" />
                      ) : (
                        <XCircle className="size-3.5 text-red-400" />
                      )
                    )}
                  </div>
                )}
              </div>

              {res?.error ? (
                <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300">
                  {res.error}
                </div>
              ) : (
                <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-zinc-100">
                  {res?.data?.answer || ""}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
