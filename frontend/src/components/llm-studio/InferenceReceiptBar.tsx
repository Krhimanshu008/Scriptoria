"use client";

import React from "react";
import { CheckCircle2, XCircle, Cpu, Cloud, Eye, EyeOff, Zap, Clock, Layers } from "lucide-react";
import type { DispatchLlmResult } from "@/lib/llm/dispatch-llm";

export interface InferenceReceiptData {
  executionRoute: DispatchLlmResult["executionRoute"];
  model: string;
  latencyMs: number;
  rawDecodeTokPerSec: number | null;
  prefillTokPerSec: number | null;
  effectiveTokPerSec: number | null;
  relayOverheadMs: number | null;
  cacheN: number | null;
  promptTokens: number | null;
  thinkingTokens: number;
  answerTokens: number;
  tokenSplitEstimated?: boolean;
  visionEncodeMs: number | null;
  visionTokens: number | null;
  visionBypassed: boolean;
  mtpStats: DispatchLlmResult["mtpStats"];
  jsonValidation: DispatchLlmResult["jsonValidation"];
}

export function receiptFromDispatchResult(res: DispatchLlmResult): InferenceReceiptData {
  return {
    executionRoute: res.executionRoute,
    model: res.model,
    latencyMs: res.latencyMs,
    rawDecodeTokPerSec: res.rawDecodeTokPerSec,
    prefillTokPerSec: res.prefillTokPerSec,
    effectiveTokPerSec: res.effectiveTokPerSec,
    relayOverheadMs: res.relayOverheadMs,
    cacheN: res.cacheN,
    promptTokens: res.promptTokens,
    thinkingTokens: res.thinkingTokens,
    answerTokens: res.answerTokens,
    tokenSplitEstimated: res.tokenSplitEstimated,
    visionEncodeMs: res.visionEncodeMs,
    visionTokens: res.visionTokens,
    visionBypassed: res.visionBypassed,
    mtpStats: res.mtpStats,
    jsonValidation: res.jsonValidation,
  };
}

export function InferenceReceiptBar({ receipt }: { receipt: InferenceReceiptData }) {
  const isLocal = receipt.executionRoute !== "vault_cloud_fallback";
  const cacheHitPct =
    receipt.cacheN && receipt.promptTokens && receipt.promptTokens > 0
      ? Math.round((receipt.cacheN / receipt.promptTokens) * 100)
      : null;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-zinc-800/80 pt-2 font-mono text-[10px] tabular-nums">
      <span
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
          isLocal
            ? "border-emerald-500/35 bg-emerald-950/30 text-emerald-300"
            : "border-cyan-500/35 bg-cyan-950/30 text-cyan-300"
        }`}
      >
        {isLocal ? <Cpu className="size-2.5" /> : <Cloud className="size-2.5" />}
        {isLocal ? "2× T4 Local" : "Vault Cloud"}
      </span>

      {receipt.rawDecodeTokPerSec !== null && (
        <span className="rounded border border-zinc-800 bg-zinc-900/90 px-1.5 py-0.5 text-emerald-300">
          Decode {receipt.rawDecodeTokPerSec} t/s
        </span>
      )}

      {receipt.prefillTokPerSec !== null && (
        <span className="rounded border border-zinc-800 bg-zinc-900/90 px-1.5 py-0.5 text-cyan-300">
          Prefill {receipt.prefillTokPerSec} t/s
        </span>
      )}

      <span
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
          receipt.visionBypassed
            ? "border-zinc-800 bg-zinc-900/60 text-zinc-400"
            : "border-fuchsia-500/35 bg-fuchsia-950/30 text-fuchsia-300"
        }`}
      >
        {receipt.visionBypassed ? <EyeOff className="size-2.5" /> : <Eye className="size-2.5" />}
        {receipt.visionBypassed
          ? "Vision Bypassed 0ms"
          : `Vision ${receipt.visionEncodeMs != null ? `${Math.round(receipt.visionEncodeMs)}ms` : "active"}${
              receipt.visionTokens ? ` · ${receipt.visionTokens} tok` : ""
            }`}
      </span>

      <span className="rounded border border-zinc-800 bg-zinc-900/90 px-1.5 py-0.5 text-zinc-300">
        {receipt.tokenSplitEstimated ? "~" : ""}
        <span className={receipt.thinkingTokens > 0 ? "text-amber-300" : "text-zinc-500"}>
          Think {receipt.thinkingTokens}
        </span>
        {" / "}
        <span className="text-zinc-100">Ans {receipt.answerTokens} tok</span>
      </span>

      {receipt.cacheN !== null && (
        <span
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
            receipt.cacheN > 0
              ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-500"
          }`}
        >
          <Layers className="size-2.5" />
          Cache {receipt.cacheN}
          {cacheHitPct !== null ? ` (${cacheHitPct}%)` : ""}
        </span>
      )}

      {receipt.mtpStats && receipt.mtpStats.acceptancePct !== null && (
        <span className="inline-flex items-center gap-1 rounded border border-violet-500/35 bg-violet-950/30 px-1.5 py-0.5 text-violet-300">
          <Zap className="size-2.5" />
          MTP {receipt.mtpStats.acceptancePct}%
          {receipt.mtpStats.meanTokensPerStep ? ` · ${receipt.mtpStats.meanTokensPerStep} t/step` : ""}
        </span>
      )}

      {receipt.jsonValidation && (
        <span
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
            receipt.jsonValidation.isValidJson
              ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300"
              : "border-rose-500/40 bg-rose-950/30 text-rose-300"
          }`}
        >
          {receipt.jsonValidation.isValidJson ? (
            <CheckCircle2 className="size-2.5" />
          ) : (
            <XCircle className="size-2.5" />
          )}
          {receipt.jsonValidation.isValidJson ? "JSON Valid" : "JSON Invalid"}
        </span>
      )}

      <span className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/70 px-1.5 py-0.5 text-zinc-400">
        <Clock className="size-2.5" />
        {receipt.relayOverheadMs !== null ? `Relay ${receipt.relayOverheadMs}ms · ` : ""}
        Wall {(receipt.latencyMs / 1000).toFixed(2)}s
      </span>
    </div>
  );
}
