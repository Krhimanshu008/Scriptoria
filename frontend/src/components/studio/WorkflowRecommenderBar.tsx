"use client";

import React, { useState } from "react";
import {
  Sparkles,
  Wand2,
  Loader2,
  Cpu,
  CheckCircle2,
  ArrowRight,
  Zap,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type {
  RecommendationTaskType,
  SpeedPriority,
  WorkflowStackRecommendation,
} from "@/lib/workflow/recommender";
import type { StylePresetId } from "@/lib/workflow/modules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const TASK_OPTIONS: Array<{ id: RecommendationTaskType; label: string }> = [
  { id: "txt2img", label: "Scene / Illustration" },
  { id: "consistent_ip", label: "Consistent Character IP" },
  { id: "character_turnaround", label: "Character Turnaround" },
  { id: "multi_char_scene", label: "Multi-Character Scene" },
  { id: "controlnet_guided", label: "ControlNet Pose / Lineart" },
  { id: "relight_composite", label: "Relight / Composite" },
  { id: "image_edit", label: "Image Edit" },
  { id: "panorama_360", label: "360° World Panorama" },
  { id: "storyboard_fast", label: "Fast Storyboard" },
  { id: "portrait", label: "Character Portrait" },
];

const STYLE_OPTIONS: Array<{ id: StylePresetId; label: string }> = [
  { id: "anime_vibrant", label: "Anime Vibrant (Illustrious)" },
  { id: "anime_dramatic_vpred", label: "Dramatic Dark Anime (Noob V-Pred)" },
  { id: "anime_clean_cel", label: "Clean Studio Cel (Animagine 4.0)" },
  { id: "manhwa_webtoon", label: "Korean Manhwa / Webtoon" },
  { id: "painterly_fantasy", label: "Painterly Fantasy Art" },
  { id: "lineart_sketch", label: "Ink Lineart / Manga Sketch" },
  { id: "gothic_dark", label: "Gothic Atmospheric" },
  { id: "photoreal_cinematic", label: "Photorealistic Film" },
  { id: "panorama_360", label: "360° Equirectangular" },
];

interface WorkflowRecommenderBarProps {
  onApplyRecommendation: (rec: WorkflowStackRecommendation) => void;
  onArchitectDesign?: (goal: string, opts: {
    task: RecommendationTaskType;
    stylePreset: StylePresetId;
    speedPriority: SpeedPriority;
  }) => Promise<void>;
  architectBusy?: boolean;
}

/**
 * Multi-axis stack recommender wizard calling POST /api/workflow/recommend
 * to rank Top-3 Kaggle Dual-T4 recipes across Task x Style x Consistency x Hardware Readiness.
 */
export function WorkflowRecommenderBar({
  onApplyRecommendation,
  onArchitectDesign,
  architectBusy,
}: WorkflowRecommenderBarProps) {
  const [goal, setGoal] = useState(
    "Dramatic dark rainy rooftop sword duel between silver-haired mage and shadow knight, matching character sheet"
  );
  const [task, setTask] = useState<RecommendationTaskType>("consistent_ip");
  const [stylePreset, setStylePreset] = useState<StylePresetId>("anime_dramatic_vpred");
  const [speedPriority, setSpeedPriority] = useState<SpeedPriority>("balanced");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [recommendations, setRecommendations] = useState<WorkflowStackRecommendation[]>([]);

  async function handleRecommend() {
    if (!goal.trim()) {
      toast.error("Describe your visual scene or style goal first.");
      return;
    }
    setLoading(true);
    setExpanded(true);
    try {
      const res = await fetch("/api/workflow/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          task,
          stylePreset,
          speedPriority,
          consistencyMode: task === "consistent_ip" ? "auto" : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Recommendation failed");
        return;
      }
      setRecommendations(data.recommendations || []);
      if ((data.recommendations || []).length > 0) {
        toast.success(`Ranked Top ${data.recommendations.length} Kaggle T4 stacks!`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-indigo-500/25 bg-gradient-to-br from-[#12121a] to-[#0f1014] px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
          )}
          <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
          <span className="text-xs font-semibold text-white">
            AI Workflow Architect &amp; Style Advisor
          </span>
          {!expanded && (
            <span className="hidden text-[11px] text-zinc-500 sm:inline">
              — Rank Top-3 Kaggle Dual-T4 stacks or auto-design graph
            </span>
          )}
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          {!expanded && onArchitectDesign && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={Boolean(architectBusy)}
              onClick={() => onArchitectDesign(goal, { task, stylePreset, speedPriority })}
              className="h-7 border-violet-500/40 bg-violet-500/15 px-2.5 text-[11px] font-medium text-violet-200 hover:bg-violet-500/25"
            >
              {architectBusy ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Wand2 className="mr-1 h-3 w-3" />
              )}
              Quick AI Design
            </Button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            {expanded ? "Hide" : "Expand Advisor"}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-12">
        <div className="space-y-1 md:col-span-5">
          <Label className="text-[11px] text-zinc-300">Describe Style / Story Goal</Label>
          <Input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Korean manhwa action scene with 2 characters in neon subway..."
            className="text-xs"
          />
        </div>

        <div className="space-y-1 md:col-span-3">
          <Label className="text-[11px] text-zinc-300">Task Type</Label>
          <select
            value={task}
            onChange={(e) => setTask(e.target.value as RecommendationTaskType)}
            className="glass-input h-9 w-full rounded-md px-2.5 text-xs text-zinc-100"
          >
            {TASK_OPTIONS.map((t) => (
              <option key={t.id} value={t.id} className="bg-zinc-900">
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1 md:col-span-2">
          <Label className="text-[11px] text-zinc-300">Style Preset</Label>
          <select
            value={stylePreset}
            onChange={(e) => setStylePreset(e.target.value as StylePresetId)}
            className="glass-input h-9 w-full rounded-md px-2.5 text-xs text-zinc-100"
          >
            {STYLE_OPTIONS.map((s) => (
              <option key={s.id} value={s.id} className="bg-zinc-900">
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1 md:col-span-2">
          <Label className="text-[11px] text-zinc-300">Speed / Quality</Label>
          <select
            value={speedPriority}
            onChange={(e) => setSpeedPriority(e.target.value as SpeedPriority)}
            className="glass-input h-9 w-full rounded-md px-2.5 text-xs text-zinc-100"
          >
            <option value="balanced" className="bg-zinc-900">Balanced</option>
            <option value="fast" className="bg-zinc-900">Fast (Turbo/DMD2)</option>
            <option value="quality" className="bg-zinc-900">Max Quality</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={loading}
          onClick={handleRecommend}
          className="h-8 bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-500"
        >
          {loading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Zap className="mr-1.5 h-3.5 w-3.5" />
          )}
          Recommend Top 3 Stacks
        </Button>

        {onArchitectDesign && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={Boolean(architectBusy)}
            onClick={() => onArchitectDesign(goal, { task, stylePreset, speedPriority })}
            className="h-8 border-violet-500/40 bg-violet-500/15 text-xs font-medium text-violet-200 hover:bg-violet-500/25"
          >
            {architectBusy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            AI Architect: Auto-Design Full Graph
          </Button>
        )}
      </div>

      {recommendations.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5 pt-1 lg:grid-cols-3">
          {recommendations.map((rec) => (
            <div
              key={rec.recipeId}
              className="flex flex-col justify-between space-y-2.5 rounded-lg border border-zinc-800 bg-zinc-950/90 p-3 text-xs"
            >
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-white">
                    #{rec.rank} · {rec.title}
                  </span>
                  <span className="shrink-0 rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-indigo-300">
                    {rec.score}/100
                  </span>
                </div>

                <div className="flex flex-wrap gap-1">
                  <span className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                    <Cpu className="h-2.5 w-2.5" />
                    {rec.t4ExecutionMode === "dual_t4_split"
                      ? "Dual-T4 Split (32G)"
                      : rec.t4ExecutionMode === "dual_t4_parallel"
                      ? "2x T4 Parallel"
                      : "Single 16G T4"}
                  </span>
                  <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                    {rec.targetProfile} · {rec.vramEstimateGb}G
                  </span>
                </div>

                <ul className="space-y-0.5 text-[11px] text-zinc-400">
                  {rec.whyRecommended.slice(0, 2).map((r, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap gap-1 pt-0.5">
                  {rec.readinessSummary.map((rm) => (
                    <span
                      key={rm.filename}
                      className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${
                        rm.readiness === "WARM_ON_GPU"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : rm.readiness === "IN_DRIVE"
                          ? "bg-cyan-500/15 text-cyan-300"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {rm.filename.slice(0, 22)} · {rm.readiness === "WARM_ON_GPU" ? "GPU" : rm.readiness === "IN_DRIVE" ? "DRIVE" : "MIRROR"}
                    </span>
                  ))}
                </div>
              </div>

              <Button
                type="button"
                size="sm"
                onClick={() => onApplyRecommendation(rec)}
                className="h-7 w-full bg-zinc-800 text-[11px] font-medium text-white hover:bg-indigo-600"
              >
                Load into Creator
                <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}
