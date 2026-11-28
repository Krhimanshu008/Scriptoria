"use client";

import React, { useEffect, useState } from "react";
import {
  Send,
  Loader2,
  Plus,
  Trash2,
  ImagePlus,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Sparkles,
  Repeat,
  Clock,
  Gauge,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  DispatchLlmResult,
  LlmChatMode,
  LlmReasoningEffort,
} from "@/lib/llm/dispatch-llm";
import {
  type AttachedImageWithEstimate,
  GENERAL_PLAYGROUND_PRESETS,
  type LlmTargetOption,
  type PlaygroundPreset,
  downscaleImageWithMetrics,
  parseTargetOption,
} from "./types";
import { useLlmTelemetry } from "./LlmTelemetryContext";
import {
  InferenceReceiptBar,
  type InferenceReceiptData,
  receiptFromDispatchResult,
} from "./InferenceReceiptBar";

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageDataUrls?: string[];
  thinking?: string | null;
  meta?: {
    source: string;
    target: string | null;
    model: string;
    latencyMs: number;
    ttftMs: number | null;
    tokPerSec: number | null;
    completionTokens?: number;
    jsonValidation?: DispatchLlmResult["jsonValidation"];
    receipt?: InferenceReceiptData;
    repeatRuns?: Array<{
      runIndex: number;
      latencyMs: number;
      tokPerSec: number | null;
      rawDecodeTokPerSec: number | null;
      mtpPct: number | null;
      validJson: boolean | null;
      preview: string;
    }>;
  };
}

interface SavedThread {
  id: string;
  title: string;
  mode: LlmChatMode;
  systemPrompt: string;
  jsonSchema: string;
  turns: ChatTurn[];
  updatedAt: number;
}

const STORAGE_KEY = "scriptoria_llm_playground_threads_v2";

export function PlaygroundPanel({
  targetOptions,
  globalThinkingEnabled,
}: {
  targetOptions: LlmTargetOption[];
  globalThinkingEnabled: boolean;
}) {
  const { beginRequest, endRequest } = useLlmTelemetry();
  const [threads, setThreads] = useState<SavedThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("thread-default");

  const [selectedTarget, setSelectedTarget] = useState<string>("auto::default");
  const [mode, setMode] = useState<LlmChatMode>("chat");
  const [reasoningEffort, setReasoningEffort] = useState<LlmReasoningEffort>("low");
  const [repeatCount, setRepeatCount] = useState<1 | 3>(1);
  const [temperature, setTemperature] = useState<number>(0.25);
  const [maxTokens, setMaxTokens] = useState<number>(2048);
  const [fallbackToVault, setFallbackToVault] = useState<boolean>(true);
  const [systemPrompt, setSystemPrompt] = useState<string>(
    "You are a precise, helpful AI engineering and reasoning assistant."
  );
  const [jsonSchema, setJsonSchema] = useState<string>("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [promptInput, setPromptInput] = useState<string>("");
  const [attachedImages, setAttachedImages] = useState<AttachedImageWithEstimate[]>([]);
  const [showPromptsConfig, setShowPromptsConfig] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as SavedThread[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setThreads(parsed);
        }
      } catch {
        // ignore storage errors
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  function persistThreads(nextTurns: ChatTurn[], threadId = activeThreadId, nextTitle?: string) {
    setThreads((prev) => {
      const title =
        nextTitle ||
        prev.find((t) => t.id === threadId)?.title ||
        nextTurns.find((m) => m.role === "user")?.content.slice(0, 36) ||
        "New Test Thread";
      const record: SavedThread = {
        id: threadId,
        title,
        mode,
        systemPrompt,
        jsonSchema,
        turns: nextTurns.slice(-24),
        updatedAt: Date.now(),
      };
      const merged = [record, ...prev.filter((t) => t.id !== threadId)].slice(0, 12);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        // ignore quota limits
      }
      return merged;
    });
  }

  function applyPreset(preset: PlaygroundPreset) {
    setMode(preset.mode);
    setReasoningEffort(preset.reasoningEffort);
    setSystemPrompt(preset.systemPrompt);
    setJsonSchema(preset.jsonSchema);
    setPromptInput(preset.samplePrompt);
    setShowPromptsConfig(preset.mode === "json" || preset.mode === "vision_qa");
    const svcMatch = targetOptions.find((o) => o.targetService === preset.targetService);
    if (svcMatch) setSelectedTarget(svcMatch.value);
    toast.success(`Loaded preset: ${preset.label}`);
  }

  function handleNewThread() {
    const id = `thread-${Date.now().toString(36)}`;
    setActiveThreadId(id);
    setTurns([]);
    setAttachedImages([]);
    setPromptInput("");
  }

  function handleSelectThread(t: SavedThread) {
    setActiveThreadId(t.id);
    setMode(t.mode);
    setSystemPrompt(t.systemPrompt);
    setJsonSchema(t.jsonSchema);
    setTurns(t.turns);
  }

  function handleDeleteThread(id: string) {
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    if (activeThreadId === id) {
      handleNewThread();
    }
  }

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const imgs = await Promise.all(files.slice(0, 3).map((f) => downscaleImageWithMetrics(f)));
      setAttachedImages((prev) => [...prev, ...imgs].slice(0, 4));
      if (mode !== "vision_qa") setMode("vision_qa");
    } catch {
      toast.error("Could not decode image attachment");
    } finally {
      e.target.value = "";
    }
  }

  async function handleSend() {
    const text = promptInput.trim();
    if ((!text && attachedImages.length === 0) || sending) return;

    const imageDataUrls = attachedImages.map((i) => i.dataUrl);
    const hasImgs = imageDataUrls.length > 0;
    const userTurn: ChatTurn = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text || "Inspect attached image(s).",
      imageDataUrls: hasImgs ? imageDataUrls : undefined,
    };

    const nextHistory = [...turns, userTurn];
    setTurns(nextHistory);
    setPromptInput("");
    setAttachedImages([]);
    setSending(true);

    const { targetVm, targetService } = parseTargetOption(selectedTarget);
    const apiMessages = nextHistory.map((m) => ({
      role: m.role,
      content: m.content,
      imageDataUrls: m.imageDataUrls,
    }));

    try {
      const dispatchOne = async (runIdx: number) => {
        const reqId = beginRequest({
          label: repeatCount > 1 ? `Playground ${runIdx + 1}/${repeatCount}` : hasImgs ? "Vision QA" : "Playground",
          hasImages: hasImgs,
          isJsonMode: mode === "json" || mode === "vision_qa",
        });
        try {
          const res = await fetch("/api/llm-studio/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: apiMessages,
              systemPrompt,
              mode,
              jsonSchema: jsonSchema.trim() || undefined,
              reasoningEffort,
              enableThinking: globalThinkingEnabled,
              temperature,
              maxTokens,
              fallbackToVault,
              targetVm,
              targetService,
            }),
          });
          const data = (await res.json()) as DispatchLlmResult & { error?: string };
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          endRequest(reqId, data);
          return data;
        } catch (err) {
          endRequest(reqId, null);
          throw err;
        }
      };

      const runs: DispatchLlmResult[] = [];
      for (let i = 0; i < repeatCount; i++) {
        runs.push(await dispatchOne(i));
      }

      const primary = runs[0];
      const assistantTurn: ChatTurn = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: primary.answer,
        thinking: primary.thinking,
        meta: {
          source: primary.source,
          target: primary.target,
          model: primary.model,
          latencyMs: primary.latencyMs,
          ttftMs: primary.ttftMs,
          tokPerSec: primary.tokPerSec,
          completionTokens: primary.usage?.completion_tokens,
          jsonValidation: primary.jsonValidation,
          receipt: receiptFromDispatchResult(primary),
          repeatRuns:
            repeatCount > 1
              ? runs.map((r, idx) => ({
                  runIndex: idx + 1,
                  latencyMs: r.latencyMs,
                  tokPerSec: r.tokPerSec,
                  rawDecodeTokPerSec: r.rawDecodeTokPerSec,
                  mtpPct: r.mtpStats?.acceptancePct ?? null,
                  validJson: r.jsonValidation ? r.jsonValidation.isValidJson : null,
                  preview: r.answer.slice(0, 140),
                }))
              : undefined,
        },
      };

      const completed = [...nextHistory, assistantTurn];
      setTurns(completed);
      persistThreads(completed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "LLM request failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Left sidebar: Presets & Saved Threads */}
      <div className="space-y-3 lg:col-span-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Test Presets
            </span>
            <Sparkles className="size-3.5 text-violet-400" />
          </div>
          <div className="space-y-1.5">
            {GENERAL_PLAYGROUND_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="w-full rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-2.5 py-2 text-left transition hover:border-violet-500/40 hover:bg-zinc-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-200">{p.label}</span>
                  <Badge variant="outline" className="text-[10px] uppercase text-zinc-400">
                    {p.mode}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Recent Threads
            </span>
            <Button size="xs" variant="outline" onClick={handleNewThread}>
              <Plus className="size-3" /> New
            </Button>
          </div>
          {threads.length === 0 ? (
            <p className="text-xs text-zinc-500">No saved runs yet.</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {threads.map((t) => (
                <div
                  key={t.id}
                  className={`group flex items-center justify-between gap-1 rounded-lg border px-2 py-1.5 text-xs ${
                    t.id === activeThreadId
                      ? "border-violet-500/50 bg-violet-950/20 text-zinc-100"
                      : "border-zinc-800/70 bg-zinc-900/40 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectThread(t)}
                    className="flex-1 truncate text-left"
                  >
                    {t.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteThread(t.id)}
                    className="opacity-60 hover:text-red-400 hover:opacity-100"
                    title="Delete thread"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Playground Workbench */}
      <div className="space-y-3 lg:col-span-9">
        {/* Controls Toolbar */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 space-y-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            <div className="xl:col-span-2">
              <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                Target Route / Endpoint
              </label>
              <select
                value={selectedTarget}
                onChange={(e) => setSelectedTarget(e.target.value)}
                className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100 outline-none focus:border-violet-500"
              >
                {targetOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    [{o.badge}] {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-zinc-400">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as LlmChatMode)}
                className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100 outline-none focus:border-violet-500"
              >
                <option value="chat">Chat / Reasoning</option>
                <option value="json">Strict JSON Schema</option>
                <option value="vision_qa">Vision QA (Multimodal)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 flex items-center justify-between text-[11px] font-medium text-zinc-400">
                <span>Prompt Style</span>
                <span
                  className={`rounded px-1.5 font-mono text-[9px] ${
                    globalThinkingEnabled
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  &lt;think&gt; {globalThinkingEnabled ? "ON" : "OFF"}
                </span>
              </label>
              <select
                value={reasoningEffort}
                onChange={(e) => setReasoningEffort(e.target.value as LlmReasoningEffort)}
                className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100 outline-none focus:border-violet-500"
              >
                <option value="none">Direct Answer</option>
                <option value="low">Balanced</option>
                <option value="medium">Detailed</option>
                <option value="high">Exhaustive</option>
              </select>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                  Consistency
                </label>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
                  <button
                    type="button"
                    onClick={() => setRepeatCount(1)}
                    className={`rounded-md py-1 text-xs font-medium ${
                      repeatCount === 1 ? "bg-violet-600 text-white" : "text-zinc-400"
                    }`}
                  >
                    1x
                  </button>
                  <button
                    type="button"
                    onClick={() => setRepeatCount(3)}
                    className={`flex items-center justify-center gap-1 rounded-md py-1 text-xs font-medium ${
                      repeatCount === 3 ? "bg-violet-600 text-white" : "text-zinc-400"
                    }`}
                  >
                    <Repeat className="size-3" /> 3x
                  </button>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowPromptsConfig((v) => !v)}
              >
                {showPromptsConfig ? "Hide Config" : "System/JSON"}
              </Button>
            </div>
          </div>

          {showPromptsConfig && (
            <div className="grid grid-cols-1 gap-3 border-t border-zinc-800 pt-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                  System Prompt
                </label>
                <textarea
                  rows={4}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-100 outline-none focus:border-violet-500"
                />
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                  <label className="flex items-center gap-1.5">
                    Temp
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={2}
                      value={temperature}
                      onChange={(e) => setTemperature(Number(e.target.value))}
                      className="h-7 w-16 rounded border border-zinc-800 bg-zinc-900 px-1.5 text-zinc-100"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Max Tok
                    <input
                      type="number"
                      step={128}
                      min={64}
                      max={8192}
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(Number(e.target.value))}
                      className="h-7 w-20 rounded border border-zinc-800 bg-zinc-900 px-1.5 text-zinc-100"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fallbackToVault}
                      onChange={(e) => setFallbackToVault(e.target.checked)}
                    />
                    Vault Fallback
                  </label>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                  Strict JSON Schema (optional)
                </label>
                <textarea
                  rows={6}
                  placeholder='{"required": ["status", "items"]}'
                  value={jsonSchema}
                  onChange={(e) => setJsonSchema(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-100 outline-none focus:border-violet-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Transcript */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 min-h-[380px] max-h-[540px] overflow-y-auto space-y-4">
          {turns.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center text-zinc-500 space-y-2">
              <Sparkles className="size-7 text-violet-500/50" />
              <p className="text-sm font-medium text-zinc-300">
                LLM Playground & Prompt Test Bench
              </p>
              <p className="max-w-md text-xs text-zinc-500">
                Test single-model Qwen3.8-27B generation, strict JSON schema adherence, multimodal Vision QA,
                or 3x consistency runs across Kaggle Dual-T4 or Vault Cloud fallback.
              </p>
            </div>
          ) : (
            turns.map((turn) => (
              <div
                key={turn.id}
                className={`rounded-xl border p-3.5 ${
                  turn.role === "user"
                    ? "border-zinc-800 bg-zinc-900/50 ml-8"
                    : "border-zinc-800/90 bg-zinc-900/90 mr-4"
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={turn.role === "user" ? "secondary" : "default"}
                      className="text-[10px] uppercase"
                    >
                      {turn.role === "user"
                        ? "Prompt"
                        : (turn.meta?.model
                            ? turn.meta.model.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
                              turn.meta.model
                            : null) || "Assistant"}
                    </Badge>
                    {turn.meta?.target && (
                      <Badge variant="outline" className="text-[10px] text-cyan-300 border-cyan-500/30">
                        {turn.meta.target} ({turn.meta.source})
                      </Badge>
                    )}
                    {turn.meta?.jsonValidation && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          turn.meta.jsonValidation.isValidJson
                            ? "border-emerald-500/40 text-emerald-300"
                            : "border-red-500/40 text-red-300"
                        }`}
                      >
                        {turn.meta.jsonValidation.isValidJson ? (
                          <CheckCircle2 className="mr-1 size-3" />
                        ) : (
                          <XCircle className="mr-1 size-3" />
                        )}
                        {turn.meta.jsonValidation.isValidJson
                          ? "Valid JSON"
                          : `JSON Fail: ${turn.meta.jsonValidation.missingKeys.join(", ") || turn.meta.jsonValidation.parseError}`}
                      </Badge>
                    )}
                  </div>

                  {turn.meta && (
                    <div className="flex items-center gap-3 text-[11px] text-zinc-400">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" /> {turn.meta.latencyMs}ms
                      </span>
                      {turn.meta.tokPerSec !== null && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Gauge className="size-3" /> {turn.meta.tokPerSec} tok/s
                        </span>
                      )}
                      {turn.meta.completionTokens && (
                        <span>{turn.meta.completionTokens} tok</span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(turn.content);
                          setCopiedId(turn.id);
                          setTimeout(() => setCopiedId(null), 1500);
                        }}
                        className="text-zinc-400 hover:text-zinc-100"
                        title="Copy output"
                      >
                        {copiedId === turn.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      </button>
                    </div>
                  )}
                </div>

                {turn.imageDataUrls && turn.imageDataUrls.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {turn.imageDataUrls.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={src}
                        alt={`Attachment ${i + 1}`}
                        className="h-20 w-20 rounded-lg border border-zinc-700 object-cover"
                      />
                    ))}
                  </div>
                )}

                {turn.thinking && (
                  <div className="mb-2.5 rounded-lg border border-amber-500/20 bg-amber-950/10 p-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedThinking((p) => ({ ...p, [turn.id]: !p[turn.id] }))
                      }
                      className="flex w-full items-center justify-between text-[11px] font-medium text-amber-300"
                    >
                      <span>Reasoning Trace (&lt;think&gt;)</span>
                      {expandedThinking[turn.id] ? (
                        <ChevronUp className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                    </button>
                    {expandedThinking[turn.id] && (
                      <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-amber-100/80">
                        {turn.thinking}
                      </pre>
                    )}
                  </div>
                )}

                <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-zinc-100">
                  {turn.content}
                </pre>

                {turn.meta?.receipt && <InferenceReceiptBar receipt={turn.meta.receipt} />}

                {turn.meta?.repeatRuns && (
                  <div className="mt-3 border-t border-zinc-800 pt-2.5 space-y-1.5">
                    <div className="text-[11px] font-semibold text-violet-300">
                      3x Consistency Sweep Variance
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {turn.meta.repeatRuns.map((r) => (
                        <div
                          key={r.runIndex}
                          className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-2 text-[11px]"
                        >
                          <div className="flex items-center justify-between font-medium text-zinc-300">
                            <span>Run #{r.runIndex}</span>
                            <span className="font-mono text-[10px]">
                              {r.latencyMs}ms
                              {(r.rawDecodeTokPerSec ?? r.tokPerSec) ? ` · ${r.rawDecodeTokPerSec ?? r.tokPerSec} t/s` : ""}
                              {r.mtpPct != null ? ` · MTP ${r.mtpPct}%` : ""}
                            </span>
                          </div>
                          {r.validJson !== null && (
                            <div
                              className={
                                r.validJson ? "text-emerald-400" : "text-red-400"
                              }
                            >
                              {r.validJson ? "JSON Passed" : "JSON Failed"}
                            </div>
                          )}
                          <p className="mt-1 line-clamp-2 text-zinc-500">{r.preview}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Composer */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-3 space-y-2.5">
          {attachedImages.length > 0 && (
            <div className="flex flex-wrap items-center gap-2.5">
              {attachedImages.map((img, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.dataUrl}
                    alt={`Attached ${i + 1}`}
                    className="h-14 w-14 rounded-lg border border-zinc-700 object-cover"
                  />
                  <span className="mt-0.5 block font-mono text-[9px] text-fuchsia-300">
                    ~{img.estimatedVisionTokens}t · {img.width}×{img.height}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachedImages((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="absolute -top-1.5 -right-1.5 rounded-full bg-zinc-900 p-0.5 text-zinc-300 ring-1 ring-zinc-700 hover:text-red-400"
                  >
                    <XCircle className="size-3.5" />
                  </button>
                </div>
              ))}
              <span className="rounded border border-fuchsia-500/35 bg-fuchsia-950/30 px-2 py-0.5 font-mono text-[10px] text-fuchsia-300">
                Est. Vision: ~{attachedImages.reduce((s, x) => s + x.estimatedVisionTokens, 0)} tok
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <textarea
              rows={3}
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Enter test prompt (Ctrl+Enter to run)..."
              className="flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-xs text-zinc-100 outline-none focus:border-violet-500"
            />
            <div className="flex flex-col justify-between gap-2">
              <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-300 hover:bg-zinc-800">
                <ImagePlus className="size-3.5" /> Image
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleImagePick}
                />
              </label>
              <Button onClick={handleSend} disabled={sending} className="h-10 px-4">
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {sending ? "Running..." : repeatCount === 3 ? "Run 3x" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
