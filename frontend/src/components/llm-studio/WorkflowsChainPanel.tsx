"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Workflow,
  Play,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  Loader2,
  CheckCircle2,
  Clock,
  Gauge,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { LlmWorkflowStep } from "@/app/api/llm-studio/workflows/route";
import type { LlmTargetService } from "@/lib/llm/dispatch-llm";
import {
  type LlmTargetOption,
  type WorkflowRecordItem,
  parseTargetOption,
} from "./types";

interface ChainStepResult {
  stepId: string;
  stepName: string;
  targetUsed: string | null;
  model: string;
  answer: string;
  thinking: string | null;
  latencyMs: number;
  tokPerSec: number | null;
  validJson: boolean | null;
}

interface ChainRunResponse {
  ok: boolean;
  totalLatencyMs: number;
  finalOutput: string;
  stepResults: ChainStepResult[];
}

function makeBlankStep(index: number): LlmWorkflowStep {
  return {
    id: `step-${Date.now().toString(36)}-${index}`,
    name: `Step ${index + 1}`,
    targetVm: "auto",
    targetService: "default",
    mode: "chat",
    systemPrompt: "Process the previous output cleanly and accurately.",
    promptTemplate: index === 0 ? "{{input}}" : "Input:\n{{input}}\n\nPrevious step output:\n{{prev.output}}",
    temperature: 0.2,
    maxTokens: 1536,
  };
}

export function WorkflowsChainPanel({ targetOptions }: { targetOptions: LlmTargetOption[] }) {
  const { data, refetch } = useQuery<{ workflows: WorkflowRecordItem[] }>({
    queryKey: ["llm-studio-workflows"],
    queryFn: async () => {
      const res = await fetch("/api/llm-studio/workflows");
      if (!res.ok) throw new Error("Failed to fetch LLM workflows");
      return res.json();
    },
    staleTime: 15000,
  });

  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [workflowName, setWorkflowName] = useState<string>("Custom Chained LLM Pipeline");
  const [steps, setSteps] = useState<LlmWorkflowStep[]>([makeBlankStep(0), makeBlankStep(1)]);
  const [workflowInput, setWorkflowInput] = useState<string>(
    "Quarterly Engineering Note: API Gateway v2 cut P95 from 310ms to 112ms using connection pooling, but WebSocket reconnect storms caused 1.4% transient 502s during rolling deploys."
  );

  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<ChainRunResponse | null>(null);

  const workflows = data?.workflows || [];

  function loadWorkflow(wf: WorkflowRecordItem) {
    setSelectedSlug(wf.slug);
    setWorkflowName(wf.name);
    setSteps(wf.steps.length > 0 ? wf.steps : [makeBlankStep(0)]);
    setRunResult(null);
    toast.success(`Loaded workflow: ${wf.name}`);
  }

  function updateStep(index: number, patch: Partial<LlmWorkflowStep>) {
    setSteps((prev) => prev.map((s, idx) => (idx === index ? { ...s, ...patch } : s)));
  }

  function moveStep(index: number, delta: -1 | 1) {
    const nextIdx = index + delta;
    if (nextIdx < 0 || nextIdx >= steps.length) return;
    setSteps((prev) => {
      const arr = [...prev];
      const [item] = arr.splice(index, 1);
      arr.splice(nextIdx, 0, item);
      return arr;
    });
  }

  async function handleSaveCustom() {
    if (!workflowName.trim() || steps.length === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/llm-studio/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: workflowName.trim(),
          categoryTag: "custom-chain",
          steps,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; slug?: string; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success("Saved LLM workflow template");
      if (json.slug) setSelectedSlug(json.slug);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteWorkflow(id: string) {
    try {
      const res = await fetch(`/api/llm-studio/workflows?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Deleted custom workflow");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleRunChain() {
    if (!workflowInput.trim() || steps.length === 0 || running) return;
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/v1/llm-eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run_workflow",
          steps,
          workflowInput,
          fallbackToVault: true,
        }),
      });
      const json = (await res.json()) as ChainRunResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRunResult(json);
      toast.success(`Chain completed ${json.stepResults.length} steps in ${json.totalLatencyMs}ms`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Workflow execution failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Saved Templates Sidebar */}
      <div className="space-y-3 lg:col-span-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              LLM Workflow Templates
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant="outline"
                onClick={async () => {
                  try {
                    const res = await fetch("/api/test-kits/ch214");
                    if (!res.ok) throw new Error("Failed to load Ch. 214 kit");
                    const kit = (await res.json()) as {
                      llmWorkflowSteps: LlmWorkflowStep[];
                      beats: Array<{ beatName: string; paragraphRange: string; beatText: string }>;
                    };
                    setSelectedSlug("");
                    setWorkflowName("LOTM Ch. 214 · Directing Chain");
                    setSteps(kit.llmWorkflowSteps);
                    const b1 = kit.beats[0];
                    const b2 = kit.beats[1];
                    if (b1) {
                      setWorkflowInput(
                        `${b1.beatName} (¶${b1.paragraphRange}):\n${b1.beatText}${
                          b2 ? `\n\n${b2.beatName} (¶${b2.paragraphRange}):\n${b2.beatText}` : ""
                        }`
                      );
                    }
                    setRunResult(null);
                    toast.success("Loaded LOTM Ch. 214 3-Step Directing Workflow");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed to load kit");
                  }
                }}
              >
                Ch. 214 Chain
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setSelectedSlug("");
                  setWorkflowName("New Chained Pipeline");
                  setSteps([makeBlankStep(0), makeBlankStep(1)]);
                }}
              >
                <Plus className="size-3" /> Blank
              </Button>
            </div>
          </div>
          <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className={`rounded-lg border p-2.5 transition ${
                  selectedSlug === wf.slug
                    ? "border-violet-500/50 bg-violet-950/20"
                    : "border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => loadWorkflow(wf)}
                    className="text-left flex-1 space-y-1"
                  >
                    <div className="flex items-center gap-1.5">
                      <Workflow className="size-3.5 text-violet-400 shrink-0" />
                      <span className="text-xs font-medium text-zinc-100">{wf.name}</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 line-clamp-2">{wf.description}</p>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {wf.steps.length} steps
                      </Badge>
                      <Badge variant="outline" className="text-[10px] text-zinc-400">
                        {wf.isSeeded ? "Built-in" : "Custom"}
                      </Badge>
                    </div>
                  </button>
                  {!wf.isSeeded && (
                    <button
                      type="button"
                      onClick={() => handleDeleteWorkflow(wf.id)}
                      className="text-zinc-500 hover:text-red-400"
                      title="Delete workflow"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chain Editor & Runner */}
      <div className="space-y-4 lg:col-span-8">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-100"
            />
            <Button size="sm" variant="outline" onClick={handleSaveCustom} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save Workflow
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSteps((p) => [...p, makeBlankStep(p.length)])}
            >
              <Plus className="size-3.5" /> Add Step
            </Button>
          </div>

          <div className="space-y-3">
            {steps.map((step, idx) => {
              const combinedVal = `${step.targetVm || "auto"}::${step.targetService || "default"}`;
              const matchingVal = targetOptions.some((o) => o.value === combinedVal)
                ? combinedVal
                : "auto::default";

              return (
                <div
                  key={step.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-violet-600/20 text-violet-300 border-violet-500/40">
                        Step {idx + 1}
                      </Badge>
                      <input
                        type="text"
                        value={step.name}
                        onChange={(e) => updateStep(idx, { name: e.target.value })}
                        className="h-7 rounded border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-100"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon-xs" variant="ghost" onClick={() => moveStep(idx, -1)}>
                        <ArrowUp className="size-3" />
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => moveStep(idx, 1)}>
                        <ArrowDown className="size-3" />
                      </Button>
                      {steps.length > 1 && (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => setSteps((p) => p.filter((_, i) => i !== idx))}
                        >
                          <Trash2 className="size-3 text-red-400" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <select
                      value={matchingVal}
                      onChange={(e) => {
                        const parsed = parseTargetOption(e.target.value);
                        updateStep(idx, {
                          targetVm: parsed.targetVm,
                          targetService: parsed.targetService as LlmTargetService,
                        });
                      }}
                      className="h-8 rounded border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-100 sm:col-span-2"
                    >
                      {targetOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          [{o.badge}] {o.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={step.mode}
                      onChange={(e) => updateStep(idx, { mode: e.target.value as "chat" | "json" })}
                      className="h-8 rounded border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-100"
                    >
                      <option value="chat">Text Output</option>
                      <option value="json">Strict JSON</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <textarea
                      rows={2}
                      value={step.systemPrompt}
                      onChange={(e) => updateStep(idx, { systemPrompt: e.target.value })}
                      placeholder="System prompt for this step"
                      className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-200"
                    />
                    <textarea
                      rows={2}
                      value={step.promptTemplate}
                      onChange={(e) => updateStep(idx, { promptTemplate: e.target.value })}
                      placeholder="Template using {{input}} or {{prev.output}} or {{step_1.output}}"
                      className="rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-200"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-zinc-800 pt-3 space-y-2">
            <label className="block text-[11px] font-medium text-zinc-400">
              Workflow Input (`{"{{input}}"}`)
            </label>
            <div className="flex gap-2">
              <textarea
                rows={3}
                value={workflowInput}
                onChange={(e) => setWorkflowInput(e.target.value)}
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-xs text-zinc-100"
              />
              <Button onClick={handleRunChain} disabled={running} className="self-end h-10 px-5">
                {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {running ? "Running..." : "Run Chain"}
              </Button>
            </div>
          </div>
        </div>

        {runResult && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="text-xs font-semibold text-emerald-300">
                Chain Execution Trace ({runResult.stepResults.length} steps)
              </span>
              <span className="flex items-center gap-1 text-xs text-zinc-400">
                <Clock className="size-3.5" /> Total {runResult.totalLatencyMs}ms
              </span>
            </div>
            <div className="space-y-2.5">
              {runResult.stepResults.map((sr, i) => (
                <div key={sr.stepId} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-zinc-100">
                      {i + 1}. {sr.stepName}
                    </span>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                      <Badge variant="outline" className="text-[10px]">
                        {sr.targetUsed || sr.model}
                      </Badge>
                      <span>{sr.latencyMs}ms</span>
                      {sr.tokPerSec && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Gauge className="size-3" /> {sr.tokPerSec} t/s
                        </span>
                      )}
                      {sr.validJson !== null && (
                        <CheckCircle2
                          className={`size-3.5 ${
                            sr.validJson ? "text-emerald-400" : "text-red-400"
                          }`}
                        />
                      )}
                    </div>
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-xs text-zinc-200 max-h-56 overflow-y-auto">
                    {sr.answer}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
