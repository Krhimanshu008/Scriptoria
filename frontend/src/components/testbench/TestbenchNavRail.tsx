"use client";

import React from "react";
import {
  Wrench,
  FileText,
  Cpu,
  GitGraph,
  Search,
  CheckCircle,
} from "lucide-react";

export type TestbenchTabId = "tab0" | "tab1" | "tab2" | "tab3" | "tab4" | "tab5";

interface TestbenchNavRailProps {
  activeTab: TestbenchTabId;
  onSelectTab: (tab: TestbenchTabId) => void;
}

const TABS: Array<{
  id: TestbenchTabId;
  label: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}> = [
  {
    id: "tab0",
    label: "0. Plumbing & Contracts",
    sub: "R2, Supabase, Schemas & Tests",
    icon: Wrench,
  },
  {
    id: "tab1",
    label: "1. Parser Inspector",
    sub: "Zero-LLM Sanitization & Breaks",
    icon: FileText,
  },
  {
    id: "tab2",
    label: "2. VM Swarm & Extraction",
    sub: "Kaggle Swarm, 3-Col Inspector",
    icon: Cpu,
  },
  {
    id: "tab3",
    label: "3. Graph & Timeline Studio",
    sub: "Dual Timeline, Flashback, Tiers",
    icon: GitGraph,
  },
  {
    id: "tab4",
    label: "4. Hybrid RAG Workbench",
    sub: "FTS5 BM25, DiskANN, 4 Tools",
    icon: Search,
  },
  {
    id: "tab5",
    label: "5. E2E Pipeline Stepper",
    sub: "Full Novel Runner & Scorecard",
    icon: CheckCircle,
  },
];

export function TestbenchNavRail({ activeTab, onSelectTab }: TestbenchNavRailProps) {
  return (
    <aside className="w-60 md:w-64 border-r border-zinc-800/90 bg-[#09090b] p-3 flex flex-col gap-1.5 shrink-0 select-none overflow-y-auto">
      <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Testbench Checkpoints
      </div>

      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
              isActive
                ? "bg-zinc-800 text-zinc-100 font-medium shadow-sm border border-zinc-700/60"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
                isActive
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                  : "border-zinc-800 bg-zinc-900 text-zinc-500"
              }`}
            >
              <Icon className="h-4 w-4" />
            </div>

            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold leading-tight truncate">
                {tab.label}
              </span>
              <span className="text-[11px] text-zinc-500 leading-tight truncate mt-0.5">
                {tab.sub}
              </span>
            </div>
          </button>
        );
      })}
    </aside>
  );
}
