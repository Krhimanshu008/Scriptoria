"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  Copy,
  Check,
  Cpu,
  Database,
  Eye,
  Flame,
  HardDrive,
  HeartPulse,
  Layers,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CANONICAL_LLM_DATASET_NAME } from "@/lib/llm/llm-model-presets";
import type { EnrichedKaggleAccount } from "@/components/studio/StudioVmLauncher";
import type { LlmHealthResponse } from "@/components/llm-studio/types";
import { useLlmTelemetry } from "@/components/llm-studio/LlmTelemetryContext";

interface MissionControlHudProps {
  health: LlmHealthResponse | undefined;
  refreshingHealth: boolean;
  globalThinkingEnabled: boolean;
  onToggleThinking: (enabled: boolean) => void;
  activeAccount: EnrichedKaggleAccount | null;
  targetBusyAction: string | null;
  onOpenLauncher: () => void;
  onOpenApiDialog: () => void;
  onRefreshHealth: () => void;
  onModelAction: (action: "stage_llm" | "load_llm" | "unload_llm" | "keep_alive" | "build_sm75") => void;
  onHotReload: () => void;
  onAttachSuggestedDataset: (slug: string) => void;
  onBuildDataset: () => void;
}

function formatCountdownSec(totalSec: number | null | undefined): string {
  if (totalSec === null || totalSec === undefined) return "--:--";
  const clamped = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatQuota(seconds: number): string {
  const mins = Math.max(0, Math.floor(seconds / 60));
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${String(rem).padStart(2, "0")}m`;
}

function formatEta(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `ETA ${m}m ${s}s` : `ETA ${s}s`;
}

export function MissionControlHud({
  health,
  refreshingHealth,
  globalThinkingEnabled,
  onToggleThinking,
  activeAccount,
  targetBusyAction,
  onOpenLauncher,
  onOpenApiDialog,
  onRefreshHealth,
  onModelAction,
  onHotReload,
  onAttachSuggestedDataset,
  onBuildDataset,
}: MissionControlHudProps) {
  const { activeRequest, lastTurn: clientLastTurn, jsonCompliance, resetJsonCompliance } =
    useLlmTelemetry();

  const [drawerManual, setDrawerManual] = useState<boolean | null>(null);
  const [logsPaused, setLogsPaused] = useState(false);
  const [frozenLogs, setFrozenLogs] = useState<string[]>([]);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const wdServerSec = health?.watchdog?.idleRemainingSec ?? null;
  const wdLastEpoch = health?.watchdog?.lastActiveEpoch ?? 0;
  const wdKey = `${wdServerSec ?? "none"}:${wdLastEpoch}`;
  const [wdTick, setWdTick] = useState<{ key: string; elapsed: number }>({
    key: "",
    elapsed: 0,
  });

  useEffect(() => {
    if (wdServerSec === null) return;
    const t = window.setInterval(() => {
      setWdTick((prev) => ({
        key: wdKey,
        elapsed: prev.key === wdKey ? prev.elapsed + 1 : 1,
      }));
    }, 1000);
    return () => window.clearInterval(t);
  }, [wdKey, wdServerSec]);

  const liveWatchdogSec =
    wdServerSec === null
      ? null
      : Math.max(0, wdServerSec - (wdTick.key === wdKey ? wdTick.elapsed : 0));

  const isOnline = health?.vmStatus === "ONLINE" && health.reachable;
  const isStarting = health?.vmStatus === "STARTING";
  const isLoadingModel = health?.runtimeMode === "loading_model";
  const isLlmReady = isOnline && health?.runtimeMode === "llm_ready";
  const isIdleEmpty = isOnline && !isLoadingModel && !isLlmReady;
  const activeTransfer = health?.activeTransfer ?? null;

  const autoExpandDrawer = Boolean(activeTransfer || isStarting || isLoadingModel);
  const drawerOpen = drawerManual !== null ? drawerManual : autoExpandDrawer;

  const liveLogs = health?.recentLogs ?? [];
  const displayedLogs = logsPaused ? frozenLogs : liveLogs;

  // Dual-T4 GPU rows (2 cards expected)
  const gpu0 = health?.gpus?.[0] ?? null;
  const gpu1 = health?.gpus?.[1] ?? null;
  const minFreeHeadroom =
    gpu0 && gpu1
      ? Math.min(gpu0.vramFreeGb, gpu1.vramFreeGb)
      : gpu0
      ? gpu0.vramFreeGb
      : null;

  // Speed & MTP reconciliation (prefer fresher client receipt vs last worker heartbeat)
  const useClientTurn =
    clientLastTurn &&
    (!health?.lastTurn || clientLastTurn.timestampMs >= health.lastTurn.timestampMs);
  const rawDecode = useClientTurn
    ? clientLastTurn.rawDecodeTokPerSec
    : health?.lastTurn?.rawDecodeTokPerSec ?? null;
  const prefill = useClientTurn
    ? clientLastTurn.prefillTokPerSec
    : health?.lastTurn?.prefillTokPerSec ?? null;
  const relayMs = useClientTurn ? clientLastTurn.relayOverheadMs : null;

  // Derive per-turn MTP accuracy from latest turn (client or worker heartbeat) instead of stale session /metrics total
  const workerLastTurnMtpPct =
    health?.lastTurn?.draftN &&
    health.lastTurn.draftN > 0 &&
    health.lastTurn.draftNAccepted !== undefined &&
    health.lastTurn.draftNAccepted !== null
      ? Math.round((health.lastTurn.draftNAccepted / health.lastTurn.draftN) * 1000) / 10
      : null;
  const workerLastTurnMeanStep =
    health?.lastTurn?.predictedN &&
    health?.lastTurn?.draftNAccepted !== undefined &&
    health?.lastTurn?.draftNAccepted !== null &&
    health.lastTurn.predictedN > health.lastTurn.draftNAccepted
      ? Math.round(
          (health.lastTurn.predictedN /
            (health.lastTurn.predictedN - health.lastTurn.draftNAccepted)) *
            100
        ) / 100
      : null;

  const lastTurnMtpPct =
    (useClientTurn ? clientLastTurn.mtpAcceptancePct : workerLastTurnMtpPct) ??
    clientLastTurn?.mtpAcceptancePct ??
    workerLastTurnMtpPct;
  const lastTurnMtpMeanStep =
    (useClientTurn ? clientLastTurn.mtpMeanTokensPerStep : workerLastTurnMeanStep) ??
    clientLastTurn?.mtpMeanTokensPerStep ??
    workerLastTurnMeanStep;

  const cumulMtpPct = health?.mtp?.acceptancePct ?? null;
  const mtpPct = lastTurnMtpPct ?? cumulMtpPct;
  const mtpMeanStep = lastTurnMtpMeanStep ?? health?.mtp?.meanTokensPerStep ?? null;

  const kvUsed = health?.slot?.kvUsed ?? 0;
  const kvTotal = health?.slot?.kvTotal ?? 16384;
  const kvPct = Math.min(100, Math.round((kvUsed / Math.max(1, kvTotal)) * 100));
  const cacheN =
    (health?.slot?.cacheN ?? 0) > 0
      ? health?.slot?.cacheN ?? 0
      : (useClientTurn ? clientLastTurn.cacheN : health?.lastTurn?.cacheN) ?? 0;
  const cacheHitPct = health?.slot?.cacheHitPct ?? 0;

  const reqElapsedSec = activeRequest ? activeRequest.elapsedMs / 1000 : 0;
  const reqPct = Math.min(100, Math.round((reqElapsedSec / 100) * 100));

  const quotaPct = activeAccount
    ? Math.min(100, Math.round((activeAccount.remainingSeconds / Math.max(1, activeAccount.totalAllowedSeconds)) * 100))
    : null;

  const ancillary = health?.ancillary;
  const suggestedSlug = activeAccount?.username
    ? `${activeAccount.username}/${CANONICAL_LLM_DATASET_NAME}`
    : null;

  return (
    <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/95 p-3.5 space-y-3 shadow-lg">
      {/* ROW 1 — Canonical Model Identity, Watchdog, Quota, Thinking Mode & Lifecycle */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-zinc-800/80 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="size-4 text-violet-400 shrink-0" />
          <span className="text-sm font-semibold tracking-tight text-zinc-100">
            Qwen3.8-27B VLM + Native MTP
          </span>

          <Badge
            variant="outline"
            className={`font-mono text-[10px] ${
              isLlmReady
                ? "border-emerald-500/40 bg-emerald-950/35 text-emerald-300"
                : isLoadingModel
                ? "border-amber-500/45 bg-amber-950/35 text-amber-300 animate-pulse"
                : isIdleEmpty
                ? "border-cyan-500/40 bg-cyan-950/30 text-cyan-300"
                : isStarting
                ? "border-amber-500/40 bg-amber-950/30 text-amber-300"
                : "border-zinc-700 bg-zinc-900 text-zinc-400"
            }`}
          >
            {isLlmReady
              ? `ONLINE · ${health?.target?.toUpperCase()} 2×T4 (VRAM READY)`
              : isLoadingModel
              ? `LOADING 27B INTO VRAM...`
              : isIdleEmpty
              ? `ONLINE · ${health?.target?.toUpperCase()} IDLE (0 GB)`
              : isStarting
              ? `STARTING · STEP ${health?.bootStep || 1}/5`
              : "OFFLINE · VAULT READY"}
          </Badge>

          {/* Idle Watchdog + Keep Alive */}
          {isOnline && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/90 px-2 py-0.5 font-mono text-[10px] tabular-nums">
              <Clock className="size-3 text-amber-400" />
              <span className="text-zinc-400">Watchdog:</span>
              <span
                className={
                  health?.watchdog?.idleTimeoutSec === 0
                    ? "text-emerald-300/90"
                    : liveWatchdogSec !== null && liveWatchdogSec < 180
                    ? "font-semibold text-rose-300"
                    : "text-zinc-200"
                }
                title={
                  health?.watchdog?.idleTimeoutSec === 0
                    ? "Auto-shutdown disabled (manual stop)"
                    : undefined
                }
              >
                {health?.watchdog?.idleTimeoutSec === 0
                  ? "Off"
                  : formatCountdownSec(liveWatchdogSec)}
              </span>
              <button
                type="button"
                disabled={Boolean(targetBusyAction)}
                onClick={() => onModelAction("keep_alive")}
                className="ml-1 rounded border border-emerald-500/35 bg-emerald-500/15 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                title="Reset idle watchdog timer without interrupting inference"
              >
                +Keep Alive
              </button>
            </div>
          )}

          {/* Kaggle Weekly Quota */}
          {activeAccount && !activeAccount.quotaError && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/90 px-2 py-0.5 font-mono text-[10px] tabular-nums">
              <HeartPulse
                className={`size-3 ${
                  (quotaPct ?? 100) < 15
                    ? "text-rose-400"
                    : (quotaPct ?? 100) < 35
                    ? "text-amber-400"
                    : "text-emerald-400"
                }`}
              />
              <span className="text-zinc-400">{activeAccount.alias.toUpperCase()} Quota:</span>
              <span className="text-zinc-200">{formatQuota(activeAccount.remainingSeconds)} / 30h</span>
            </div>
          )}
        </div>

        {/* Right cluster: Thinking Mode Switch + Lifecycle + API + Refresh */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Global Thinking Switch */}
          <div
            className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-[10px]"
            title="Global Qwen3.8 <think> mode for Playground, Batch & Chains"
          >
            <button
              type="button"
              onClick={() => onToggleThinking(false)}
              className={`rounded-md px-2 py-1 font-medium transition ${
                !globalThinkingEnabled
                  ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Think OFF · Fast
            </button>
            <button
              type="button"
              onClick={() => onToggleThinking(true)}
              className={`rounded-md px-2 py-1 font-medium transition ${
                globalThinkingEnabled
                  ? "bg-amber-500/20 text-amber-200 border border-amber-500/40"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Think ON · Deep
            </button>
          </div>

          {!isOnline ? (
            <Button size="sm" onClick={onOpenLauncher} className="h-8 text-xs">
              <Rocket className="mr-1.5 size-3.5" />
              Boot LLM VM
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(targetBusyAction) || isLoadingModel}
                onClick={() => onModelAction("stage_llm")}
                className="h-8 text-xs"
              >
                {targetBusyAction === "stage_llm" && <Loader2 className="mr-1 size-3 animate-spin" />}
                Stage Disk
              </Button>
              <Button
                size="sm"
                variant={isIdleEmpty ? "default" : "secondary"}
                disabled={Boolean(targetBusyAction) || isLoadingModel}
                onClick={() => onModelAction("load_llm")}
                className="h-8 text-xs"
              >
                {targetBusyAction === "load_llm" && <Loader2 className="mr-1 size-3 animate-spin" />}
                Load VRAM
              </Button>
              {isLlmReady && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(targetBusyAction)}
                  onClick={() => onModelAction("unload_llm")}
                  className="h-8 border-rose-500/35 text-xs text-rose-300 hover:bg-rose-500/15"
                >
                  {targetBusyAction === "unload_llm" && <Loader2 className="mr-1 size-3 animate-spin" />}
                  Unload
                </Button>
              )}
              <Button
                size="icon-sm"
                variant="outline"
                onClick={onOpenLauncher}
                title="Manage Kaggle Dual-T4 VM Launcher"
              >
                <Rocket className="size-3.5" />
              </Button>
            </>
          )}

          <Button size="sm" variant="outline" onClick={onOpenApiDialog} className="h-8 text-xs">
            <Terminal className="mr-1 size-3.5" />
            API
          </Button>

          <Button
            size="icon-sm"
            variant="outline"
            onClick={onRefreshHealth}
            title="Refresh Telemetry"
          >
            {refreshingHealth ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* ROW 2 — Mandatory 5-Card Live Telemetry Meter Grid */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {/* Card 1: Dual-T4 VRAM Split */}
        <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/55 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1 font-semibold uppercase tracking-wide text-zinc-400">
              <Cpu className="size-3 text-violet-400" />
              Dual-T4 VRAM
            </span>
            <span className="font-mono tabular-nums text-zinc-300">
              {isOnline ? `${(health?.vramUsedGb ?? 0).toFixed(1)}/${(health?.vramTotalGb ?? 30).toFixed(0)}G` : "0.0/30G"}
            </span>
          </div>

          {[
            { label: gpu0?.role || "TP 50% + mmproj", g: gpu0, barColor: "bg-violet-400" },
            { label: gpu1?.role || "TP 50% + KV", g: gpu1, barColor: "bg-indigo-400" },
          ].map((row, idx) => {
            const used = isOnline && row.g ? row.g.vramUsedGb : 0;
            const tot = row.g?.vramTotalGb ?? 15;
            const pct = Math.min(100, Math.round((used / Math.max(1, tot)) * 100));
            const color = pct > 94 ? "bg-rose-500" : pct > 88 ? "bg-amber-400" : row.barColor;
            return (
              <div key={idx} className="space-y-0.5">
                <div className="flex items-center justify-between font-mono text-[10px] tabular-nums">
                  <span className="truncate text-zinc-400">{row.label}</span>
                  <span className="text-zinc-200">{used.toFixed(1)}/{tot.toFixed(0)}G</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div className={`h-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between pt-0.5 font-mono text-[10px]">
            <span className="text-zinc-500">Vision Headroom</span>
            <span
              className={
                minFreeHeadroom === null || !isOnline
                  ? "text-zinc-500"
                  : minFreeHeadroom < 1.8
                  ? "font-semibold text-amber-300"
                  : "text-emerald-300"
              }
            >
              {minFreeHeadroom !== null && isOnline ? `${minFreeHeadroom.toFixed(1)} GB min` : "--"}
            </span>
          </div>
        </div>

        {/* Card 2: T4 Thermals & Compute */}
        <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/55 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1 font-semibold uppercase tracking-wide text-zinc-400">
              <Flame className="size-3 text-amber-400" />
              T4 Thermals &amp; TDP
            </span>
            <span className="font-mono text-zinc-500">70W Cap</span>
          </div>

          {[gpu0, gpu1].map((g, i) => {
            const temp = isOnline ? g?.tempC ?? null : null;
            const util = isOnline ? g?.utilPct ?? null : null;
            const pwr = isOnline ? g?.powerW ?? null : null;
            const lim = g?.powerLimitW ?? 70;
            const hot = temp !== null && temp >= 75;
            const crit = temp !== null && temp >= 82;
            const tdpSat = pwr !== null && lim > 0 && pwr >= lim * 0.94;
            return (
              <div
                key={i}
                className="flex items-center justify-between rounded border border-zinc-800/70 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] tabular-nums"
              >
                <span className="text-zinc-400">GPU{i}</span>
                <span className={crit ? "text-rose-300 font-semibold" : hot ? "text-amber-300" : "text-zinc-200"}>
                  {temp !== null ? `${temp}°C` : "--°C"}
                </span>
                <span className="text-cyan-300">{util !== null ? `${util}%` : "--%"}</span>
                <span className={tdpSat ? "text-amber-300 font-semibold" : "text-zinc-300"}>
                  {pwr !== null ? `${pwr}W` : `--/${lim}W`}
                </span>
              </div>
            );
          })}

          <div className="flex items-center justify-between font-mono text-[10px] text-zinc-500">
            <span>Thermal Guard</span>
            <span
              className={
                (gpu0?.tempC ?? 0) >= 82 || (gpu1?.tempC ?? 0) >= 82
                  ? "text-rose-300"
                  : (gpu0?.tempC ?? 0) >= 75 || (gpu1?.tempC ?? 0) >= 75
                  ? "text-amber-300"
                  : "text-emerald-400/90"
              }
            >
              {isOnline ? "sm_75 Monitored" : "Offline"}
            </span>
          </div>
        </div>

        {/* Card 3: Live KV Cache & Slot State */}
        <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/55 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1 font-semibold uppercase tracking-wide text-zinc-400">
              <Layers className="size-3 text-cyan-400" />
              KV Cache &amp; Slot
            </span>
            <span
              className={`rounded px-1.5 py-0.2 font-mono text-[9px] font-semibold uppercase ${
                !isLlmReady
                  ? "bg-zinc-800 text-zinc-400"
                  : health?.slot?.state === "vision"
                  ? "bg-fuchsia-500/20 text-fuchsia-300 animate-pulse"
                  : health?.slot?.state === "decoding"
                  ? "bg-emerald-500/20 text-emerald-300 animate-pulse"
                  : health?.slot?.state === "prefill"
                  ? "bg-cyan-500/20 text-cyan-300 animate-pulse"
                  : "bg-zinc-800 text-zinc-200"
              }`}
            >
              {!isOnline
                ? "OFFLINE"
                : isLoadingModel
                ? "LOADING"
                : !isLlmReady
                ? "EMPTY"
                : (health?.slot?.state || "idle").toUpperCase()}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between font-mono text-[10px] tabular-nums">
              <span className="text-zinc-400">Context</span>
              <span className="text-zinc-200">
                {kvUsed.toLocaleString()} / {kvTotal.toLocaleString()} ({kvPct}%)
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full transition-all ${
                  kvPct > 90 ? "bg-rose-500" : kvPct > 75 ? "bg-amber-400" : "bg-cyan-400"
                }`}
                style={{ width: `${kvPct}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-0.5 font-mono text-[10px] tabular-nums">
            <span className="text-zinc-500">Prefix Hit (cache_n)</span>
            <span className={cacheN > 0 ? "text-emerald-300" : "text-zinc-400"}>
              {cacheN > 0 ? `${cacheN} tok (${cacheHitPct}%)` : "0 tok"}
            </span>
          </div>
        </div>

        {/* Card 4: Speed & Native MTP Gauge */}
        <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/55 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1 font-semibold uppercase tracking-wide text-zinc-400">
              <Zap className="size-3 text-emerald-400" />
              Speed &amp; Native MTP
            </span>
            <span
              className={`font-mono text-[9px] px-1.5 rounded ${
                health?.mtp?.enabled ? "bg-violet-500/20 text-violet-300" : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {health?.mtp?.enabled ? `MTP n=${health.mtp.draftMax}` : "MTP Off"}
            </span>
          </div>

          <div className="flex items-baseline justify-between font-mono tabular-nums">
            <div>
              <div className="text-base font-bold text-emerald-300">
                {rawDecode !== null ? `${rawDecode}` : "--"}
                <span className="ml-1 text-[10px] font-normal text-zinc-400">tok/s</span>
              </div>
              <div className="text-[10px] text-zinc-500">
                Prefill: <span className="text-cyan-300">{prefill !== null ? `${prefill} t/s` : "--"}</span>
              </div>
            </div>
            <div className="text-right text-[10px]">
              <div className="text-violet-300 font-semibold">
                {mtpPct !== null ? `${mtpPct}% acc` : "--% acc"}
                {cumulMtpPct !== null &&
                  lastTurnMtpPct !== null &&
                  Math.abs(cumulMtpPct - lastTurnMtpPct) >= 1 && (
                    <span className="ml-1 text-[9px] font-normal text-zinc-500">
                      (avg {cumulMtpPct}%)
                    </span>
                  )}
              </div>
              <div className="text-zinc-400">
                {mtpMeanStep !== null ? `${mtpMeanStep} t/step` : "-- t/step"}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-0.5 font-mono text-[10px] tabular-nums">
            <span className="text-zinc-500">Relay Overhead</span>
            <span
              className={
                relayMs === null
                  ? "text-zinc-500"
                  : relayMs >= 1200
                  ? "text-rose-300"
                  : relayMs >= 400
                  ? "text-amber-300"
                  : "text-emerald-300"
              }
            >
              {relayMs !== null ? `${relayMs} ms` : "--"}
            </span>
          </div>
        </div>

        {/* Card 5: Reliability & Cloudflare 100s Edge Safety */}
        <div className="rounded-lg border border-zinc-800/90 bg-zinc-900/55 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1 font-semibold uppercase tracking-wide text-zinc-400">
              <ShieldCheck className="size-3 text-emerald-400" />
              Edge Guard &amp; GBNF
            </span>
            <span
              className={`inline-flex items-center gap-1 font-mono text-[9px] px-1.5 rounded ${
                clientLastTurn?.executionRoute === "vault_cloud_fallback"
                  ? "bg-cyan-500/20 text-cyan-300"
                  : isOnline
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {clientLastTurn?.executionRoute === "vault_cloud_fallback" ? (
                <>
                  <Cloud className="size-2.5" /> Vault Cloud
                </>
              ) : isOnline ? (
                "2× T4 Relay"
              ) : (
                "Standby"
              )}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between font-mono text-[10px] tabular-nums">
              <span className="text-zinc-400">
                {activeRequest ? `In-Flight: ${activeRequest.label}` : "CF 100s Budget"}
              </span>
              <span
                className={
                  !activeRequest
                    ? "text-zinc-400"
                    : reqElapsedSec >= 85
                    ? "font-bold text-rose-300 animate-pulse"
                    : reqElapsedSec >= 65
                    ? "font-semibold text-amber-300"
                    : "text-emerald-300"
                }
              >
                {activeRequest ? `${reqElapsedSec.toFixed(1)}s / 100s` : "Ready (<92s)"}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full transition-all duration-100 ${
                  !activeRequest
                    ? "bg-zinc-700"
                    : reqElapsedSec >= 85
                    ? "bg-rose-500 animate-pulse"
                    : reqElapsedSec >= 65
                    ? "bg-amber-400"
                    : "bg-emerald-400"
                }`}
                style={{ width: `${activeRequest ? Math.max(3, reqPct) : 0}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-0.5 font-mono text-[10px] tabular-nums">
            <span className="text-zinc-500">GBNF Valid</span>
            <div className="flex items-center gap-1.5">
              <span
                className={
                  jsonCompliance.compliancePct === null
                    ? "text-zinc-500"
                    : jsonCompliance.compliancePct >= 95
                    ? "text-emerald-300"
                    : jsonCompliance.compliancePct >= 80
                    ? "text-amber-300"
                    : "text-rose-300"
                }
              >
                {jsonCompliance.compliancePct !== null
                  ? `${jsonCompliance.compliancePct}% (${jsonCompliance.validJsonCalls}/${jsonCompliance.totalJsonCalls})`
                  : "—"}
              </span>
              {jsonCompliance.totalJsonCalls > 0 && (
                <button
                  type="button"
                  onClick={resetJsonCompliance}
                  className="text-[9px] text-zinc-500 hover:text-zinc-300"
                  title="Reset session JSON compliance counter"
                >
                  clr
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ROW 3 — 6-Pill Ancillary Readiness Bar & Auto-Expanding Staging / [LLM0] Log Drawer */}
      <div className="space-y-2 border-t border-zinc-800/80 pt-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
            {/* 1. Engine */}
            <span
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${
                ancillary?.engine.status === "ready"
                  ? ancillary.engine.isNativeSm75
                    ? "border-emerald-500/35 bg-emerald-950/30 text-emerald-300"
                    : "border-cyan-500/35 bg-cyan-950/30 text-cyan-300"
                  : ancillary?.engine.status === "partial"
                  ? "border-amber-500/35 bg-amber-950/30 text-amber-300"
                  : ancillary?.engine.status === "outdated"
                  ? "border-rose-500/40 bg-rose-950/30 text-rose-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400"
              }`}
              title={ancillary?.engine.version || "llama-server engine binary status"}
            >
              <Cpu className="size-2.5" />
              Engine: {ancillary?.engine.label || "Offline"}
              {isOnline && ancillary?.engine.status === "outdated" && (
                <button
                  type="button"
                  onClick={onHotReload}
                  className="ml-1 underline text-white"
                >
                  Hot Reload
                </button>
              )}
              {isOnline &&
                ancillary?.engine.status === "ready" &&
                !ancillary.engine.isNativeSm75 && (
                  <button
                    type="button"
                    disabled={
                      Boolean(targetBusyAction) || Boolean(ancillary.engine.sm75BuildRunning)
                    }
                    onClick={() => onModelAction("build_sm75")}
                    className="ml-1 inline-flex items-center gap-1 underline text-white disabled:opacity-50"
                    title="Compile native CUDA sm_75 llama-server once (~3m) and cache in Drive to skip future PTX JIT warmups"
                  >
                    {(ancillary.engine.sm75BuildRunning ||
                      targetBusyAction === "build_sm75") && (
                      <Loader2 className="size-2.5 animate-spin" />
                    )}
                    {ancillary.engine.sm75BuildRunning ? "Building sm_75..." : "Build sm_75"}
                  </button>
                )}
            </span>

            {/* 2. Weights */}
            <span
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${
                ancillary?.weights.status === "loaded"
                  ? "border-emerald-500/35 bg-emerald-950/30 text-emerald-300"
                  : ancillary?.weights.status === "cached"
                  ? "border-cyan-500/35 bg-cyan-950/30 text-cyan-300"
                  : ancillary?.weights.status === "staging"
                  ? "border-amber-500/40 bg-amber-950/30 text-amber-300"
                  : ancillary?.weights.status === "missing"
                  ? "border-amber-500/35 bg-amber-950/20 text-amber-200"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400"
              }`}
            >
              Weights:{" "}
              {ancillary?.weights.status === "loaded"
                ? "27B VRAM ✓"
                : ancillary?.weights.status === "cached"
                ? `Cached (${ancillary.weights.source})`
                : ancillary?.weights.status === "staging"
                ? "Staging..."
                : ancillary?.weights.status === "missing"
                ? "Not Staged"
                : "Offline"}
              {isOnline && ancillary?.weights.status === "cached" && (
                <button
                  type="button"
                  onClick={() => onModelAction("load_llm")}
                  className="ml-1 underline text-white"
                >
                  Load
                </button>
              )}
              {isOnline && ancillary?.weights.status === "missing" && (
                <button
                  type="button"
                  onClick={() => onModelAction("stage_llm")}
                  className="ml-1 underline text-white"
                >
                  Stage
                </button>
              )}
            </span>

            {/* 3. Vision Projector */}
            <span
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${
                ancillary?.vision.status === "loaded"
                  ? "border-emerald-500/35 bg-emerald-950/30 text-emerald-300"
                  : ancillary?.vision.status === "cached"
                  ? "border-cyan-500/35 bg-cyan-950/30 text-cyan-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400"
              }`}
            >
              <Eye className="size-2.5" />
              Vision:{" "}
              {ancillary?.vision.loaded
                ? ancillary.vision.bypassedOnLastTurn
                  ? "F16 · Bypassed 0ms"
                  : `F16 · ${ancillary.vision.lastEncodeMs ? `${Math.round(ancillary.vision.lastEncodeMs)}ms` : "Active"}`
                : ancillary?.vision.status === "cached"
                ? "mmproj-F16 Cached"
                : ancillary?.vision.status === "missing"
                ? "mmproj Missing"
                : "Offline"}
            </span>

            {/* 4. Kaggle Dataset */}
            <span
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${
                ancillary?.dataset.status === "attached"
                  ? "border-emerald-500/35 bg-emerald-950/30 text-emerald-300"
                  : ancillary?.dataset.status === "wrong_dataset"
                  ? "border-amber-500/40 bg-amber-950/30 text-amber-200"
                  : "border-zinc-800 bg-zinc-900 text-zinc-300"
              }`}
              title={
                ancillary?.dataset.status === "wrong_dataset"
                  ? `Attached dataset '${ancillary.dataset.wrongSlug}' contains no .gguf weights — replace with ${suggestedSlug || CANONICAL_LLM_DATASET_NAME}`
                  : undefined
              }
            >
              <Database className="size-2.5" />
              Dataset:{" "}
              {ancillary?.dataset.status === "attached"
                ? ancillary.dataset.slug
                : ancillary?.dataset.status === "wrong_dataset"
                ? `Wrong Dataset (${ancillary.dataset.wrongSlug?.split("/").pop() || "comfy-env"})`
                : "On-Demand"}
              {ancillary?.dataset.status !== "attached" && suggestedSlug && (
                <button
                  type="button"
                  onClick={() => onAttachSuggestedDataset(suggestedSlug)}
                  className="ml-1 text-cyan-300 underline hover:text-white"
                >
                  {ancillary?.dataset.status === "wrong_dataset"
                    ? `Attach ${CANONICAL_LLM_DATASET_NAME}`
                    : "+Attach"}
                </button>
              )}
              {ancillary?.dataset.status !== "attached" && activeAccount?.configured && (
                <button
                  type="button"
                  onClick={onBuildDataset}
                  className="ml-1 text-indigo-300 underline hover:text-white"
                >
                  Build 0-GPU
                </button>
              )}
            </span>

            {/* 5. /tmp Storage */}
            <span
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 tabular-nums ${
                ancillary?.storage.status === "critical"
                  ? "border-rose-500/40 bg-rose-950/30 text-rose-300"
                  : ancillary?.storage.status === "warn"
                  ? "border-amber-500/35 bg-amber-950/30 text-amber-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-300"
              }`}
            >
              <HardDrive className="size-2.5" />
              /tmp:{" "}
              {ancillary?.storage.freeGb != null
                ? `${ancillary.storage.freeGb.toFixed(1)}G free`
                : "--"}
            </span>

            {/* 6. Drive & Vault Failover */}
            {ancillary?.syncFailover.driveNeedsReconnect ? (
              <Link
                href="/settings/vault"
                className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-950/35 px-2 py-0.5 text-rose-200 hover:bg-rose-900/40"
              >
                <AlertTriangle className="size-2.5 text-rose-400" />
                Drive Expired · Reconnect →
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-300">
                Sync: {ancillary?.syncFailover.driveHealthy ? "Drive OK" : "Drive Idle"} · +
                {ancillary?.syncFailover.vaultFallbackCount ?? 0} Vault
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setDrawerManual((prev) => (prev === null ? !autoExpandDrawer : !prev))}
            className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[10px] text-zinc-300 hover:bg-zinc-800"
          >
            <Activity className="size-3 text-cyan-400" />
            Logs ({liveLogs.length})
            {drawerOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        </div>

        {drawerOpen && (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
            {activeTransfer && (
              <div className="space-y-1 rounded border border-cyan-500/35 bg-cyan-950/25 px-2.5 py-2 text-[10px] font-mono text-cyan-200">
                <div className="flex flex-wrap items-center justify-between gap-2 tabular-nums">
                  <span className="truncate font-semibold">
                    Downloading {activeTransfer.filename}
                  </span>
                  <span>
                    {activeTransfer.percentage}%
                    {activeTransfer.speedMbps ? ` · ${activeTransfer.speedMbps.toFixed(1)} MB/s` : ""}
                    {activeTransfer.totalBytes
                      ? ` · ${((activeTransfer.bytesDone || 0) / 1024 ** 3).toFixed(2)}/${(activeTransfer.totalBytes / 1024 ** 3).toFixed(2)} GB`
                      : ""}
                    {activeTransfer.etaSeconds ? ` · ${formatEta(activeTransfer.etaSeconds)}` : ""}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-300"
                    style={{ width: `${Math.max(2, Math.min(100, activeTransfer.percentage))}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[10px] text-zinc-400">
              <span className="font-mono uppercase tracking-wider">
                Live Worker / [LLM0] Log Tail
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (!logsPaused) setFrozenLogs(liveLogs);
                    setLogsPaused((p) => !p);
                  }}
                  className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200 hover:bg-zinc-700"
                >
                  {logsPaused ? <Play className="size-2.5" /> : <Pause className="size-2.5" />}
                  {logsPaused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(displayedLogs.join("\n"));
                    setCopiedLogs(true);
                    setTimeout(() => setCopiedLogs(false), 1500);
                  }}
                  className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200 hover:bg-zinc-700"
                >
                  {copiedLogs ? <Check className="size-2.5" /> : <Copy className="size-2.5" />}
                  {copiedLogs ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <pre className="max-h-36 overflow-y-auto rounded border border-zinc-800/80 bg-zinc-950/90 p-2 font-mono text-[10px] leading-relaxed text-zinc-300">
              {displayedLogs.length > 0
                ? displayedLogs.join("\n")
                : "Waiting for worker heartbeat logs..."}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
