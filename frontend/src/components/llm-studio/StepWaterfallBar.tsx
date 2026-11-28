"use client";

import React from "react";

export interface StepWaterfallSegments {
  relayMs: number;
  prefillMs: number;
  visionMs: number;
  thinkingMs: number;
  visibleDecodeMs: number;
  totalMs: number;
}

export function buildStepWaterfall(opts: {
  wallLatencyMs: number;
  promptMs?: number | null;
  predictedMs?: number | null;
  visionEncodeMs?: number | null;
  relayOverheadMs?: number | null;
  thinkingTokens: number;
  answerTokens: number;
}): StepWaterfallSegments {
  const totalMs = Math.max(1, Math.round(opts.wallLatencyMs));
  const visionMs = Math.max(0, Math.round(opts.visionEncodeMs ?? 0));
  const rawPromptMs = Math.max(0, Math.round(opts.promptMs ?? 0));
  const prefillMs = Math.max(0, rawPromptMs - Math.min(rawPromptMs, visionMs));
  const predictedMs = Math.max(0, Math.round(opts.predictedMs ?? Math.max(0, totalMs - rawPromptMs)));
  const totOutToks = Math.max(1, opts.thinkingTokens + opts.answerTokens);
  const thinkingMs =
    opts.thinkingTokens > 0 ? Math.round((opts.thinkingTokens / totOutToks) * predictedMs) : 0;
  const visibleDecodeMs = Math.max(0, predictedMs - thinkingMs);
  const relayMs =
    opts.relayOverheadMs != null
      ? Math.max(0, Math.round(opts.relayOverheadMs))
      : Math.max(0, totalMs - (visionMs + prefillMs + thinkingMs + visibleDecodeMs));

  return { relayMs, prefillMs, visionMs, thinkingMs, visibleDecodeMs, totalMs };
}

export function StepWaterfallBar({ segments }: { segments: StepWaterfallSegments }) {
  const denom = Math.max(
    1,
    segments.relayMs + segments.prefillMs + segments.visionMs + segments.thinkingMs + segments.visibleDecodeMs
  );
  const items = [
    { key: "relay", label: "Relay", ms: segments.relayMs, color: "bg-zinc-500" },
    { key: "prefill", label: "Prefill", ms: segments.prefillMs, color: "bg-cyan-400" },
    { key: "vision", label: "Vision", ms: segments.visionMs, color: "bg-fuchsia-400" },
    { key: "think", label: "Think", ms: segments.thinkingMs, color: "bg-amber-400" },
    { key: "decode", label: "Decode", ms: segments.visibleDecodeMs, color: "bg-emerald-400" },
  ].filter((x) => x.ms > 0);

  return (
    <div className="space-y-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-900">
        {items.map((seg) => (
          <div
            key={seg.key}
            title={`${seg.label}: ${seg.ms}ms (${Math.round((seg.ms / denom) * 100)}%)`}
            className={`${seg.color} h-full transition-all`}
            style={{ width: `${Math.max(1.5, (seg.ms / denom) * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2.5 font-mono text-[10px] text-zinc-400">
        {items.map((seg) => (
          <span key={seg.key} className="inline-flex items-center gap-1">
            <span className={`inline-block size-1.5 rounded-full ${seg.color}`} />
            {seg.label} {seg.ms >= 1000 ? `${(seg.ms / 1000).toFixed(2)}s` : `${seg.ms}ms`}
          </span>
        ))}
      </div>
    </div>
  );
}
