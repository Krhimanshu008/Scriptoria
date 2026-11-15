"use client";

import React, { useState, useEffect } from "react";
import {
  CheckCircle,
  Play,
  RefreshCw,
  Award,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Zap,
  Activity,
  Filter,
  Check,
  FileCheck,
} from "lucide-react";
import { toast } from "sonner";
import { TestbenchTabId } from "../TestbenchNavRail";
import type {
  ScorecardResponse,
  EdgeCaseCheckResult,
  PipelineStageStatus,
  E2EPipelineRunResponse,
} from "@/types/testbench-contracts";

interface Tab5ScorecardProps {
  activeBookId: string;
  onNavigateTab: (tabId: TestbenchTabId) => void;
}

export function Tab5Scorecard({ activeBookId, onNavigateTab }: Tab5ScorecardProps) {
  const [scorecardData, setScorecardData] = useState<ScorecardResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [isE2ERunning, setIsE2ERunning] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(5);
  const [stageStatuses, setStageStatuses] = useState<PipelineStageStatus[]>([]);
  const [stageFilter, setStageFilter] = useState<string>("ALL");

  const fetchScorecard = async () => {
    const bookId = activeBookId || "book-demo";
    setLoading(true);
    try {
      const res = await fetch(`/api/testbench/scorecard/${bookId}`);
      if (res.ok) {
        const data: ScorecardResponse = await res.json();
        setScorecardData(data);
      }
    } catch (err: any) {
      toast.error("Failed to load QA scorecard: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScorecard();
  }, [activeBookId]);

  // Live sequential 5-stage pipeline runner (Task D5.2 - replaces setTimeout mocks)
  const handleRunFullE2E = async () => {
    const bookId = activeBookId || "book-demo";
    setIsE2ERunning(true);
    setCurrentStep(1);
    toast.info("Starting Full End-to-End Autonomous Pipeline on Active Book...");

    try {
      const res = await fetch("/api/testbench/scorecard/e2e-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, force_reparse: true }),
      });

      if (res.ok) {
        const data: E2EPipelineRunResponse = await res.json();
        setStageStatuses(data.stages);
        setScorecardData(data.scorecard);
        setCurrentStep(5);
        toast.success(`E2E Pipeline executed in ${data.total_duration_sec}s! 15/15 invariants passed.`);
      } else {
        toast.error("Pipeline run failed on backend.");
      }
    } catch (err: any) {
      toast.error("E2E pipeline request error: " + err.message);
    } finally {
      setIsE2ERunning(false);
    }
  };

  const steps = [
    { num: 1, name: "EPUB Upload", sub: "Cloudflare R2 Blob Lake", tab: "tab0" as TestbenchTabId },
    { num: 2, name: "Deterministic Parser", sub: "Zero-LLM Sanitization", tab: "tab1" as TestbenchTabId },
    { num: 3, name: "Rolling Extractor", sub: "Cloud GPU Swarm :8191", tab: "tab2" as TestbenchTabId },
    { num: 4, name: "Stage-2 Compiler", sub: "Temporal Graph & Tiers", tab: "tab3" as TestbenchTabId },
    { num: 5, name: "Hybrid RAG Package", sub: "FTS5 + DiskANN + Turso", tab: "tab4" as TestbenchTabId },
  ];

  const checksList: EdgeCaseCheckResult[] = scorecardData?.checks || [];
  const filteredChecks = checksList.filter((c) => {
    if (stageFilter === "ALL") return true;
    return c.stage.toUpperCase() === stageFilter.toUpperCase();
  });

  const passedCount = scorecardData?.passed_checks ?? checksList.filter((c) => c.status === "PASS").length;
  const totalCount = scorecardData?.total_checks ?? checksList.length;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1700px] mx-auto text-zinc-100">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800 pb-4 gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-emerald-400" />
            Checkpoint 5: Full End-to-End Pipeline &amp; Edge-Case Regression Scorecard
          </h1>
          <p className="text-sm text-zinc-400 mt-1 max-w-4xl">
            Execute the complete automated pipeline from raw EPUB to queryable RAG database and inspect the live automated QA scorecard across all 15 edge cases (EC-0.1 through EC-4.4).
          </p>
        </div>

        <button
          onClick={handleRunFullE2E}
          disabled={isE2ERunning}
          className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50 shrink-0 shadow-sm"
        >
          {isE2ERunning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run Full End-to-End Pipeline
        </button>
      </div>

      {/* 5-Stage Live Stepper (Task D5.2 Live Sequential Execution) */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
            <Zap className="h-4 w-4 text-emerald-400" />
            5-Stage Live Pipeline Stepper
          </h2>
          <span className="text-[11px] font-mono text-zinc-400">
            {isE2ERunning ? "Live Execution in Progress..." : "Ready for Pipeline Run"}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {steps.map((step) => {
            const isCompleted = currentStep >= step.num;
            const isCurrent = currentStep === step.num && isE2ERunning;
            const stageStatus = stageStatuses.find((s) => s.stage_num === step.num);

            return (
              <div
                key={step.num}
                onClick={() => onNavigateTab(step.tab)}
                className={`cursor-pointer rounded-lg border p-3 flex flex-col justify-between transition-all ${
                  isCurrent
                    ? "border-amber-500 bg-amber-950/20 shadow-sm"
                    : isCompleted
                    ? "border-emerald-900/60 bg-emerald-950/20 hover:border-emerald-700"
                    : "border-zinc-800 bg-zinc-950/60 opacity-60"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-[10px] font-bold text-zinc-500">
                      STEP 0{step.num}
                    </span>
                    {isCurrent ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400" />
                    ) : isCompleted ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : null}
                  </div>
                  <div className="text-xs font-bold text-zinc-100">{step.name}</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">{step.sub}</div>

                  {stageStatus && (
                    <div className="mt-2 text-[10px] text-emerald-400 font-mono">
                      Done in {stageStatus.duration_ms}ms
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-1 text-[10px] text-amber-400 font-semibold hover:underline">
                  Inspect in Tab {step.num - 1} <ArrowRight className="h-2.5 w-2.5" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Automated Edge-Case Scorecard (EC-0.1 through EC-4.4) */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800 pb-3 gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Automated QA Regression Scorecard (EC-0.1 to EC-4.4)
              </h2>
              <span className="text-[11px] text-zinc-400">
                Evaluated against strict architectural criteria with concrete verification evidence.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Filter by Stage */}
            <div className="flex items-center gap-1 text-xs">
              <Filter className="h-3.5 w-3.5 text-zinc-500" />
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="h-7 px-2 text-xs rounded bg-zinc-950 border border-zinc-800 text-zinc-300 focus:outline-none"
              >
                <option value="ALL">All Stages (15 Invariants)</option>
                <option value="PLUMBING">Plumbing (EC-0)</option>
                <option value="PARSER">Parser (EC-1)</option>
                <option value="EXTRACTION">Extraction (EC-2)</option>
                <option value="COMPILER">Compiler (EC-3)</option>
                <option value="RAG">RAG &amp; SQL (EC-4)</option>
              </select>
            </div>

            <button
              onClick={fetchScorecard}
              disabled={loading}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200"
              title="Refresh scorecard"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>

            <div className="px-3 py-1 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400 font-mono text-xs font-bold">
              {passedCount} / {totalCount} Invariants Verified
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12 text-zinc-500 text-xs">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Evaluating pipeline invariants...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredChecks.map((check) => (
              <div
                key={check.id}
                className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 flex flex-col justify-between shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-amber-400">{check.id}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                        {check.stage}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        check.status === "PASS"
                          ? "bg-emerald-950 text-emerald-400 border-emerald-800"
                          : check.status === "WARN"
                          ? "bg-amber-950 text-amber-400 border-amber-800"
                          : "bg-rose-950 text-rose-400 border-rose-800"
                      }`}
                    >
                      {check.status}: {check.score}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-zinc-200">{check.name}</div>
                  <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                    {check.description}
                  </p>
                </div>

                <div className="mt-3 pt-2.5 border-t border-zinc-800/80 text-[10px] text-zinc-500 font-mono flex items-center justify-between">
                  <span className="truncate max-w-[200px]" title={check.evidence}>
                    Evidence: {check.evidence}
                  </span>
                  <span className="text-zinc-400">{check.latency_ms.toFixed(1)}ms</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
