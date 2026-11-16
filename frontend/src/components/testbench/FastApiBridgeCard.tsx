"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Database,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Terminal,
  XCircle,
} from "lucide-react";

export interface HealthResponsePayload {
  status?: string;
  ok?: boolean;
  schema_version?: string;
  version?: string;
  contract_hash?: string;
  sqlite_fts5?: boolean | string | Record<string, unknown>;
  fts5_enabled?: boolean | string;
  sqlite_fts5_status?: string;
  vram_coordinator?: boolean | string | Record<string, unknown>;
  vram_status?: string;
  dependencies?: Record<string, { status?: string; detail?: string; latency_ms?: number }>;
  subsystems?: Record<string, unknown>;
  checks?: Record<string, unknown>;
  timestamp?: string;
  trace_id?: string;
  [key: string]: unknown;
}

export interface EchoValidateResponsePayload {
  echo?: string;
  echoed_text?: string;
  text?: string;
  normalized_text?: string;
  nfc_text?: string;
  code_point_length?: number;
  codepoint_length?: number;
  code_points?: number;
  char_length?: number;
  python_len?: number;
  utf16_unit_length?: number;
  utf16_units?: number;
  utf16_code_units?: number;
  utf16_length?: number;
  utf8_byte_length?: number;
  utf8_bytes?: number;
  byte_length?: number;
  full_span?: { codepoint_start: number; codepoint_end: number; utf16_start: number; utf16_end: number };
  is_nfc?: boolean;
  nfc_normalized?: boolean;
  parity_ok?: boolean;
  verified?: boolean;
  trace_id?: string;
  [key: string]: unknown;
}

interface ClientUnicodeMetrics {
  codePoints: number;
  utf16Units: number;
  utf8Bytes: number;
  surrogateDelta: number;
  isNfc: boolean;
}

interface SubsystemStatus {
  healthy: boolean;
  label: string;
  detail: string;
}

const UNICODE_PRESETS: Array<{ label: string; sample: string }> = [
  {
    label: "Polyglot + Astral",
    sample: "«Café ☕ — 𝄞 Scriptoria 🚀 नमस्ते»",
  },
  {
    label: "Fiction Typography",
    sample: "“Wait—what’s in the résumé?” she whispered… ‘Nothing.’",
  },
  {
    label: "Surrogate Pairs (Emoji/Music)",
    sample: "🚀✨🐉 Musical G-Clef: 𝄞 | Math: 𝕏𝕐ℤ",
  },
  {
    label: "Devanagari + CJK",
    sample: "नमस्ते दुनिया —「東京タワー」テスト",
  },
];

function computeClientUnicodeMetrics(input: string): ClientUnicodeMetrics {
  const codePoints = Array.from(input).length;
  const utf16Units = input.length;
  const utf8Bytes = new TextEncoder().encode(input).byteLength;
  const surrogateDelta = utf16Units - codePoints;
  const isNfc = input.normalize("NFC") === input;

  return {
    codePoints,
    utf16Units,
    utf8Bytes,
    surrogateDelta,
    isNfc,
  };
}

function unwrapResponse<T>(
  rawJson: unknown,
  headers: Headers
): { data: T | null; traceId: string | null; error: string | null } {
  const headerTraceId =
    headers.get("x-trace-id") ||
    headers.get("X-Trace-ID") ||
    headers.get("x-request-id");

  if (rawJson && typeof rawJson === "object") {
    const obj = rawJson as Record<string, unknown>;
    const nested =
      "data" in obj && obj.data && typeof obj.data === "object"
        ? (obj.data as Record<string, unknown>)
        : null;

    const bodyTraceId =
      (typeof obj.trace_id === "string" && obj.trace_id) ||
      (typeof obj.traceId === "string" && obj.traceId) ||
      (nested && typeof nested.trace_id === "string" && nested.trace_id) ||
      (nested && typeof nested.traceId === "string" && nested.traceId) ||
      null;

    const traceId = headerTraceId || bodyTraceId || null;

    let errorMsg: string | null = null;
    if (typeof obj.error === "string") {
      errorMsg = obj.error;
    } else if (
      obj.error &&
      typeof obj.error === "object" &&
      "message" in (obj.error as Record<string, unknown>)
    ) {
      errorMsg = String((obj.error as Record<string, unknown>).message);
    } else if (typeof obj.detail === "string") {
      errorMsg = obj.detail;
    } else if (Array.isArray(obj.detail)) {
      errorMsg = obj.detail
        .map((item) =>
          item && typeof item === "object" && "msg" in item
            ? String((item as Record<string, unknown>).msg)
            : JSON.stringify(item)
        )
        .join("; ");
    }

    if (nested) {
      return { data: nested as unknown as T, traceId, error: errorMsg };
    }

    return { data: obj as unknown as T, traceId, error: errorMsg };
  }

  return {
    data: null,
    traceId: headerTraceId || null,
    error: "Invalid JSON response from bridge",
  };
}

function resolveSubsystemStatus(
  payload: HealthResponsePayload | null,
  keys: string[],
  fallbackName: string
): SubsystemStatus {
  if (!payload) {
    return {
      healthy: false,
      label: "UNAVAILABLE",
      detail: `${fallbackName} telemetry not loaded`,
    };
  }

  // Check structured dependencies object from FastAPI SystemHealthResponse
  if (payload.dependencies && typeof payload.dependencies === "object") {
    for (const key of keys) {
      if (key in payload.dependencies) {
        const dep = payload.dependencies[key];
        const isHealthy = dep?.status === "healthy";
        return {
          healthy: isHealthy,
          label: (dep?.status || "UNKNOWN").toUpperCase(),
          detail: dep?.detail || `${key}: ${dep?.status}`,
        };
      }
    }
  }

  const searchContainers: Array<Record<string, unknown>> = [payload];
  if (payload.subsystems && typeof payload.subsystems === "object") {
    searchContainers.push(payload.subsystems as Record<string, unknown>);
  }
  if (payload.checks && typeof payload.checks === "object") {
    searchContainers.push(payload.checks as Record<string, unknown>);
  }

  for (const container of searchContainers) {
    for (const key of keys) {
      if (key in container && container[key] !== undefined) {
        const val = container[key];
        if (typeof val === "boolean") {
          return {
            healthy: val,
            label: val ? "ONLINE / READY" : "OFFLINE",
            detail: `${key}: ${String(val)}`,
          };
        }
        if (typeof val === "string") {
          const norm = val.toLowerCase();
          const healthy =
            norm === "ok" ||
            norm === "ready" ||
            norm === "healthy" ||
            norm === "online" ||
            norm === "enabled" ||
            norm === "active" ||
            norm === "idle";
          return {
            healthy,
            label: val.toUpperCase(),
            detail: `${key}: "${val}"`,
          };
        }
      }
    }
  }

  const overallHealthy =
    payload.ok === true ||
    String(payload.status ?? "").toLowerCase() === "ok" ||
    String(payload.status ?? "").toLowerCase() === "healthy";

  return {
    healthy: overallHealthy,
    label: overallHealthy ? "READY" : "UNKNOWN",
    detail: overallHealthy
      ? "Verified via primary health probe"
      : "No subsystem key reported",
  };
}

export function FastApiBridgeCard() {
  const [healthLoading, setHealthLoading] = useState<boolean>(true);
  const [healthData, setHealthData] = useState<HealthResponsePayload | null>(
    null
  );
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLatencyMs, setHealthLatencyMs] = useState<number | null>(null);
  const [healthTraceId, setHealthTraceId] = useState<string | null>(null);
  const [copiedHealthTrace, setCopiedHealthTrace] = useState<boolean>(false);

  const [probeText, setProbeText] = useState<string>(
    UNICODE_PRESETS[0].sample
  );
  const [probeLoading, setProbeLoading] = useState<boolean>(false);
  const [probeResult, setProbeResult] =
    useState<EchoValidateResponsePayload | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probeLatencyMs, setProbeLatencyMs] = useState<number | null>(null);
  const [probeTraceId, setProbeTraceId] = useState<string | null>(null);
  const [copiedProbeTrace, setCopiedProbeTrace] = useState<boolean>(false);
  const [isProbeExpanded, setIsProbeExpanded] = useState<boolean>(true);

  const clientMetrics = useMemo(
    () => computeClientUnicodeMetrics(probeText),
    [probeText]
  );

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    const t0 = performance.now();

    try {
      const res = await fetch("/api/testbench/health", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const elapsed = Math.round(performance.now() - t0);
      setHealthLatencyMs(elapsed);

      const rawJson: unknown = await res.json().catch(() => null);
      const { data, traceId, error } = unwrapResponse<HealthResponsePayload>(
        rawJson,
        res.headers
      );

      if (traceId) setHealthTraceId(traceId);

      if (!res.ok || !data) {
        setHealthError(error || `HTTP ${res.status} (${res.statusText})`);
        setHealthData(null);
        return;
      }

      setHealthData(data);
    } catch (err) {
      setHealthError(
        err instanceof Error ? err.message : "Failed to reach /api/testbench/health"
      );
      setHealthData(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  const runUnicodeProbe = useCallback(async () => {
    setProbeLoading(true);
    setProbeError(null);
    const t0 = performance.now();

    try {
      const res = await fetch("/api/testbench/echo-validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: probeText,
          metadata: { client_test: true },
        }),
      });

      const elapsed = Math.round(performance.now() - t0);
      setProbeLatencyMs(elapsed);

      const rawJson: unknown = await res.json().catch(() => null);
      const { data, traceId, error } =
        unwrapResponse<EchoValidateResponsePayload>(rawJson, res.headers);

      if (traceId) setProbeTraceId(traceId);

      if (!res.ok || !data) {
        setProbeError(error || `HTTP ${res.status} (${res.statusText})`);
        setProbeResult(null);
        return;
      }

      setProbeResult(data);
    } catch (err) {
      setProbeError(
        err instanceof Error
          ? err.message
          : "Network error calling /api/testbench/echo-validate"
      );
      setProbeResult(null);
    } finally {
      setProbeLoading(false);
    }
  }, [probeText]);

  const sqliteStatus = useMemo(
    () =>
      resolveSubsystemStatus(
        healthData,
        ["sqlite_fts", "sqlite_fts5", "fts5_enabled", "fts5"],
        "SQLite FTS5"
      ),
    [healthData]
  );

  const vramStatus = useMemo(
    () =>
      resolveSubsystemStatus(
        healthData,
        ["vram_coordinator", "vram_status", "vram"],
        "VRAM Coordinator"
      ),
    [healthData]
  );

  const serverMetrics = useMemo(() => {
    if (!probeResult) return null;

    const codePoints =
      probeResult.codepoint_length ??
      probeResult.code_point_length ??
      clientMetrics.codePoints;

    const utf16Units =
      probeResult.utf16_length ??
      probeResult.utf16_unit_length ??
      clientMetrics.utf16Units;

    const utf8Bytes =
      probeResult.utf8_byte_length ??
      probeResult.utf8_bytes ??
      clientMetrics.utf8Bytes;

    const echoedText =
      probeResult.echoed_text ??
      probeResult.echo ??
      probeResult.text ??
      probeText;

    const parityMatch =
      codePoints === clientMetrics.codePoints &&
      utf16Units === clientMetrics.utf16Units &&
      utf8Bytes === clientMetrics.utf8Bytes;

    return {
      codePoints,
      utf16Units,
      utf8Bytes,
      echoedText,
      parityMatch,
    };
  }, [probeResult, clientMetrics, probeText]);

  const copyText = async (
    value: string | null,
    setter: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch {
      // Ignore error
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-5 shadow-lg">
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              FastAPI Bridge &amp; Unicode Parity Probe
            </h3>
            <p className="text-xs text-zinc-400">
              Live telemetry for SQLite FTS5, VRAM Coordinator, and Python↔JS
              UTF-16/UTF-8 offset parity
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          {healthLatencyMs !== null && (
            <span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-400">
              {healthLatencyMs} ms
            </span>
          )}
          {healthTraceId && (
            <button
              type="button"
              onClick={() => void copyText(healthTraceId, setCopiedHealthTrace)}
              title={`Copy Health X-Trace-ID: ${healthTraceId}`}
              className="inline-flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-zinc-300 hover:border-zinc-700 hover:text-white"
            >
              <span className="text-zinc-500">Trace:</span>
              <span className="text-sky-300">{healthTraceId.slice(0, 8)}</span>
              {copiedHealthTrace ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3 text-zinc-400" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => void fetchHealth()}
            disabled={healthLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${healthLoading ? "animate-spin" : ""}`}
            />
            <span>Refresh Health</span>
          </button>
        </div>
      </div>

      {/* Section 1: Subsystem Health Indicators */}
      <div className="mt-4">
        {healthError && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-950/40 p-3.5 text-xs text-amber-200">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <Activity className="h-4 w-4 shrink-0 text-amber-400" />
              <span>FastAPI Backend Bridge Status</span>
            </div>
            <p className="text-zinc-300">
              <strong>Health Notice:</strong> {healthError}
            </p>
            <div className="mt-1 flex flex-col gap-1 rounded bg-zinc-950/80 p-2 font-mono text-[11px] text-zinc-400 border border-zinc-800">
              <div>
                <span className="text-amber-400 font-semibold">Local Run:</span>{" "}
                <code>python -m uvicorn app.main:app --app-dir backend --port 8000 --reload</code>
              </div>
              <div>
                <span className="text-amber-400 font-semibold">Vercel/Remote:</span> Configure{" "}
                <code>SCRIPTORIA_FASTAPI_URL</code> to point to your live Cloudflare / Kaggle VM tunnel.
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* SQLite FTS5 Indicator */}
          <div className="flex items-start justify-between rounded-lg border border-zinc-800/90 bg-zinc-900/50 p-3.5">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 rounded-md p-2 ${
                  sqliteStatus.healthy
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                }`}
              >
                <Database className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-medium text-zinc-200">
                  SQLite FTS5 Lexical Index
                </div>
                <div className="mt-0.5 text-[11px] font-mono text-zinc-400 break-all">
                  {healthLoading ? "Checking FTS5 virtual tables…" : sqliteStatus.detail}
                </div>
              </div>
            </div>

            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-mono font-medium ${
                healthLoading
                  ? "bg-zinc-800 text-zinc-400"
                  : sqliteStatus.healthy
                    ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/40"
                    : "bg-amber-950/80 text-amber-300 border border-amber-500/40"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  healthLoading
                    ? "bg-zinc-400 animate-pulse"
                    : sqliteStatus.healthy
                      ? "bg-emerald-400"
                      : "bg-amber-400"
                }`}
              />
              {healthLoading ? "PROBING" : sqliteStatus.label}
            </span>
          </div>

          {/* VRAM Coordinator Indicator */}
          <div className="flex items-start justify-between rounded-lg border border-zinc-800/90 bg-zinc-900/50 p-3.5">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 rounded-md p-2 ${
                  vramStatus.healthy
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                }`}
              >
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-medium text-zinc-200">
                  VRAM Coordinator
                </div>
                <div className="mt-0.5 text-[11px] font-mono text-zinc-400 break-all">
                  {healthLoading
                    ? "Querying GPU/TPU memory arbiter…"
                    : vramStatus.detail}
                </div>
              </div>
            </div>

            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-mono font-medium ${
                healthLoading
                  ? "bg-zinc-800 text-zinc-400"
                  : vramStatus.healthy
                    ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/40"
                    : "bg-amber-950/80 text-amber-300 border border-amber-500/40"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  healthLoading
                    ? "bg-zinc-400 animate-pulse"
                    : vramStatus.healthy
                      ? "bg-emerald-400"
                      : "bg-amber-400"
                }`}
              />
              {healthLoading ? "PROBING" : vramStatus.label}
            </span>
          </div>
        </div>
      </div>

      {/* Section 2: Interactive Unicode & UTF-16 Parity Probe */}
      <div className="mt-4 border-t border-zinc-800/80 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <button
            type="button"
            onClick={() => setIsProbeExpanded((prev) => !prev)}
            className="flex items-center gap-2 group text-left hover:opacity-80 transition cursor-pointer"
          >
            <Sparkles className="h-4 w-4 text-amber-400" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
              Interactive Unicode &amp; UTF-16 Parity Probe
            </h4>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 group-hover:text-zinc-200 transition">
              {isProbeExpanded ? "Collapse" : "Expand"}
            </span>
          </button>

          {isProbeExpanded && (
            <div className="flex flex-wrap items-center gap-1.5">
              {UNICODE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setProbeText(preset.sample)}
                  className="rounded border border-zinc-800 bg-zinc-900/90 px-2 py-0.5 text-[11px] text-zinc-300 transition hover:border-sky-500/50 hover:text-sky-300"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {isProbeExpanded && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <input
                type="text"
                value={probeText}
                onChange={(e) => setProbeText(e.target.value)}
                placeholder="Enter multi-script text, emojis, or smart typography to test offset parity…"
                className="flex-1 rounded-lg border border-zinc-700/90 bg-zinc-900 px-3.5 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void runUnicodeProbe()}
                disabled={probeLoading || probeText.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {probeLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                <span>Test Unicode &amp; UTF-16 Parity</span>
              </button>
            </div>

            {/* Real-Time Client Length Metrics */}
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Unicode Code Points</span>
                  <span className="font-mono text-[10px] text-zinc-500">
                    Python len(s)
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-xl font-bold font-mono text-emerald-400">
                    {clientMetrics.codePoints}
                  </span>
                  <span className="text-[11px] text-zinc-400">codepoints</span>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>UTF-16 Code Units</span>
                  <span className="font-mono text-[10px] text-zinc-500">
                    JS s.length
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-xl font-bold font-mono text-sky-400">
                    {clientMetrics.utf16Units}
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    units{" "}
                    {clientMetrics.surrogateDelta > 0 && (
                      <span className="text-amber-400">
                        (+{clientMetrics.surrogateDelta} surrogate)
                      </span>
                    )}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>UTF-8 Wire Bytes</span>
                  <span className="font-mono text-[10px] text-zinc-500">
                    TextEncoder
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-xl font-bold font-mono text-purple-400">
                    {clientMetrics.utf8Bytes}
                  </span>
                  <span className="text-[11px] text-zinc-400">bytes</span>
                </div>
              </div>
            </div>

            {/* Server Response Display */}
            {probeError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/50 px-3.5 py-2.5 text-xs text-red-200">
                <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                <span>
                  <strong>Echo-Validate Error:</strong> {probeError}
                </span>
              </div>
            )}

            {serverMetrics && (
              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    {serverMetrics.parityMatch ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/70 px-2.5 py-0.5 font-mono text-[11px] text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        PARITY VERIFIED (Client == FastAPI)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-950/70 px-2.5 py-0.5 font-mono text-[11px] text-amber-300">
                        <XCircle className="h-3.5 w-3.5 text-amber-400" />
                        OFFSET DRIFT DETECTED
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    {probeLatencyMs !== null && (
                      <span className="text-zinc-400">{probeLatencyMs} ms</span>
                    )}
                    {probeTraceId && (
                      <button
                        type="button"
                        onClick={() => void copyText(probeTraceId, setCopiedProbeTrace)}
                        className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-zinc-300 hover:border-zinc-600"
                      >
                        <Terminal className="h-3 w-3 text-sky-400" />
                        <span>{probeTraceId.slice(0, 8)}</span>
                        {copiedProbeTrace ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3 text-zinc-400" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 grid grid-cols-3 gap-2 font-mono text-[11px]">
                  <div className="rounded bg-zinc-950/70 p-2">
                    <div className="text-zinc-500">Backend Code Points</div>
                    <div className="mt-0.5 text-sm font-semibold text-emerald-300">
                      {serverMetrics.codePoints}{" "}
                      <span className="text-[10px] text-zinc-500">
                        (Client: {clientMetrics.codePoints})
                      </span>
                    </div>
                  </div>
                  <div className="rounded bg-zinc-950/70 p-2">
                    <div className="text-zinc-500">Backend UTF-16 Units</div>
                    <div className="mt-0.5 text-sm font-semibold text-sky-300">
                      {serverMetrics.utf16Units}{" "}
                      <span className="text-[10px] text-zinc-500">
                        (Client: {clientMetrics.utf16Units})
                      </span>
                    </div>
                  </div>
                  <div className="rounded bg-zinc-950/70 p-2">
                    <div className="text-zinc-500">Backend UTF-8 Bytes</div>
                    <div className="mt-0.5 text-sm font-semibold text-purple-300">
                      {serverMetrics.utf8Bytes}{" "}
                      <span className="text-[10px] text-zinc-500">
                        (Client: {clientMetrics.utf8Bytes})
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default FastApiBridgeCard;
