"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Cpu,
  ImagePlus,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

interface LlmStudioHealth {
  vmStatus: string;
  target: string | null;
  accountAlias: string;
  endpointPreview: string | null;
  reachable: boolean;
  loadedModel: string | null;
  probeLatencyMs: number | null;
  probeError: string | null;
  gpuName: string | null;
  vramTotalGb: number;
  vramUsedGb: number;
  acc2RunningWrongProfile: {
    target: string;
    workerProfile: string;
    status: string;
  } | null;
  vaultFallbackCount: number;
}

interface TurnMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string | null;
  imageDataUrls?: string[];
  meta?: {
    source: string;
    model: string;
    latencyMs: number;
    tokPerSec: number | null;
    completionTokens?: number | null;
  };
}

type StudioMode = "chat" | "json" | "vision_qa";
type ThinkingLevel = "none" | "low" | "medium" | "high";

const DEFAULT_JSON_SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: {
      is_visually_consistent: { type: "boolean" },
      detected_discrepancies: { type: "array", items: { type: "string" } },
      requires_sam2_inpaint: { type: "boolean" },
      sam2_target_prompt: { type: "string" },
    },
    required: ["is_visually_consistent", "detected_discrepancies", "requires_sam2_inpaint"],
  },
  null,
  2
);

async function downscaleImageToDataUrl(file: File, maxEdge = 896): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image file"));
      img.onload = () => {
        const longest = Math.max(img.width, img.height);
        const scale = longest > maxEdge ? maxEdge / longest : 1;
        const w = Math.max(64, Math.round(img.width * scale));
        const h = Math.max(64, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function LlmStudioTab() {
  const [mode, setMode] = useState<StudioMode>("chat");
  const [reasoningEffort, setReasoningEffort] = useState<ThinkingLevel>("none");
  const [temperature, setTemperature] = useState(0.25);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [fallbackToVault, setFallbackToVault] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState(
    "You are the Book Visualiser & Scriptoria Neuro-Symbolic Co-Director."
  );
  const [jsonSchema, setJsonSchema] = useState(DEFAULT_JSON_SCHEMA);
  const [promptInput, setPromptInput] = useState("");
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [turns, setTurns] = useState<TurnMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Record<string, boolean>>({});

  const {
    data: health,
    isFetching: refreshingHealth,
    refetch: refetchHealth,
  } = useQuery<LlmStudioHealth>({
    queryKey: ["llm-studio-health"],
    queryFn: async () => {
      const res = await fetch("/api/llm-studio/health");
      if (!res.ok) throw new Error("Failed to check LLM Studio health");
      return res.json();
    },
    refetchInterval: 10000,
  });

  async function handleImagePick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, 3 - attachedImages.length);
    try {
      const urls = await Promise.all(picked.map((f) => downscaleImageToDataUrl(f, 896)));
      setAttachedImages((prev) => [...prev, ...urls].slice(0, 3));
      if (mode === "chat") setMode("vision_qa");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load image");
    }
  }

  function applyPreset(kind: "json_test" | "vision_qa" | "beat_shots") {
    if (kind === "json_test") {
      setMode("json");
      setReasoningEffort("none");
      setSystemPrompt("Return strict JSON validating character state continuity.");
      setJsonSchema(
        JSON.stringify(
          {
            type: "object",
            properties: {
              character: { type: "string" },
              eye_color: { type: "string" },
              weapon: { type: "string" },
              canon_ok: { type: "boolean" },
            },
            required: ["character", "eye_color", "weapon", "canon_ok"],
          },
          null,
          2
        )
      );
      setPromptInput(
        'Canonical DB state: Sunny has dark onyx eyes, coarse burlap tunic, iron wrist shackles, unarmed. Verify beat: "Sunny stumbled in the snow, gripping his rusted iron chain."'
      );
    } else if (kind === "vision_qa") {
      setMode("vision_qa");
      setReasoningEffort("none");
      setSystemPrompt(
        "You are the Studio Visual Continuity Critic. Compare the uploaded rendered shot against any attached Foundry reference plate and flag eye color, clothing, or weapon mismatches."
      );
      setJsonSchema(DEFAULT_JSON_SCHEMA);
      setPromptInput(
        "Audit the attached image(s). Expected character: frail 16yo boy, messy black hair, dark onyx eyes, coarse hemp slave tunic, iron wrist shackles, frozen mountain pass at night."
      );
    } else {
      setMode("json");
      setReasoningEffort("none");
      setSystemPrompt(
        "You are a Master Film & Anime DoP. Decompose the beat into 3 consecutive shots with camera_framing, focal_length_mm, lighting_style, and action_beat."
      );
      setJsonSchema(
        JSON.stringify(
          {
            type: "object",
            properties: {
              shots: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    shot_number: { type: "integer" },
                    camera_framing: { type: "string" },
                    focal_length_mm: { type: "integer" },
                    action_beat: { type: "string" },
                  },
                },
              },
            },
          },
          null,
          2
        )
      );
      setPromptInput(
        "Beat prose: Moonlight silvered the jagged mountain road. Sunny knelt in the snowdrift as the veteran guard raised his braided leather whip."
      );
    }
  }

  async function handleSend() {
    const trimmed = promptInput.trim();
    if (!trimmed && attachedImages.length === 0) return;
    if (sending) return;

    const userTurn: TurnMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed || "Inspect attached image(s).",
      imageDataUrls: attachedImages.length > 0 ? [...attachedImages] : undefined,
    };

    const nextTurns = [...turns, userTurn];
    setTurns(nextTurns);
    setPromptInput("");
    setAttachedImages([]);
    setSending(true);

    try {
      const res = await fetch("/api/llm-studio/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextTurns.map((t) => ({
            role: t.role,
            content: t.content,
            imageDataUrls: t.imageDataUrls,
          })),
          systemPrompt,
          mode,
          jsonSchema: mode === "chat" ? undefined : jsonSchema,
          reasoningEffort,
          temperature,
          maxTokens,
          fallbackToVault,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "LLM request failed");
        return;
      }

      const assistantTurn: TurnMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: String(data.answer || ""),
        thinking: data.thinking || null,
        meta: {
          source: data.source,
          model: data.model,
          latencyMs: data.latencyMs,
          tokPerSec: data.tokPerSec ?? null,
          completionTokens: data.usage?.completion_tokens ?? null,
        },
      };
      setTurns((prev) => [...prev, assistantTurn]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Top Health & Wrong-Profile Guidance Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-[#111114] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${
              health?.reachable
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : health?.vmStatus === "STARTING"
                ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                : "border-zinc-700 bg-zinc-900 text-zinc-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                health?.reachable
                  ? "bg-emerald-400"
                  : health?.vmStatus === "STARTING"
                  ? "bg-amber-400"
                  : "bg-zinc-500"
              }`}
            />
            QWEN-LLM: {health?.reachable ? "ONLINE" : health?.vmStatus || "OFFLINE"}
          </span>

          {health?.loadedModel && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-200">
              <Cpu className="h-3 w-3 text-indigo-400" />
              {health.loadedModel}
            </span>
          )}

          {health?.reachable && (
            <span className="font-mono text-[11px] text-zinc-400">
              VRAM {(health.vramUsedGb ?? 0).toFixed(1)}/{(health.vramTotalGb ?? 30).toFixed(0)}G ·{" "}
              {health.probeLatencyMs ?? "--"}ms
            </span>
          )}

          {!health?.reachable && health?.vaultFallbackCount ? (
            <span className="font-mono text-[10px] text-zinc-500">
              Vault Fallback Ready ({health.vaultFallbackCount} key
              {health.vaultFallbackCount === 1 ? "" : "s"})
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetchHealth()}
            disabled={refreshingHealth}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className={`h-3 w-3 ${refreshingHealth ? "animate-spin" : ""}`} />
            Probe
          </button>
          <Link
            href="/vms"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/25"
          >
            Manage Dual-T4 on /vms
          </Link>
        </div>
      </div>

      {health?.acc2RunningWrongProfile && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Kaggle Acc #2 (<strong className="font-mono">{health.acc2RunningWrongProfile.target}</strong>) is
              currently running <strong className="font-mono">{health.acc2RunningWrongProfile.workerProfile}</strong>{" "}
              (ComfyUI). Stop it on{" "}
              <Link href="/vms" className="underline">
                /vms
              </Link>
              , switch Profile to <strong className="font-mono">QWEN-LLM</strong>, and Boot Dual-T4 to run Qwen 27B.
            </span>
          </span>
        </div>
      )}

      {/* Split-Pane LLM + VLM Workstation */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Configuration & Presets Pane */}
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-[#111114] p-3.5 lg:col-span-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <Wrench className="h-3.5 w-3.5 text-indigo-400" />
              Inference Controls
            </span>
            <button
              type="button"
              onClick={() => setTurns([])}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          </div>

          {/* Mode Tabs */}
          <div className="grid grid-cols-3 gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1 text-[11px]">
            {(
              [
                { id: "chat", label: "Chat" },
                { id: "json", label: "JSON" },
                { id: "vision_qa", label: "VLM QA" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`rounded py-1 font-medium transition ${
                  mode === m.id
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* One-Click Presets */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Quick Test Presets
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => applyPreset("json_test")}
                className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:border-indigo-500/40 hover:text-white"
              >
                JSON Continuity
              </button>
              <button
                type="button"
                onClick={() => applyPreset("vision_qa")}
                className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:border-indigo-500/40 hover:text-white"
              >
                VLM Shot QA
              </button>
              <button
                type="button"
                onClick={() => applyPreset("beat_shots")}
                className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:border-indigo-500/40 hover:text-white"
              >
                Beat → Shots
              </button>
            </div>
          </div>

          {/* Thinking / Temp / Tokens */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500">Thinking</label>
              <select
                value={reasoningEffort}
                onChange={(e) => setReasoningEffort(e.target.value as ThinkingLevel)}
                className="mt-1 h-8 w-full rounded border border-zinc-800 bg-zinc-950 px-2 font-mono text-[11px] text-zinc-200"
              >
                <option value="none">none</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500">Temp</label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1.5"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="mt-1 h-8 w-full rounded border border-zinc-800 bg-zinc-950 px-2 font-mono text-[11px] text-zinc-200"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500">Max Tokens</label>
              <input
                type="number"
                step="64"
                min="64"
                max="4096"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="mt-1 h-8 w-full rounded border border-zinc-800 bg-zinc-950 px-2 font-mono text-[11px] text-zinc-200"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              checked={fallbackToVault}
              onChange={(e) => setFallbackToVault(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-950"
            />
            Auto-fallback to Vault LLM if QWEN-LLM is offline (text/JSON)
          </label>

          {/* System Prompt */}
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              System Prompt
            </label>
            <textarea
              rows={3}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-200"
            />
          </div>

          {mode !== "chat" && (
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                JSON Schema Contract
              </label>
              <textarea
                rows={6}
                value={jsonSchema}
                onChange={(e) => setJsonSchema(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-[10px] text-cyan-300"
              />
            </div>
          )}

          {/* VLM Image Attachment */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Vision Images ({attachedImages.length}/3)
              </span>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800">
                <ImagePlus className="h-3 w-3" />
                Attach PNG/JPG
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handleImagePick(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachedImages.map((src, idx) => (
                  <div
                    key={`att-${idx}`}
                    className="relative h-14 w-14 overflow-hidden rounded border border-zinc-700 bg-zinc-950"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Attachment ${idx + 1}`} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() =>
                        setAttachedImages((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="absolute right-0.5 top-0.5 rounded bg-black/75 p-0.5 text-zinc-300 hover:text-white"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Conversation & Output Pane */}
        <div className="flex min-h-[540px] flex-col rounded-lg border border-zinc-800 bg-[#111114] lg:col-span-8">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {turns.length === 0 ? (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-2 text-center text-zinc-500">
                <Bot className="h-8 w-8 text-zinc-600" />
                <div className="text-xs font-medium text-zinc-300">
                  Scriptoria Qwen 27B LLM + VLM Studio
                </div>
                <div className="max-w-md text-[11px] text-zinc-500">
                  Test text completions, structured JSON continuity checks, or attach rendered shots +
                  Foundry reference plates for multimodal VLM QA against Kaggle Account #2.
                </div>
              </div>
            ) : (
              turns.map((t) => {
                const thinkOpen = Boolean(expandedThinkingIds[t.id]);
                return (
                  <div
                    key={t.id}
                    className={`rounded-lg border p-3 text-xs ${
                      t.role === "user"
                        ? "border-zinc-800 bg-zinc-950/80 text-zinc-200"
                        : "border-indigo-500/25 bg-[#0c0d14] text-zinc-100"
                    }`}
                  >
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-zinc-500">
                      <span className="flex items-center gap-1.5 font-semibold uppercase text-zinc-300">
                        {t.role === "assistant" && <Sparkles className="h-3 w-3 text-indigo-400" />}
                        {t.role}
                      </span>
                      {t.meta && (
                        <span>
                          {t.meta.source} · {t.meta.model} · {t.meta.latencyMs}ms
                          {t.meta.tokPerSec ? ` · ${t.meta.tokPerSec} tok/s` : ""}
                        </span>
                      )}
                    </div>

                    {t.imageDataUrls && t.imageDataUrls.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {t.imageDataUrls.map((src, idx) => (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            key={`msg-img-${idx}`}
                            src={src}
                            alt={`Shot input ${idx + 1}`}
                            className="h-20 w-auto rounded border border-zinc-800 object-cover"
                          />
                        ))}
                      </div>
                    )}

                    {t.thinking && (
                      <div className="mb-2 rounded border border-zinc-800 bg-zinc-950/70">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedThinkingIds((prev) => ({
                              ...prev,
                              [t.id]: !thinkOpen,
                            }))
                          }
                          className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left font-mono text-[10px] text-amber-300/90"
                        >
                          {thinkOpen ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          Reasoning Trace ({t.thinking.length} chars)
                        </button>
                        {thinkOpen && (
                          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-zinc-800 p-2.5 font-mono text-[10px] text-zinc-400">
                            {t.thinking}
                          </pre>
                        )}
                      </div>
                    )}

                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-200">
                      {t.content}
                    </pre>
                  </div>
                );
              })
            )}
          </div>

          {/* Prompt Composer */}
          <div className="border-t border-zinc-800 p-3">
            <div className="flex gap-2">
              <textarea
                rows={3}
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Enter a prompt, narrative beat, or VLM QA instruction... (Ctrl+Enter to send)"
                className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || (!promptInput.trim() && attachedImages.length === 0)}
                className="inline-flex w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-md bg-indigo-600 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                <span>{sending ? "Running" : "Send"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

