"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { DispatchLlmResult, LlmExecutionRoute } from "@/lib/llm/dispatch-llm";

export interface ActiveRequestState {
  id: string;
  label: string;
  startedAt: number;
  elapsedMs: number;
  hasImages: boolean;
  isJsonMode: boolean;
}

export interface SessionJsonCompliance {
  totalJsonCalls: number;
  validJsonCalls: number;
  compliancePct: number | null;
}

export interface ClientLastTurnMetrics {
  rawDecodeTokPerSec: number | null;
  prefillTokPerSec: number | null;
  effectiveTokPerSec: number | null;
  relayOverheadMs: number | null;
  cacheN: number | null;
  promptTokens: number | null;
  mtpAcceptancePct: number | null;
  mtpMeanTokensPerStep: number | null;
  visionEncodeMs: number | null;
  visionTokens: number | null;
  visionBypassed: boolean;
  executionRoute: LlmExecutionRoute;
  model: string;
  timestampMs: number;
}

interface LlmTelemetryContextValue {
  activeRequest: ActiveRequestState | null;
  lastTurn: ClientLastTurnMetrics | null;
  jsonCompliance: SessionJsonCompliance;
  beginRequest: (opts: { label: string; hasImages?: boolean; isJsonMode?: boolean }) => string;
  endRequest: (reqId: string, result?: DispatchLlmResult | null) => void;
  recordJsonOutcome: (isValid: boolean) => void;
  resetJsonCompliance: () => void;
}

const JSON_STATS_KEY = "scriptoria_llm_gbnf_compliance_v1";
const LlmTelemetryContext = createContext<LlmTelemetryContextValue | null>(null);

export function LlmTelemetryProvider({ children }: { children: React.ReactNode }) {
  const [activeRequest, setActiveRequest] = useState<ActiveRequestState | null>(null);
  const [lastTurn, setLastTurn] = useState<ClientLastTurnMetrics | null>(null);
  const [jsonCompliance, setJsonCompliance] = useState<SessionJsonCompliance>({
    totalJsonCalls: 0,
    validJsonCalls: 0,
    compliancePct: null,
  });
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      try {
        const raw = window.sessionStorage.getItem(JSON_STATS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as SessionJsonCompliance;
        if (typeof parsed.totalJsonCalls === "number") {
          setJsonCompliance(parsed);
        }
      } catch {
        // ignore storage access errors
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const activeReqId = activeRequest?.id ?? null;
  useEffect(() => {
    if (!activeReqId) return;
    const timer = window.setInterval(() => {
      setActiveRequest((cur) =>
        cur && cur.id === activeReqId ? { ...cur, elapsedMs: Date.now() - cur.startedAt } : cur
      );
    }, 100);
    return () => window.clearInterval(timer);
  }, [activeReqId]);

  const recordJsonOutcome = useCallback((isValid: boolean) => {
    setJsonCompliance((prev) => {
      const total = prev.totalJsonCalls + 1;
      const valid = prev.validJsonCalls + (isValid ? 1 : 0);
      const next: SessionJsonCompliance = {
        totalJsonCalls: total,
        validJsonCalls: valid,
        compliancePct: Math.round((valid / total) * 100),
      };
      try {
        window.sessionStorage.setItem(JSON_STATS_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write failures
      }
      return next;
    });
  }, []);

  const beginRequest = useCallback(
    (opts: { label: string; hasImages?: boolean; isJsonMode?: boolean }) => {
      const id = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      activeIdRef.current = id;
      setActiveRequest({
        id,
        label: opts.label,
        startedAt: Date.now(),
        elapsedMs: 0,
        hasImages: Boolean(opts.hasImages),
        isJsonMode: Boolean(opts.isJsonMode),
      });
      return id;
    },
    []
  );

  const endRequest = useCallback(
    (reqId: string, result?: DispatchLlmResult | null) => {
      if (activeIdRef.current === reqId) {
        activeIdRef.current = null;
        setActiveRequest(null);
      }
      if (!result) return;

      setLastTurn({
        rawDecodeTokPerSec: result.rawDecodeTokPerSec,
        prefillTokPerSec: result.prefillTokPerSec,
        effectiveTokPerSec: result.effectiveTokPerSec,
        relayOverheadMs: result.relayOverheadMs,
        cacheN: result.cacheN,
        promptTokens: result.promptTokens,
        mtpAcceptancePct: result.mtpStats?.acceptancePct ?? null,
        mtpMeanTokensPerStep: result.mtpStats?.meanTokensPerStep ?? null,
        visionEncodeMs: result.visionEncodeMs,
        visionTokens: result.visionTokens,
        visionBypassed: result.visionBypassed,
        executionRoute: result.executionRoute,
        model: result.model,
        timestampMs: Date.now(),
      });

      if (result.jsonValidation) {
        recordJsonOutcome(result.jsonValidation.isValidJson);
      }
    },
    [recordJsonOutcome]
  );

  const resetJsonCompliance = useCallback(() => {
    const empty = { totalJsonCalls: 0, validJsonCalls: 0, compliancePct: null };
    setJsonCompliance(empty);
    try {
      window.sessionStorage.removeItem(JSON_STATS_KEY);
    } catch {
      // ignore
    }
  }, []);

  return (
    <LlmTelemetryContext.Provider
      value={{
        activeRequest,
        lastTurn,
        jsonCompliance,
        beginRequest,
        endRequest,
        recordJsonOutcome,
        resetJsonCompliance,
      }}
    >
      {children}
    </LlmTelemetryContext.Provider>
  );
}

export function useLlmTelemetry(): LlmTelemetryContextValue {
  const ctx = useContext(LlmTelemetryContext);
  if (!ctx) {
    throw new Error("useLlmTelemetry must be used inside LlmTelemetryProvider");
  }
  return ctx;
}
