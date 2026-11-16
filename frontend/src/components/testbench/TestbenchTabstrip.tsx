"use client";

import React from "react";
import {
  Wrench,
  FileCode,
  Cpu,
  GitGraph,
  Search,
  CheckCircle2,
} from "lucide-react";
import type { TestbenchTabId } from "./TestbenchNavRail";

interface TestbenchTabstripProps {
  activeTab: TestbenchTabId;
  onSelectTab: (tab: TestbenchTabId) => void;
}

interface TabCheckpoint {
  id: TestbenchTabId;
  step: string;
  shortLabel: string;
  midLabel: string;
  fullLabel: string;
  tag: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CHECKPOINTS: TabCheckpoint[] = [
  {
    id: "tab0",
    step: "0",
    shortLabel: "Plumbing",
    midLabel: "Plumbing",
    fullLabel: "Plumbing & Lake",
    tag: "R2 & Schemas",
    icon: Wrench,
  },
  {
    id: "tab1",
    step: "1",
    shortLabel: "Parser",
    midLabel: "Parser AST",
    fullLabel: "Parser Inspector",
    tag: "Dual-Span AST",
    icon: FileCode,
  },
  {
    id: "tab2",
    step: "2",
    shortLabel: "Swarm",
    midLabel: "VM Swarm",
    fullLabel: "Swarm & Extraction",
    tag: "3-Col Stream",
    icon: Cpu,
  },
  {
    id: "tab3",
    step: "3",
    shortLabel: "Graph",
    midLabel: "Graph & Time",
    fullLabel: "Graph & Timeline",
    tag: "Dual Clock",
    icon: GitGraph,
  },
  {
    id: "tab4",
    step: "4",
    shortLabel: "RAG",
    midLabel: "Hybrid RAG",
    fullLabel: "Hybrid RAG Workbench",
    tag: "Safe SQL & BM25",
    icon: Search,
  },
  {
    id: "tab5",
    step: "5",
    shortLabel: "Scorecard",
    midLabel: "Scorecard",
    fullLabel: "E2E & Scorecard",
    tag: "15 Invariants",
    icon: CheckCircle2,
  },
];

export function TestbenchTabstrip({
  activeTab,
  onSelectTab,
}: TestbenchTabstripProps) {
  return (
    <nav
      aria-label="Testbench Checkpoints"
      className="flex h-10 w-full shrink-0 items-center border-b border-zinc-800 bg-[#09090b] px-2 sm:px-3 select-none overflow-x-auto"
    >
      <div className="grid grid-cols-6 w-full gap-1 sm:gap-1.5 min-w-[580px]">
        {CHECKPOINTS.map((cp) => {
          const isActive = activeTab === cp.id;
          const Icon = cp.icon;

          return (
            <button
              key={cp.id}
              type="button"
              onClick={() => onSelectTab(cp.id)}
              className={`group relative flex h-7 sm:h-8 items-center justify-center gap-1 sm:gap-1.5 rounded-md px-1 sm:px-2 text-xs font-semibold transition-all w-full truncate ${
                isActive
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/80 border border-transparent"
              }`}
            >
              {/* Step Number Badge */}
              <div
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                  isActive
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-zinc-800 text-zinc-400 group-hover:text-zinc-200"
                }`}
              >
                {cp.step}
              </div>

              {/* Checkpoint Icon */}
              <Icon
                className={`h-3.5 w-3.5 shrink-0 ${
                  isActive
                    ? "text-amber-400"
                    : "text-zinc-400 group-hover:text-zinc-200"
                }`}
              />

              {/* Responsive Text Label */}
              <span className="truncate lg:hidden">{cp.shortLabel}</span>
              <span className="truncate hidden lg:inline 2xl:hidden">{cp.midLabel}</span>
              <span className="truncate hidden 2xl:inline">{cp.fullLabel}</span>

              {/* Tag for Ultra-wide screens */}
              <span
                className={`hidden 2xl:inline text-[9px] font-mono px-1 rounded truncate shrink-0 ${
                  isActive
                    ? "text-amber-300/80 bg-amber-500/10"
                    : "text-zinc-500 group-hover:text-zinc-400"
                }`}
              >
                {cp.tag}
              </span>

              {/* Active bottom glow line */}
              {isActive && (
                <div className="absolute inset-x-2 -bottom-[1px] h-[2px] bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
