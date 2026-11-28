"use client";

import React, { useState } from "react";
import {
  Play,
  Loader2,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  Zap,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { LlmChatMode } from "@/lib/llm/dispatch-llm";
import {
  STARTER_BATCH_SUITES,
  type LlmTargetOption,
  parseTargetOption,
} from "./types";

interface EvalCaseRow {
  prompt: string;
  expectedContains?: string;
  requiredKeys?: string[];
}

interface BatchEvalResponse {
  ok: boolean;
  title: string;
  totalCases: number;
  passedCount: number;
  failedCount: number;
  passRatePct: number;
  avgLatencyMs: number;
  avgTokPerSec: number | null;
  dualReplicaParallelized: boolean;
  results: Array<{
    index: number;
    prompt: string;
    answer: string;
    passed: boolean;
    failureReasons: string[];
    latencyMs: number;
    tokPerSec: number | null;
    target: string | null;
    model: string;
    error?: string;
  }>;
}

function parseDatasetInput(raw: string): EvalCaseRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: EvalCaseRow[] = [];

  for (const line of lines) {
    if (line.startsWith("{")) {
      try {
        const obj = JSON.parse(line) as {
          prompt?: string;
          input?: string;
          expectedContains?: string;
          requiredKeys?: string[];
        };
        const p = String(obj.prompt || obj.input || "").trim();
        if (p) {
          rows.push({
            prompt: p,
            expectedContains: obj.expectedContains,
            requiredKeys: Array.isArray(obj.requiredKeys) ? obj.requiredKeys : undefined,
          });
          continue;
        }
      } catch {
        // fallback to plain prompt line
      }
    }
    // Support simple CSV/pipe format: prompt | expectedContains | key1,key2
    if (line.includes("|")) {
      const [p, expected, keys] = line.split("|").map((s) => s.trim());
      if (p && p.toLowerCase() !== "prompt") {
        rows.push({
          prompt: p,
          expectedContains: expected || undefined,
          requiredKeys: keys
            ? keys
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean)
            : undefined,
        });
        continue;
      }
    }
    rows.push({ prompt: line });
  }
  return rows;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "").replace(/"/g, '""');
  return `"${s}"`;
}

export function BatchEvalPanel({
  targetOptions,
  isDualReplicaActive,
}: {
  targetOptions: LlmTargetOption[];
  isDualReplicaActive: boolean;
}) {
  const [title, setTitle] = useState("LLM Dataset Benchmark");
  const [selectedTarget, setSelectedTarget] = useState("auto::default");
  const [mode, setMode] = useState<LlmChatMode>(STARTER_BATCH_SUITES[0].mode);
  const [systemPrompt, setSystemPrompt] = useState(STARTER_BATCH_SUITES[0].systemPrompt);
  const [jsonSchema, setJsonSchema] = useState(STARTER_BATCH_SUITES[0].jsonSchema);
  const [datasetText, setDatasetText] = useState(STARTER_BATCH_SUITES[0].casesText);
  const [fallbackToVault, setFallbackToVault] = useState(true);

  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState<string>("");
  const [evalRes, setEvalRes] = useState<BatchEvalResponse | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "passed" | "failed">("all");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setDatasetText(text);
      toast.success(`Loaded dataset ${file.name}`);
    } catch {
      toast.error("Failed to read file");
    } finally {
      e.target.value = "";
    }
  }

  async function handleRunEval() {
    const cases = parseDatasetInput(datasetText);
    if (cases.length === 0) {
      toast.error("Add at least 1 test case row.");
      return;
    }
    setRunning(true);
    setEvalRes(null);

    const { targetVm, targetService } = parseTargetOption(selectedTarget);
    const chunkSize = isDualReplicaActive ? 4 : 3;
    const accumulated: BatchEvalResponse["results"] = [];
    let dualReplicaParallelized = false;

    try {
      for (let offset = 0; offset < cases.length; offset += chunkSize) {
        const slice = cases.slice(offset, offset + chunkSize);
        setProgressText(`Evaluating ${Math.min(offset + slice.length, cases.length)}/${cases.length}...`);
        const res = await fetch("/api/v1/llm-eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "run_batch_eval",
            title,
            targetVm,
            targetService,
            mode,
            systemPrompt,
            jsonSchema: jsonSchema.trim() || undefined,
            reasoningEffort: "none",
            temperature: 0.15,
            maxTokens: 1024,
            fallbackToVault,
            cases: slice,
          }),
        });
        const json = (await res.json()) as BatchEvalResponse & { error?: string };
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

        dualReplicaParallelized = dualReplicaParallelized || json.dualReplicaParallelized;
        for (const r of json.results) {
          accumulated.push({ ...r, index: offset + r.index });
        }

        const passedCount = accumulated.filter((r) => r.passed).length;
        const validLatencies = accumulated.filter((r) => r.latencyMs > 0).map((r) => r.latencyMs);
        const validTps = accumulated
          .filter((r) => typeof r.tokPerSec === "number")
          .map((r) => r.tokPerSec as number);

        setEvalRes({
          ok: true,
          title,
          totalCases: accumulated.length,
          passedCount,
          failedCount: accumulated.length - passedCount,
          passRatePct: Math.round((passedCount / accumulated.length) * 100),
          avgLatencyMs: validLatencies.length
            ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)
            : 0,
          avgTokPerSec: validTps.length
            ? Number((validTps.reduce((a, b) => a + b, 0) / validTps.length).toFixed(1))
            : null,
          dualReplicaParallelized,
          results: [...accumulated],
        });
      }

      const finalPassed = accumulated.filter((r) => r.passed).length;
      const finalPct = Math.round((finalPassed / accumulated.length) * 100);
      toast.success(`Batch complete: ${finalPassed}/${accumulated.length} passed (${finalPct}%)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Batch evaluation failed");
    } finally {
      setRunning(false);
      setProgressText("");
    }
  }

  function downloadExport(fmt: "csv" | "json") {
    if (!evalRes) return;
    let content = "";
    let mime = "application/json";
    if (fmt === "json") {
      content = JSON.stringify(evalRes, null, 2);
    } else {
      mime = "text/csv";
      const header = "index,passed,latencyMs,tokPerSec,target,model,failureReasons,prompt,answer";
      const lines = evalRes.results.map((r) =>
        [
          r.index + 1,
          r.passed,
          r.latencyMs,
          r.tokPerSec ?? "",
          csvCell(r.target),
          csvCell(r.model),
          csvCell(r.failureReasons.join("; ")),
          csvCell(r.prompt),
          csvCell(r.answer),
        ].join(",")
      );
      content = [header, ...lines].join("\n");
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `llm-eval-${Date.now()}.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredResults = (evalRes?.results || []).filter((r) => {
    if (filterStatus === "passed") return r.passed;
    if (filterStatus === "failed") return !r.passed;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">Starter Suites:</span>
            {STARTER_BATCH_SUITES.map((s) => (
              <Button
                key={s.id}
                size="xs"
                variant="outline"
                onClick={() => {
                  setTitle(s.label);
                  setMode(s.mode);
                  setSystemPrompt(s.systemPrompt);
                  setJsonSchema(s.jsonSchema);
                  setDatasetText(s.casesText);
                }}
              >
                {s.label}
              </Button>
            ))}
            <Button
              size="xs"
              variant="outline"
              onClick={async () => {
                try {
                  const res = await fetch("/api/test-kits/ch214");
                  if (!res.ok) throw new Error("Failed to load Ch. 214 test kit");
                  const kit = (await res.json()) as {
                    llmEvalCases: Array<{
                      prompt: string;
                      expectedContains?: string;
                      requiredKeys?: string[];
                    }>;
                  };
                  setTitle("LOTM Ch. 214 · 8-Beat Continuity Extraction");
                  setMode("json");
                  setSystemPrompt(
                    "Extract exact canon facts from this Lord of the Mysteries Chapter 214 beat into strict JSON. Preserve clothing, props, timestamps, written addresses, weather, and eye details accurately."
                  );
                  setJsonSchema(
                    JSON.stringify(
                      {
                        required: [
                          "beat_name",
                          "location",
                          "present_subjects",
                          "key_props_and_facts",
                        ],
                      },
                      null,
                      2
                    )
                  );
                  setDatasetText(kit.llmEvalCases.map((c) => JSON.stringify(c)).join("\n"));
                  toast.success(`Loaded LOTM Ch. 214 (${kit.llmEvalCases.length} beat cases)`);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed to load kit");
                }
              }}
            >
              LOTM Ch. 214 (8 Beats)
            </Button>
          </div>
          {isDualReplicaActive && (
            <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/40">
              <Zap className="mr-1 size-3" /> Dual-T4 2x Parallel Lanes Active
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="mb-1 block text-[11px] text-zinc-400">Target LLM Worker / Vault</label>
            <select
              value={selectedTarget}
              onChange={(e) => setSelectedTarget(e.target.value)}
              className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100"
            >
              {targetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  [{o.badge}] {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-zinc-400">Assertion Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as LlmChatMode)}
              className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100"
            >
              <option value="json">Strict JSON + Assertions</option>
              <option value="chat">Text + Keyword Assertions</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-1.5 text-xs text-zinc-400 pb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={fallbackToVault}
                onChange={(e) => setFallbackToVault(e.target.checked)}
              />
              Vault Fallback
            </label>
            <label className="ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-200 hover:bg-zinc-800">
              <Upload className="size-3.5" /> Import File
              <input type="file" accept=".jsonl,.txt,.csv,.json" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] text-zinc-400">
              Dataset Rows (JSONL `{"{prompt, expectedContains?, requiredKeys?}"}` or `prompt | keyword | keys`)
            </label>
            <textarea
              rows={7}
              value={datasetText}
              onChange={(e) => setDatasetText(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-violet-500"
            />
          </div>
          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">Shared System Prompt</label>
              <textarea
                rows={3}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">JSON Schema Required Keys</label>
              <textarea
                rows={2}
                value={jsonSchema}
                onChange={(e) => setJsonSchema(e.target.value)}
                placeholder='{"required": ["status"]}'
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-100"
              />
            </div>
            <Button onClick={handleRunEval} disabled={running} className="w-full">
              {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {running ? (progressText || "Evaluating Dataset (max 50 rows)...") : "Run Batch Eval"}
            </Button>
          </div>
        </div>
      </div>

      {evalRes && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
              <div className="text-[11px] text-zinc-400">Pass Rate</div>
              <div className="mt-1 text-xl font-bold text-emerald-400">{evalRes.passRatePct}%</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
              <div className="text-[11px] text-zinc-400">Passed / Total</div>
              <div className="mt-1 text-xl font-bold text-zinc-100">
                {evalRes.passedCount} / {evalRes.totalCases}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
              <div className="text-[11px] text-zinc-400">Avg Latency</div>
              <div className="mt-1 text-xl font-bold text-cyan-300">{evalRes.avgLatencyMs}ms</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
              <div className="text-[11px] text-zinc-400">Avg Throughput</div>
              <div className="mt-1 text-xl font-bold text-violet-300">
                {evalRes.avgTokPerSec ? `${evalRes.avgTokPerSec} tok/s` : "—"}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs">
                <Filter className="size-3.5 text-zinc-400" />
                {(["all", "passed", "failed"] as const).map((f) => (
                  <Button
                    key={f}
                    size="xs"
                    variant={filterStatus === f ? "default" : "outline"}
                    onClick={() => setFilterStatus(f)}
                  >
                    {f.toUpperCase()}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button size="xs" variant="outline" onClick={() => downloadExport("csv")}>
                  <Download className="size-3" /> Export CSV
                </Button>
                <Button size="xs" variant="outline" onClick={() => downloadExport("json")}>
                  <Download className="size-3" /> Export JSON
                </Button>
              </div>
            </div>

            <div className="divide-y divide-zinc-800/80 max-h-[420px] overflow-y-auto">
              {filteredResults.map((row) => (
                <div key={row.index} className="py-2.5 space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRow((cur) => (cur === row.index ? null : row.index))
                      }
                      className="flex items-center gap-2 text-left font-medium text-zinc-200 hover:text-white"
                    >
                      {row.passed ? (
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                      ) : (
                        <XCircle className="size-4 shrink-0 text-red-400" />
                      )}
                      <span className="truncate max-w-xl">
                        #{row.index + 1}: {row.prompt}
                      </span>
                    </button>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                      <Badge variant="outline" className="text-[10px]">
                        {row.target || row.model}
                      </Badge>
                      <span>{row.latencyMs}ms</span>
                      {row.tokPerSec && <span className="text-emerald-400">{row.tokPerSec} t/s</span>}
                    </div>
                  </div>
                  {row.failureReasons.length > 0 && (
                    <div className="pl-6 text-[11px] text-red-400">
                      {row.failureReasons.join(" · ")}
                    </div>
                  )}
                  {expandedRow === row.index && (
                    <pre className="ml-6 rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 whitespace-pre-wrap font-mono text-[11px] text-zinc-200">
                      {row.error || row.answer}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
