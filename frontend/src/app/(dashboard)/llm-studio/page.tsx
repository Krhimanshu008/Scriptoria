"use client";

import React, { useState } from "react";
import { Bot, PanelRightClose, PanelRightOpen } from "lucide-react";
import { LlmStudioTab } from "@/components/studio/LlmStudioTab";
import { AgentCoDirectorPanel } from "@/components/studio/AgentCoDirectorPanel";

export default function LlmStudioPage() {
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div>
          <h1 className="text-base font-semibold text-zinc-100">LLM Studio Workstation</h1>
          <p className="text-xs text-zinc-400">
            Dedicated workstation for Qwen 2.5 / 3.8 27B Vision & Reasoning on Dual-T4 with persistent session history.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAgentDrawerOpen((v) => !v)}
          className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${
            agentDrawerOpen
              ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-200"
              : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <Bot className="h-3.5 w-3.5 text-indigo-400" />
          <span>AI Controller</span>
          {agentDrawerOpen ? (
            <PanelRightClose className="h-3 w-3 text-zinc-400" />
          ) : (
            <PanelRightOpen className="h-3 w-3 text-zinc-400" />
          )}
        </button>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <LlmStudioTab />
        </div>

        {agentDrawerOpen && (
          <aside className="w-full shrink-0 xl:sticky xl:top-16 xl:w-[360px]">
            <AgentCoDirectorPanel />
          </aside>
        )}
      </div>
    </div>
  );
}
