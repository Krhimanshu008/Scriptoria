"use client";

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Film,
  Plus,
  Play,
  Loader2,
  Cpu,
  RefreshCw,
  Trash2,
  Sparkles,
  FileCode2,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface ProjectScene {
  id: string;
  title: string;
  narration: string;
  tracks: {
    visual?: { prompt?: string; width?: number; height?: number };
    audio_tts?: { text?: string; voice?: string };
    audio_sfx?: { prompt?: string };
    audio_bgm?: { mood?: string };
    video_i2v?: { motionPrompt?: string };
  };
}

interface ProjectRecord {
  id: string;
  title: string;
  stylePreset: string;
  characters: Array<{
    id: string;
    name: string;
    triggerWords: string;
    voicePreset: string;
  }>;
  scenes: ProjectScene[];
}

interface BatchRecord {
  id: string;
  title: string;
  sourceApp: string;
  status: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  strategy?: {
    estimatedSavingsNote?: string;
    coalescedGroups?: Array<{ workerProfile: string; baseCheckpoint: string; taskCount: number }>;
  };
  tasks: Array<{
    id: string;
    sceneKey: string;
    trackType: string;
    workerProfile: string;
    baseCheckpoint: string;
    assignedTarget: string | null;
    status: string;
    errorMessage?: string | null;
  }>;
}

const SAMPLE_BOOK_VISUALISER_PAYLOAD = `{
  "sourceApp": "book-visualiser",
  "title": "Chapter 4 · Sky Citadel Confrontation",
  "adapterHints": "Anime dark fantasy aesthetic, use WAI-Illustrious for visuals and Kokoro TTS for dialogue.",
  "scenes": [
    {
      "sceneKey": "ch4-sc1",
      "title": "Bridge Over the Abyss",
      "tracks": {
        "visual": { "prompt": "wide shot floating stone bridge in storm clouds, lone silver-haired mage holding glowing blade, epic lighting", "width": 1344, "height": 768 },
        "audio_tts": { "text": "Hold the line. If the seal breaks, nothing below survives.", "voice": "af_heart" },
        "audio_bgm": { "mood": "tense orchestral strings and low war drums", "durationSec": 25 }
      }
    },
    {
      "sceneKey": "ch4-sc2",
      "title": "Blade Ignites",
      "tracks": {
        "visual": { "prompt": "close up glowing azure runes along katana edge, rain sparks, dramatic anime keyframe", "width": 1024, "height": 1024 },
        "audio_sfx": { "prompt": "metallic sword unsheath ringing with electric crackle and thunder" }
      }
    }
  ]
}`;

export function SceneBatchStudio({ subView }: { subView: "scenes" | "batch" }) {
  const queryClient = useQueryClient();

  // Scene Studio State
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [charName, setCharName] = useState("");
  const [charTriggers, setCharTriggers] = useState("");
  const [charVoice, setCharVoice] = useState("af_heart");
  const [creatingProj, setCreatingProj] = useState(false);

  // Batch & Ingestion State
  const [ingestPayload, setIngestPayload] = useState(SAMPLE_BOOK_VISUALISER_PAYLOAD);
  const [dryRunResult, setDryRunResult] = useState<{
    normalizedBy: string;
    adapterNotes?: string;
    coalesceSummary?: { estimatedSavingsNote?: string; coalescedGroups?: Array<{ workerProfile: string; baseCheckpoint: string; taskCount: number }> };
    plannedTasks?: Array<{ sceneKey: string; trackType: string; workerProfile: string; baseCheckpoint: string; dependsOn: string[] }>;
  } | null>(null);
  const [ingesting, setIngesting] = useState(false);

  const { data: projectData, refetch: refetchProjects } = useQuery<{ projects: ProjectRecord[] }>({
    queryKey: ["studio-projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: batchData, refetch: refetchBatches } = useQuery<{ batches: BatchRecord[] }>({
    queryKey: ["batch-jobs"],
    queryFn: async () => {
      const res = await fetch("/api/v1/batch");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 6000,
  });

  const projects = projectData?.projects ?? [];
  const activeProject =
    projects.find((p) => p.id === selectedProjectId) || projects[0] || null;
  const batches = batchData?.batches ?? [];

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProjectTitle.trim()) return;
    setCreatingProj(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_project", title: newProjectTitle }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create project");
        return;
      }
      setNewProjectTitle("");
      setSelectedProjectId(data.project.id);
      toast.success("Created 5-Track Scene Project");
      refetchProjects();
    } finally {
      setCreatingProj(false);
    }
  }

  async function handleAddCharacter(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProject || !charName.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_character",
        projectId: activeProject.id,
        name: charName,
        triggerWords: charTriggers,
        voicePreset: charVoice,
      }),
    });
    if (res.ok) {
      setCharName("");
      setCharTriggers("");
      toast.success("Saved character voice/visual profile");
      refetchProjects();
    }
  }

  async function handleSaveSceneTrack(scene: ProjectScene, nextTracks: ProjectScene["tracks"]) {
    if (!activeProject) return;
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert_scene",
        projectId: activeProject.id,
        sceneId: scene.id,
        tracks: nextTracks,
      }),
    });
    toast.success(`Saved ${scene.title} tracks`);
    refetchProjects();
  }

  async function handleAddScene() {
    if (!activeProject) return;
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert_scene",
        projectId: activeProject.id,
        title: `Scene ${activeProject.scenes.length + 1}`,
      }),
    });
    refetchProjects();
  }

  async function handleDispatchProjectToBatch() {
    if (!activeProject) return;
    const payload = {
      sourceApp: "scene-studio",
      projectId: activeProject.id,
      title: `${activeProject.title} · Multi-Track Batch`,
      scenes: activeProject.scenes.map((sc, i) => ({
        sceneKey: `sc-${i + 1}`,
        title: sc.title,
        tracks: {
          ...(sc.tracks.visual?.prompt
            ? {
                visual: {
                  prompt: sc.tracks.visual.prompt,
                  width: sc.tracks.visual.width || 1344,
                  height: sc.tracks.visual.height || 768,
                },
              }
            : {}),
          ...(sc.tracks.audio_tts?.text
            ? {
                audio_tts: {
                  text: sc.tracks.audio_tts.text,
                  voice: sc.tracks.audio_tts.voice || "af_heart",
                },
              }
            : {}),
          ...(sc.tracks.audio_sfx?.prompt
            ? { audio_sfx: { prompt: sc.tracks.audio_sfx.prompt } }
            : {}),
          ...(sc.tracks.audio_bgm?.mood
            ? { audio_bgm: { mood: sc.tracks.audio_bgm.mood } }
            : {}),
          ...(sc.tracks.video_i2v?.motionPrompt
            ? {
                video_i2v: {
                  motionPrompt: sc.tracks.video_i2v.motionPrompt,
                  dependsOnVisual: true,
                },
              }
            : {}),
        },
      })),
    };

    const res = await fetch("/api/v1/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Batch dispatch failed");
      return;
    }
    toast.success(`Queued Batch "${activeProject.title}" (${data.coalesceSummary?.totalTasks || 0} tasks)`);
    queryClient.invalidateQueries({ queryKey: ["batch-jobs"] });
  }

  async function handleRunIngest(dryRun: boolean) {
    setIngesting(true);
    try {
      let payloadObj: Record<string, unknown>;
      try {
        payloadObj = JSON.parse(ingestPayload) as Record<string, unknown>;
      } catch {
        // Flexible raw story / Markdown mode!
        payloadObj = {
          sourceApp: "book-visualiser-raw",
          title: "Story Text Batch",
          rawText: ingestPayload,
        };
      }

      const res = await fetch(`/api/v1/ingest?dryRun=${dryRun}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadObj),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Ingestion failed");
        return;
      }

      if (dryRun) {
        setDryRunResult(data);
        toast.success(`Dry-Run Preview (${data.normalizedBy}): ${data.coalesceSummary?.totalTasks || 0} tasks coalesced`);
      } else {
        setDryRunResult(null);
        toast.success(`Launched Multi-GPU Batch ${data.batchId}!`);
        refetchBatches();
      }
    } finally {
      setIngesting(false);
    }
  }

  async function handleTickBatch(batchId: string) {
    const res = await fetch(`/api/v1/batch/${encodeURIComponent(batchId)}?tick=true`);
    const data = await res.json();
    if (res.ok) {
      toast.success(
        `Scheduler tick: ${data.dispatched?.length || 0} task(s) assigned to idle GPUs`
      );
      refetchBatches();
    }
  }

  async function handleDeleteBatch(id: string) {
    await fetch(`/api/v1/batch?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    refetchBatches();
  }

  if (subView === "scenes") {
    return (
      <div className="space-y-5">
        {/* Project Selector + New Project */}
        <div className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Film className="h-4 w-4 text-indigo-400" />
            <select
              value={activeProject?.id || ""}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="glass-input rounded-xl px-3 py-1.5 text-xs text-white"
            >
              {projects.length === 0 ? (
                <option value="" className="bg-zinc-900">
                  No projects yet — create one
                </option>
              ) : (
                projects.map((p) => (
                  <option key={p.id} value={p.id} className="bg-zinc-900">
                    {p.title} ({p.scenes.length} scenes)
                  </option>
                ))
              )}
            </select>

            {activeProject && (
              <Button
                type="button"
                onClick={handleDispatchProjectToBatch}
                className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Dispatch Project to Multi-GPU Batch
              </Button>
            )}
          </div>

          <form onSubmit={handleCreateProject} className="flex items-center gap-2">
            <Input
              value={newProjectTitle}
              onChange={(e) => setNewProjectTitle(e.target.value)}
              placeholder="New project title..."
              className="w-48 text-xs"
            />
            <Button type="submit" disabled={creatingProj} className="glass-pill text-xs text-white">
              <Plus className="mr-1 h-3.5 w-3.5" />
              Create
            </Button>
          </form>
        </div>

        {activeProject && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Character Profiles */}
            <div className="glass-panel space-y-3 rounded-2xl p-4 lg:col-span-4">
              <div className="text-xs font-semibold text-white">
                Character Profiles ({activeProject.characters.length})
              </div>
              <div className="space-y-2">
                {activeProject.characters.map((ch) => (
                  <div
                    key={ch.id}
                    className="rounded-xl border border-white/10 bg-black/30 p-2.5 text-[11px]"
                  >
                    <div className="font-semibold text-white">{ch.name}</div>
                    <div className="text-zinc-400">Triggers: {ch.triggerWords || "--"}</div>
                    <div className="font-mono text-[10px] text-cyan-300">Voice: {ch.voicePreset}</div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddCharacter} className="space-y-2 border-t border-white/10 pt-3">
                <Input
                  value={charName}
                  onChange={(e) => setCharName(e.target.value)}
                  placeholder="Character name (e.g. Aria)"
                  className="text-xs"
                />
                <Input
                  value={charTriggers}
                  onChange={(e) => setCharTriggers(e.target.value)}
                  placeholder="Visual tags / LoRA trigger words"
                  className="text-xs"
                />
                <Input
                  value={charVoice}
                  onChange={(e) => setCharVoice(e.target.value)}
                  placeholder="Voice preset (af_heart)"
                  className="text-xs"
                />
                <Button type="submit" variant="outline" className="w-full border-white/15 bg-white/[0.04] text-xs">
                  Add Character
                </Button>
              </form>
            </div>

            {/* 5-Track Scene Cards */}
            <div className="space-y-3 lg:col-span-8">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">
                  Independent Multi-Modal Tracks (Edit dialogue without re-rendering visuals)
                </span>
                <Button type="button" onClick={handleAddScene} className="glass-pill text-xs text-white">
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add Scene
                </Button>
              </div>

              {activeProject.scenes.map((sc) => (
                <SceneTrackCard
                  key={sc.id}
                  scene={sc}
                  onSave={(next) => handleSaveSceneTrack(sc, next)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Book Visualiser & External Flexible Ingest Console */}
      <div className="glass-panel space-y-4 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <FileCode2 className="h-4 w-4 text-cyan-400" />
            <div>
              <div className="text-sm font-semibold text-white">
                External Ingestion (`POST /api/v1/ingest`) &amp; Multi-GPU Batch Optimizer
              </div>
              <p className="text-[11px] text-zinc-400">
                Paste either canonical `ScriptoriaSceneSpec v1` JSON from Book Visualiser OR raw chapter prose/Markdown—AI normalizes, coalesces models, and dispatches across idle GPUs.
              </p>
            </div>
          </div>

          <a
            href="/api/v1/schema"
            target="_blank"
            rel="noreferrer"
            className="glass-pill rounded-lg px-3 py-1.5 font-mono text-[10px] text-cyan-300 hover:bg-white/10"
          >
            GET /api/v1/schema
          </a>
        </div>

        <textarea
          rows={7}
          value={ingestPayload}
          onChange={(e) => setIngestPayload(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-black/45 p-3 font-mono text-[11px] text-zinc-200"
        />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={ingesting}
            onClick={() => handleRunIngest(true)}
            className="glass-pill text-xs text-zinc-100 hover:bg-white/10"
          >
            {ingesting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5 text-violet-300" />
            )}
            Dry-Run Preview &amp; Coalesce Plan
          </Button>

          <Button
            type="button"
            disabled={ingesting}
            onClick={() => handleRunIngest(false)}
            className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            {ingesting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Cpu className="mr-1.5 h-3.5 w-3.5" />
            )}
            Launch Optimized Multi-GPU Batch
          </Button>
        </div>

        {dryRunResult && (
          <div className="space-y-2 rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-3 text-xs">
            <div className="font-semibold text-indigo-200">
              Preview Plan · Normalized by: {dryRunResult.normalizedBy}
            </div>
            <p className="text-[11px] text-zinc-300">
              {dryRunResult.coalesceSummary?.estimatedSavingsNote}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {dryRunResult.coalesceSummary?.coalescedGroups?.map((g, i) => (
                <span
                  key={i}
                  className="rounded-lg border border-white/15 bg-black/40 px-2 py-1 font-mono text-[10px] text-cyan-200"
                >
                  {g.workerProfile} · {g.baseCheckpoint || "default"} ({g.taskCount} tasks)
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Active & Recent Multi-GPU Batches */}
      <div className="glass-panel space-y-3 rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-white">
            Multi-GPU Batch Queue ({batches.length})
          </div>
          <button
            type="button"
            onClick={() => refetchBatches()}
            className="glass-pill flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] text-zinc-300"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>

        {batches.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No multi-GPU batch jobs queued yet. Dispatch from 5-Track Scene Studio or send a payload above.
          </p>
        ) : (
          <div className="space-y-3">
            {batches.map((b) => (
              <div
                key={b.id}
                className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-3.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-white">{b.title}</span>{" "}
                    <span className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                      {b.sourceApp}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-zinc-300">
                      {b.completedTasks}/{b.totalTasks} done
                      {b.failedTasks > 0 ? ` · ${b.failedTasks} failed` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleTickBatch(b.id)}
                      className="glass-pill rounded-lg px-2.5 py-1 text-[10px] text-emerald-200 hover:bg-white/10"
                    >
                      Tick Scheduler
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBatch(b.id)}
                      className="text-zinc-500 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {b.strategy?.estimatedSavingsNote && (
                  <p className="text-[11px] text-zinc-400">{b.strategy.estimatedSavingsNote}</p>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {b.tasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 font-mono text-[10px]"
                    >
                      <span className="truncate text-zinc-200">
                        {t.sceneKey} · {t.trackType}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {t.assignedTarget && (
                          <span className="rounded bg-indigo-500/20 px-1 text-indigo-200">
                            {t.assignedTarget.toUpperCase()}
                          </span>
                        )}
                        {t.status === "COMPLETED" ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        ) : t.status === "FAILED" || t.status === "BLOCKED" ? (
                          <AlertCircle className="h-3 w-3 text-rose-400" />
                        ) : (
                          <Clock className="h-3 w-3 text-amber-300" />
                        )}
                        <span>{t.status}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SceneTrackCard({
  scene,
  onSave,
}: {
  scene: ProjectScene;
  onSave: (tracks: ProjectScene["tracks"]) => Promise<void>;
}) {
  const [tracks, setTracks] = useState(scene.tracks);
  const [saving, setSaving] = useState(false);

  return (
    <div className="glass-panel space-y-3 rounded-2xl p-4 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white">{scene.title}</span>
        <Button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(tracks);
            } finally {
              setSaving(false);
            }
          }}
          className="glass-pill h-7 text-[11px] text-emerald-200"
        >
          {saving ? "Saving..." : "Save Tracks"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-cyan-300">Track 1 · Visual Keyframe Prompt</Label>
          <textarea
            rows={2}
            value={tracks.visual?.prompt || ""}
            onChange={(e) =>
              setTracks({ ...tracks, visual: { ...tracks.visual, prompt: e.target.value } })
            }
            placeholder="Describe scene keyframe..."
            className="w-full rounded-xl border border-white/10 bg-black/35 p-2 text-[11px] text-zinc-100"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-amber-300">Track 2 · Video Motion Prompt (I2V)</Label>
          <textarea
            rows={2}
            value={tracks.video_i2v?.motionPrompt || ""}
            onChange={(e) =>
              setTracks({
                ...tracks,
                video_i2v: { ...tracks.video_i2v, motionPrompt: e.target.value },
              })
            }
            placeholder="Camera motion / subtle wind..."
            className="w-full rounded-xl border border-white/10 bg-black/35 p-2 text-[11px] text-zinc-100"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-emerald-300">Track 3 · Dialogue TTS Line</Label>
          <Input
            value={tracks.audio_tts?.text || ""}
            onChange={(e) =>
              setTracks({ ...tracks, audio_tts: { ...tracks.audio_tts, text: e.target.value } })
            }
            placeholder="Spoken line..."
            className="text-[11px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-violet-300">Track 4 · Foley SFX</Label>
            <Input
              value={tracks.audio_sfx?.prompt || ""}
              onChange={(e) =>
                setTracks({ ...tracks, audio_sfx: { ...tracks.audio_sfx, prompt: e.target.value } })
              }
              placeholder="Rain, sword..."
              className="text-[11px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-rose-300">Track 5 · Ambient BGM</Label>
            <Input
              value={tracks.audio_bgm?.mood || ""}
              onChange={(e) =>
                setTracks({ ...tracks, audio_bgm: { ...tracks.audio_bgm, mood: e.target.value } })
              }
              placeholder="Tense strings..."
              className="text-[11px]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

