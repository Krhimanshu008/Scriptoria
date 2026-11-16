"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { EXPECTED_CONTRACT_HASH } from "@/types/testbench-contracts";

export interface ContractsPayload {
  schema_version?: string;
  version?: string;
  contract_hash?: string;
  models?: Record<string, unknown>;
  schemas?: Record<string, unknown>;
  trace_id?: string;
}

export interface ContractHashBadgeProps {
  expectedHash?: string;
  className?: string;
  onTraceIdChange?: (traceId: string | null) => void;
}

interface UnwrappedResponse<T> {
  data: T | null;
  traceId: string | null;
  error: string | null;
}

function unwrapBridgeResponse<T>(
  rawJson: unknown,
  headers: Headers
): UnwrappedResponse<T> {
  const headerTraceId =
    headers.get("x-trace-id") ||
    headers.get("X-Trace-ID") ||
    headers.get("x-request-id");

  if (rawJson && typeof rawJson === "object") {
    const obj = rawJson as Record<string, unknown>;
    const nestedData =
      "data" in obj && obj.data && typeof obj.data === "object"
        ? (obj.data as Record<string, unknown>)
        : null;

    const bodyTraceId =
      (typeof obj.trace_id === "string" && obj.trace_id) ||
      (typeof obj.traceId === "string" && obj.traceId) ||
      (nestedData &&
        typeof nestedData.trace_id === "string" &&
        nestedData.trace_id) ||
      (nestedData &&
        typeof nestedData.traceId === "string" &&
        nestedData.traceId) ||
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

    if (nestedData) {
      return {
        data: nestedData as unknown as T,
        traceId,
        error: errorMsg,
      };
    }

    return {
      data: obj as unknown as T,
      traceId,
      error: errorMsg,
    };
  }

  return {
    data: null,
    traceId: headerTraceId || null,
    error: "Invalid JSON payload from /api/testbench/contracts",
  };
}

export function ContractHashBadge({
  expectedHash = EXPECTED_CONTRACT_HASH,
  className = "",
  onTraceIdChange,
}: ContractHashBadgeProps) {
  const [status, setStatus] = useState<
    "loading" | "verified" | "drift" | "error"
  >("loading");
  const [actualHash, setActualHash] = useState<string | null>(null);
  const [schemaVersion, setSchemaVersion] = useState<string>("1.0.0");
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [copiedTrace, setCopiedTrace] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);

  const verifyContracts = useCallback(async () => {
    setStatus("loading");
    setErrorDetail(null);

    try {
      const res = await fetch("/api/testbench/contracts", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      const rawJson: unknown = await res.json().catch(() => null);
      const { data, traceId: resolvedTraceId, error } =
        unwrapBridgeResponse<ContractsPayload>(rawJson, res.headers);

      if (resolvedTraceId) {
        setTraceId(resolvedTraceId);
        onTraceIdChange?.(resolvedTraceId);
      }

      if (!res.ok || !data) {
        setStatus("error");
        setErrorDetail(error || `HTTP ${res.status} (${res.statusText})`);
        return;
      }

      const returnedHash =
        typeof data.contract_hash === "string" ? data.contract_hash.trim() : "";
      const returnedVersion =
        typeof data.schema_version === "string"
          ? data.schema_version
          : typeof data.version === "string"
            ? data.version
            : "1.0.0";

      const schemasObj = data.models || data.schemas;
      if (schemasObj && typeof schemasObj === "object") {
        setModelCount(Object.keys(schemasObj).length);
      }

      setActualHash(returnedHash || null);
      setSchemaVersion(returnedVersion);

      if (!returnedHash) {
        setStatus("error");
        setErrorDetail("Response missing contract_hash field");
        return;
      }

      if (returnedHash.toLowerCase() === expectedHash.toLowerCase()) {
        setStatus("verified");
      } else {
        setStatus("drift");
      }
    } catch (err) {
      setStatus("error");
      setErrorDetail(
        err instanceof Error ? err.message : "Network error fetching contracts"
      );
    }
  }, [expectedHash, onTraceIdChange]);

  useEffect(() => {
    void verifyContracts();
  }, [verifyContracts]);

  const handleCopyTraceId = async () => {
    if (!traceId) return;
    try {
      await navigator.clipboard.writeText(traceId);
      setCopiedTrace(true);
      setTimeout(() => setCopiedTrace(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const handleCopyFullHash = async () => {
    const hashToCopy = actualHash || expectedHash;
    try {
      await navigator.clipboard.writeText(hashToCopy);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const shortActual = actualHash ? actualHash.slice(0, 8) : "unknown";
  const shortExpected = expectedHash.slice(0, 8);
  const shortTrace = traceId
    ? traceId.length > 12
      ? `${traceId.slice(0, 8)}…${traceId.slice(-4)}`
      : traceId
    : "—";

  const tooltipSummary =
    status === "verified"
      ? `Full Hash: ${actualHash}\nSchema Version: v${schemaVersion}${
          modelCount !== null ? `\nModels Registered: ${modelCount}` : ""
        }`
      : status === "drift"
        ? `Contract Drift Detected!\nActual: ${actualHash}\nExpected: ${expectedHash}\nSchema Version: v${schemaVersion}`
        : `Contract Check Error: ${errorDetail || "Unknown error"}`;

  return (
    <div
      className={`inline-flex flex-nowrap items-center gap-2 text-xs font-mono shrink-0 ${className}`}
    >
      {/* Contract Hash Status Pill with Hover Tooltip */}
      <div className="relative group shrink-0">
        {status === "loading" && (
          <div
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/90 px-3 py-1 text-zinc-300 shadow-sm shrink-0"
            title="Fetching /api/testbench/contracts..."
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
            <span>Verifying Contract Hash…</span>
          </div>
        )}

        {status === "verified" && (
          <button
            type="button"
            onClick={handleCopyFullHash}
            title={tooltipSummary}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-3 py-1 text-emerald-300 shadow-sm transition-colors hover:border-emerald-400/70 hover:bg-emerald-950/80 shrink-0 text-xs"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>
              Contract Hash: <strong className="font-mono font-semibold">{shortActual}</strong>{" "}
              <span className="text-emerald-400/90">(Verified)</span>
            </span>
          </button>
        )}

        {status === "drift" && (
          <button
            type="button"
            onClick={handleCopyFullHash}
            title={tooltipSummary}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/60 bg-amber-950/75 px-3 py-1 text-amber-200 shadow-sm transition-colors hover:border-red-400 hover:bg-red-950/80 shrink-0 text-xs"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span>
              Contract Drift: <strong>{shortActual}</strong> != {shortExpected}
            </span>
          </button>
        )}

        {status === "error" && (
          <button
            type="button"
            onClick={() => void verifyContracts()}
            title={tooltipSummary}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-500/50 bg-red-950/70 px-3 py-1 text-red-300 shadow-sm transition-colors hover:border-red-400 shrink-0 text-xs"
          >
            <ShieldAlert className="h-3.5 w-3.5 text-red-400 shrink-0" />
            <span>FastAPI Offline</span>
          </button>
        )}

        {/* Hover Popover Tooltip */}
        {status !== "loading" && (
          <div className="pointer-events-none invisible absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-zinc-700/90 bg-zinc-950/95 p-3 text-[11px] text-zinc-200 opacity-0 shadow-xl backdrop-blur-md transition-all duration-150 group-hover:visible group-hover:opacity-100">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-2">
              <span className="font-semibold text-zinc-100">
                Pydantic v2 Contract Manifest
              </span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-sky-300">
                v{schemaVersion}
              </span>
            </div>

            {status === "error" ? (
              <p className="text-red-400 break-words">{errorDetail}</p>
            ) : (
              <div className="space-y-1.5">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                    Active Backend Hash
                  </div>
                  <div className="break-all font-mono text-emerald-300">
                    {actualHash}
                  </div>
                </div>
                {status === "drift" && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                      Expected Frontend Hash
                    </div>
                    <div className="break-all font-mono text-amber-300">
                      {expectedHash}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1 text-[10px] text-zinc-400">
                  <span>
                    {modelCount !== null
                      ? `${modelCount} strict schema models`
                      : "SHA-256 verified"}
                  </span>
                  <span>{copiedHash ? "Copied full hash!" : "Click pill to copy"}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Click-to-Copy X-Trace-ID Pill */}
      <button
        type="button"
        onClick={handleCopyTraceId}
        disabled={!traceId}
        title={
          traceId
            ? `Click to copy X-Trace-ID: ${traceId}`
            : "No active X-Trace-ID yet"
        }
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800/90 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
      >
        <span className="text-zinc-500">X-Trace-ID:</span>
        <span className="text-sky-300 font-mono">{shortTrace}</span>
        {copiedTrace ? (
          <Check className="h-3 w-3 text-emerald-400" />
        ) : (
          <Copy className="h-3 w-3 text-zinc-400" />
        )}
      </button>

      {/* Manual Re-verify Trigger */}
      <button
        type="button"
        onClick={() => void verifyContracts()}
        disabled={status === "loading"}
        title="Re-verify contract hash"
        className="inline-flex items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/70 p-1.5 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50 shrink-0"
      >
        <RefreshCw
          className={`h-3 w-3 ${status === "loading" ? "animate-spin" : ""}`}
        />
      </button>
    </div>
  );
}

export default ContractHashBadge;
