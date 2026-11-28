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
  Sliders,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DispatchLlmResult, LlmChatMode } from "@/lib/llm/dispatch-llm";
import { type LlmTargetOption, parseTargetOption } from "./types";
import { useLlmTelemetry } from "./LlmTelemetryContext";
import { InferenceReceiptBar, receiptFromDispatchResult } from "./InferenceReceiptBar";

interface ArenaSlotConfig {
  target: string;
  enableThinking: boolean;
  temperature: number;
  mode: LlmChatMode;
  modelOverride: string;
}

interface ArenaSlotResult {
  label: string;
  configSummary: string;
  data?: DispatchLlmResult;
  error?: string;
}

interface JudgeVerdict {
  winner: string;
  score_a: number;
  score_b: number;
  rationale: string;
}

export function ArenaPanel({
  targetOptions,
  globalThinkingEnabled,
  vaultProviders = [],
}: {
  targetOptions: LlmTargetOption[];
  globalThinkingEnabled: boolean;
  vaultProviders?: Array<{ provider: string; model: string; label: string }>;
}) {
  const { beginRequest, endRequest } = useLlmTelemetry();
  const defaultLocal = targetOptions[0]?.value || "auto::default";
  const firstVault = vaultProviders[0] ? `vault:${vaultProviders[0].provider}::default` : defaultLocal;

  const [slotA, setSlotA] = useState<ArenaSlotConfig>({
    target: defaultLocal,
    enableThinking: false,
    temperature: 0.25,
    mode: "chat",
    modelOverride: "",
  });
  const [slotB, setSlotB] = useState<ArenaSlotConfig>({
    target: defaultLocal,
    enableThinking: true,
    temperature: 0.25,
    mode: "chat",
    modelOverride: "",
  });

  const [cachePrompt, setCachePrompt] = useState<boolean>(false);
  const [systemPrompt, setSystemPrompt] = useState<string>(
    "You are a concise, high-accuracy technical assistant."
  );
  const [jsonSchema, setJsonSchema] = useState<string>("");
  const [prompt, setPrompt] = useState<string>(
    "Design an idempotent retry queue in PostgreSQL using SELECT FOR UPDATE SKIP LOCKED. Include deadlock pitfalls and index design."
  );

  const [running, setRunning] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState<string>("");
  const [judging, setJudging] = useState(false);
  const [resultA, setResultA] = useState<ArenaSlotResult | null>(null);
  const [resultB, setResultB] = useState<ArenaSlotResult | null>(null);
  const [verdict, setVerdict] = useState<JudgeVerdict | null>(null);

  function applyTuningPreset(preset: "think" | "temp" | "json" | "hybrid") {
    if (preset === "think") {
      setSlotA({ target: defaultLocal, enableThinking: false, temperature: 0.25, mode: "chat", modelOverride: "" });
      setSlotB({ target: defaultLocal, enableThinking: true, temperature: 0.25, mode: "chat", modelOverride: "" });
      toast.success("Preset: Thinking OFF vs ON on Qwen3.8-27B");
    } else if (preset === "temp") {
      setSlotA({ target: defaultLocal, enableThinking: globalThinkingEnabled, temperature: 0.1, mode: "chat", modelOverride: "" });
      setSlotB({ target: defaultLocal, enableThinking: globalThinkingEnabled, temperature: 0.6, mode: "chat", modelOverride: "" });
      toast.success("Preset: Temp 0.1 (Deterministic) vs Temp 0.6 (Creative)");
    } else if (preset === "json") {
      setSlotA({ target: defaultLocal, enableThinking: false, temperature: 0.1, mode: "json", modelOverride: "" });
      setSlotB({ target: defaultLocal, enableThinking: false, temperature: 0.25, mode: "chat", modelOverride: "" });
      if (!jsonSchema.trim()) {
        setJsonSchema(JSON.stringify({ required: ["design", "pitfalls", "indexes"] }, null, 2));
      }
      toast.success("Preset: Strict JSON GBNF vs Freeform Text");
    } else {
      setSlotA({ target: defaultLocal, enableThinking: globalThinkingEnabled, temperature: 0.25, mode: "chat", modelOverride: "" });
      setSlotB({ target: firstVault, enableThinking: globalThinkingEnabled, temperature: 0.25, mode: "chat", modelOverride: "" });
      toast.success("Preset: Local 2× T4 vs Vault Cloud");
    }
  }

  async function runComparison() {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setVerdict(null);

    const runSlot = async (labelTag: string, cfg: ArenaSlotConfig): Promise<ArenaSlotResult> => {
      const { targetVm, targetService } = parseTargetOption(cfg.target);
      const optLabel = targetOptions.find((o) => o.value === cfg.target)?.label || cfg.target;
      const summary = `${cfg.enableThinking ? "Think ON" : "Think OFF"} · T=${cfg.temperature} · ${cfg.mode.toUpperCase()}`;
      const reqId = beginRequest({
        label: `Arena ${labelTag}`,
        isJsonMode: cfg.mode === "json",
      });
      try {
        const res = await fetch("/api/llm-studio/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: prompt }],
            systemPrompt,
            mode: cfg.mode,
            jsonSchema: cfg.mode === "json" ? jsonSchema.trim() || undefined : undefined,
            reasoningEffort: cfg.enableThinking ? "high" : "none",
            enableThinking: cfg.enableThinking,
            cachePrompt,
            temperature: cfg.temperature,
            maxTokens: 2048,
            fallbackToVault: true,
            targetVm,
            targetService,
            modelOverride: cfg.modelOverride.trim() || undefined,
          }),
        });
        const json = (await res.json()) as DispatchLlmResult & { error?: string };
        if (!res.ok) {
          endRequest(reqId, null);
          return { label: optLabel, configSummary: summary, error: json.error || `HTTP ${res.status}` };
        }
        endRequest(reqId, json);
        return { label: optLabel, configSummary: summary, data: json };
      } catch (err) {
        endRequest(reqId, null);
        return {
          label: optLabel,
          configSummary: summary,
          error: err instanceof Error ? err.message : "Failed",
        };
      }
    };

    const aIsVault = slotA.target.startsWith("vault:");
    const bIsVault = slotB.target.startsWith("vault:");
    const sameLocalParallel1 = !aIsVault && !bIsVault;

    if (sameLocalParallel1) {
      setPhaseLabel("Running Config A (1/2) on --parallel 1...");
      const a = await runSlot("A", slotA);
      setResultA(a);
      setPhaseLabel("Running Config B (2/2) sequentially...");
      const b = await runSlot("B", slotB);
      setResultB(b);
    } else {
      setPhaseLabel("Running Config A + B across independent backends...");
      const [a, b] = await Promise.all([runSlot("A", slotA), runSlot("B", slotB)]);
      setResultA(a);
      setResultB(b);
    }

    setPhaseLabel("");
    setRunning(false);
  }

  async function runAutoJudge() {
    if (!resultA?.data || !resultB?.data || judging) return;
    setJudging(true);
    const reqId = beginRequest({ label: "Auto-Judge", isJsonMode: true });
    try {
      const res = await fetch("/api/llm-studio/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `Original Prompt:\n${prompt}\n\n---\nCandidate A (${resultA.configSummary}):\n${resultA.data.answer}\n\n---\nCandidate B (${resultB.configSummary}):\n${resultB.data.answer}\n\nScore both from 1-10 on correctness, depth, and clarity, then return JSON.`,
            },
          ],
          systemPrompt:
            "You are an impartial rubric evaluator comparing Candidate A and Candidate B. Return strict JSON.",
          mode: "json",
          jsonSchema: JSON.stringify({
            required: ["winner", "score_a", "score_b", "rationale"],
          }),
          enableThinking: false,
          temperature: 0.1,
          maxTokens: 1024,
          fallbackToVault: true,
          targetVm: "auto",
          targetService: "default",
        }),
      });
      const json = (await res.json()) as DispatchLlmResult & { error?: string };
      if (!res.ok) {
        endRequest(reqId, null);
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      endRequest(reqId, json);
      const cleaned = json.answer
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const parsed = JSON.parse(cleaned) as JudgeVerdict;
      setVerdict(parsed);
    } catch (err) {
      endRequest(reqId, null);
      toast.error(err instanceof Error ? err.message : "Auto-Judge failed");
    } finally {
      setJudging(false);
    }
  }

  const aSpeed = resultA?.data ? resultA.data.rawDecodeTokPerSec ?? resultA.data.tokPerSec : null;
  const bSpeed = resultB?.data ? resultB.data.rawDecodeTokPerSec ?? resultB.data.tokPerSec : null;
  const fasterDecode =
    aSpeed !== null && bSpeed !== null && aSpeed !== bSpeed ? (aSpeed > bSpeed ? "A" : "B") : null;
  const higherMtp =
    resultA?.data?.mtpStats?.acceptancePct != null && resultB?.data?.mtpStats?.acceptancePct != null
      ? resultA.data.mtpStats.acceptancePct >= resultB.data.mtpStats.acceptancePct
        ? "A"
        : "B"
      : null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
        {/* Tuning Presets + Cache Fairness Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-300 mr-1">
              <Sliders className="size-3.5 text-violet-400" />
              Qwen3.8-27B Config Bench:
            </span>
            <Button size="xs" variant="outline" onClick={() => applyTuningPreset("think")}>
              Thinking OFF vs ON
            </Button>
            <Button size="xs" variant="outline" onClick={() => applyTuningPreset("temp")}>
              Temp 0.1 vs 0.6
            </Button>
            <Button size="xs" variant="outline" onClick={() => applyTuningPreset("json")}>
              JSON GBNF vs Freeform
            </Button>
            {vaultProviders.length > 0 && (
              <Button size="xs" variant="outline" onClick={() => applyTuningPreset("hybrid")}>
                Local 2× T4 vs Vault
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-zinc-400">KV Cache:</span>
            <button
              type="button"
              onClick={() => setCachePrompt((c) => !c)}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                cachePrompt
                  ? "border-cyan-500/40 bg-cyan-950/30 text-cyan-200"
                  : "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
              }`}
              title="Cold Prefill (cache_prompt=false) guarantees fair timing comparison between Config A & Config B"
            >
              {cachePrompt ? "Warm Cache (cache=true)" : "Cold Prefill (Fair A/B · cache=false)"}
            </button>
          </div>
        </div>

        {/* Config A & Config B Cards */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[
            { tag: "A", cfg: slotA, setCfg: setSlotA, badgeClass: "text-violet-300", borderFocus: "focus:border-violet-500" },
            { tag: "B", cfg: slotB, setCfg: setSlotB, badgeClass: "text-cyan-300", borderFocus: "focus:border-cyan-500" },
          ].map(({ tag, cfg, setCfg, badgeClass, borderFocus }) => (
            <div key={tag} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold ${badgeClass}`}>Config {tag}</span>
                <Badge variant="outline" className="text-[10px]">Slot {tag}</Badge>
              </div>
              <select
                value={cfg.target}
                onChange={(e) => setCfg((prev) => ({ ...prev, target: e.target.value }))}
                className={`h-8 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-100 outline-none ${borderFocus}`}
              >
                {targetOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    [{o.badge}] {o.label}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-3 gap-1.5 text-xs">
                <select
                  value={cfg.enableThinking ? "on" : "off"}
                  onChange={(e) => setCfg((prev) => ({ ...prev, enableThinking: e.target.value === "on" }))}
                  className="h-7 rounded border border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-200"
                >
                  <option value="off">Think OFF</option>
                  <option value="on">Think ON</option>
                </select>
                <select
                  value={cfg.mode}
                  onChange={(e) => setCfg((prev) => ({ ...prev, mode: e.target.value as LlmChatMode }))}
                  className="h-7 rounded border border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-200"
                >
                  <option value="chat">Text</option>
                  <option value="json">JSON GBNF</option>
                </select>
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={2}
                  value={cfg.temperature}
                  onChange={(e) => setCfg((prev) => ({ ...prev, temperature: Number(e.target.value) }))}
                  className="h-7 rounded border border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-200"
                  title="Sampling temperature"
                />
              </div>
            </div>
          ))}
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
            <label className="block text-[11px] font-medium text-zinc-400">
              Shared Prompt &amp; Run Controls
            </label>
            <input
              type="text"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Shared system prompt"
              className="h-7 w-full rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200"
            />
            {(slotA.mode === "json" || slotB.mode === "json") && (
              <input
                type="text"
                placeholder='{"required": ["design", "pitfalls"]}'
                value={jsonSchema}
                onChange={(e) => setJsonSchema(e.target.value)}
                className="h-7 w-full rounded border border-zinc-800 bg-zinc-900 px-2 font-mono text-xs text-zinc-100"
              />
            )}
            <div className="flex gap-2 pt-0.5">
              <Button onClick={runComparison} disabled={running} className="flex-1">
                {running ? <Loader2 className="size-3.5 animate-spin" /> : <GitCompare className="size-3.5" />}
                {running ? "Running..." : "Run A/B Compare"}
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
            {phaseLabel && (
              <div className="font-mono text-[10px] text-cyan-300">{phaseLabel}</div>
            )}
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
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">Config {key}</Badge>
                  <span className="font-mono text-[11px] text-zinc-300">
                    {res?.configSummary || "Idle"}
                  </span>
                  {fasterDecode === key && (
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
                      Faster Decode
                    </Badge>
                  )}
                  {higherMtp === key && resultA?.data?.mtpStats && resultB?.data?.mtpStats && (
                    <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/40">
                      Higher MTP
                    </Badge>
                  )}
                </div>

                {res?.data && (
                  <div className="flex items-center gap-2.5 text-[11px] text-zinc-400 font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" /> {(res.data.latencyMs / 1000).toFixed(2)}s
                    </span>
                    {(res.data.rawDecodeTokPerSec ?? res.data.tokPerSec) !== null && (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Gauge className="size-3" /> {res.data.rawDecodeTokPerSec ?? res.data.tokPerSec} t/s
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
                <>
                  <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-zinc-100">
                    {res?.data?.answer || ""}
                  </pre>
                  {res?.data && <InferenceReceiptBar receipt={receiptFromDispatchResult(res.data)} />}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
