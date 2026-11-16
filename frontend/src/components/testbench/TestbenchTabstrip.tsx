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

const CHECKPOINTS: Array<{
  id: TestbenchTabId;
  step: string;
  label: string;
  tag: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "tab0",
    step: "0",
    label: "Plumbing & Contracts",
    tag: "R2 & Schemas",
    icon: Wrench,
  },
  {
    id: "tab1",
    step: "1",
    label: "Parser Inspector",
    tag: "Dual-Span AST",
    icon: FileCode,
  },
  {
    id: "tab2",
    step: "2",
    label: "VM Swarm & Extraction",
    tag: "3-Col Stream",
    icon: Cpu,
  },
  {
    id: "tab3",
    step: "3",
    label: "Graph & Timeline Studio",
    tag: "Dual Clock & Graph",
    icon: GitGraph,
  },
  {
    id: "tab4",
    step: "4",
    label: "Hybrid RAG Workbench",
    tag: "Safe SQL & BM25",
    icon: Search,
  },
  {
    id: "tab5",
    step: "5",
    label: "E2E Stepper & Scorecard",
    tag: "15 Invariant Checks",
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
      className="flex h-11 w-full shrink-0 items-center gap-1.5 border-b border-zinc-800/90 bg-[#09090b] px-3 sm:px-4 overflow-x-auto no-scrollbar select-none"
    >
      <div className="flex items-center gap-1.5 min-w-max">
        {CHECKPOINTS.map((cp) => {
          const isActive = activeTab === cp.id;
          const Icon = cp.icon;

          return (
            <button
              key={cp.id}
              type="button"
              onClick={() => onSelectTab(cp.id)}
              className={`group relative flex h-8 items-center gap-2 rounded-lg px-2.5 sm:px-3 text-xs font-semibold transition-all ${
                isActive
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/80 border border-transparent"
              }`}
            >
              <div
                className={`flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold ${
                  isActive
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-zinc-800 text-zinc-400 group-hover:text-zinc-200"
                }`}
              >
                {cp.step}
              </div>

              <Icon
                className={`h-3.5 w-3.5 ${
                  isActive
                    ? "text-amber-400"
                    : "text-zinc-400 group-hover:text-zinc-200"
                }`}
              />

              <span className="tracking-tight">{cp.label}</span>

              <span
                className={`hidden xl:inline text-[10px] font-mono px-1 rounded ${
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
