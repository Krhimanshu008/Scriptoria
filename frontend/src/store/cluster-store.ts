import { create } from "zustand";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { resolvePreferredVmTarget } from "@/lib/vm-select";
import { WORKFLOW_PRESETS, type WorkflowPreset } from "@/lib/orchestrator/workflow-presets";
import type { WorkflowBuildSpec } from "@/lib/workflow/compiler";

export interface ActiveStreamState {
  target: string;
  jobId?: number | null;
  fetchJobId?: string | null;
  transport?: "rclone-gdrive" | "sidecar-fetch";
  modelName: string;
  category: string;
  percentage: number;
  speedMbps: number;
  bytesDone: number;
  totalBytes: number;
  etaSeconds: number | null;
  speedText: string;
  active: boolean;
  completed?: boolean;
  error?: string | null;
}

export interface GeneratedOutput {
  filename: string;
  gdriveFileId: string;
  gdrivePath: string;
  previewUrl: string;
  target?: string;
  jobId?: string;
}

export interface StudioFormState {
  activePresetId: string;
  selectedCheckpoint: string;
  selectedLora: string;
  loraStrength: number;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  hiresPass: boolean;
  batchSize: number;
  seed: string;
  customJsonMode: boolean;
  customJsonText: string;
  submitting: boolean;
  pollingJobId: string | null;
  pollingTarget: string | null;
  pollingJobs: Array<{ jobId: string; target: string }>;
  outputs: GeneratedOutput[];
  recentOutputs: GeneratedOutput[];
  durationMs: number | null;
  queueElapsedMs: number | null;
  queuePending: number;
}

export interface StreamQueueItem {
  target: string;
  jobId?: number | null;
  fetchJobId?: string | null;
  transport?: "rclone-gdrive" | "sidecar-fetch";
  modelName: string;
  category: string;
  totalBytes?: number;
}

interface ClusterUiState {
  selectedTarget: string;
  manualTargetPinned: boolean;
  setSelectedTarget: (target: string, pinned?: boolean) => void;
  syncTargetWithVms: (vms: PublicVmInstance[]) => void;

  activeStream: ActiveStreamState | null;
  queuedStreams: StreamQueueItem[];
  startStream: (params: StreamQueueItem, queue?: StreamQueueItem[]) => void;
  advanceStreamQueue: () => StreamQueueItem | null;
  setActiveStream: (stream: ActiveStreamState | null) => void;

  studio: StudioFormState;
  updateStudio: (patch: Partial<StudioFormState>) => void;
  architectDraftSpec: WorkflowBuildSpec | null;
  setArchitectDraftSpec: (spec: WorkflowBuildSpec | null) => void;
  batchDraft: {
    baseSpec: WorkflowBuildSpec;
    title?: string;
    suggestedMode?: "prompt_list" | "matrix" | "character_ip_set" | "folder_i2i";
    createdAt: number;
  } | null;
  setBatchDraft: (
    draft: {
      baseSpec: WorkflowBuildSpec;
      title?: string;
      suggestedMode?: "prompt_list" | "matrix" | "character_ip_set" | "folder_i2i";
      createdAt: number;
    } | null
  ) => void;
  applyStudioPreset: (preset: WorkflowPreset, availableCheckpoints: string[]) => void;
  remixFromHistory: (item: {
    target: string;
    prompt: string;
    negativePrompt: string | null;
    checkpoint: string;
    width: number;
    height: number;
    steps: number;
    cfg: number;
    seed: string | null;
  }) => void;
}

const DEFAULT_PRESET = WORKFLOW_PRESETS[0];

export const useClusterStore = create<ClusterUiState>((set, get) => ({
  selectedTarget: "gpu0",
  manualTargetPinned: false,
  setSelectedTarget: (selectedTarget, pinned = true) =>
    set({ selectedTarget, manualTargetPinned: pinned }),

  syncTargetWithVms: (vms) => {
    const { selectedTarget, manualTargetPinned } = get();
    const preferred = resolvePreferredVmTarget(vms, selectedTarget, manualTargetPinned);
    if (preferred !== selectedTarget) {
      set({ selectedTarget: preferred });
    }
  },

  activeStream: null,
  queuedStreams: [],
  startStream: ({ target, jobId, fetchJobId, transport, modelName, category, totalBytes }, queue) =>
    set((state) => ({
      queuedStreams: queue !== undefined ? queue : state.queuedStreams,
      activeStream: {
        target,
        jobId: jobId ?? null,
        fetchJobId: fetchJobId ?? null,
        transport: transport ?? (fetchJobId ? "sidecar-fetch" : "rclone-gdrive"),
        modelName,
        category,
        percentage: 1,
        speedMbps: 0,
        bytesDone: 0,
        totalBytes: totalBytes ?? 0,
        etaSeconds: null,
        speedText: fetchJobId ? "Starting mirror fetch..." : "Starting Rclone...",
        active: true,
        completed: false,
        error: null,
      },
    })),
  advanceStreamQueue: () => {
    const [next, ...rest] = get().queuedStreams;
    if (!next) return null;
    set({
      queuedStreams: rest,
      activeStream: {
        target: next.target,
        jobId: next.jobId ?? null,
        fetchJobId: next.fetchJobId ?? null,
        transport: next.transport ?? (next.fetchJobId ? "sidecar-fetch" : "rclone-gdrive"),
        modelName: next.modelName,
        category: next.category,
        percentage: 1,
        speedMbps: 0,
        bytesDone: 0,
        totalBytes: next.totalBytes ?? 0,
        etaSeconds: null,
        speedText: next.fetchJobId ? "Starting mirror fetch..." : "Starting Rclone...",
        active: true,
        completed: false,
        error: null,
      },
    });
    return next;
  },
  setActiveStream: (activeStream) =>
    set((state) => ({ activeStream, queuedStreams: activeStream ? state.queuedStreams : [] })),

  studio: {
    activePresetId: DEFAULT_PRESET.id,
    selectedCheckpoint: "",
    selectedLora: "",
    loraStrength: 0.85,
    prompt: DEFAULT_PRESET.defaultPrompt,
    negativePrompt: DEFAULT_PRESET.defaultNegativePrompt,
    width: DEFAULT_PRESET.width,
    height: DEFAULT_PRESET.height,
    steps: DEFAULT_PRESET.steps,
    cfg: DEFAULT_PRESET.cfg,
    samplerName: DEFAULT_PRESET.samplerName,
    scheduler: DEFAULT_PRESET.scheduler,
    hiresPass: Boolean(DEFAULT_PRESET.hiresPass),
    batchSize: 1,
    seed: "",
    customJsonMode: false,
    customJsonText: "",
    submitting: false,
    pollingJobId: null,
    pollingTarget: null,
    pollingJobs: [],
    outputs: [],
    recentOutputs: [],
    durationMs: null,
    queueElapsedMs: null,
    queuePending: 0,
  },

  updateStudio: (patch) =>
    set((state) => ({
      studio: { ...state.studio, ...patch },
    })),

  architectDraftSpec: null,
  setArchitectDraftSpec: (architectDraftSpec) => set({ architectDraftSpec }),
  batchDraft: null,
  setBatchDraft: (batchDraft) => set({ batchDraft }),

  applyStudioPreset: (preset, availableCheckpoints) =>
    set((state) => ({
      studio: {
        ...state.studio,
        activePresetId: preset.id,
        customJsonMode: false,
        prompt: preset.defaultPrompt,
        negativePrompt: preset.defaultNegativePrompt,
        width: preset.width,
        height: preset.height,
        steps: preset.steps,
        cfg: preset.cfg,
        samplerName: preset.samplerName,
        scheduler: preset.scheduler,
        hiresPass: Boolean(preset.hiresPass),
        selectedCheckpoint: availableCheckpoints.includes(preset.recommendedCheckpoint)
          ? preset.recommendedCheckpoint
          : state.studio.selectedCheckpoint,
      },
    })),

  remixFromHistory: (item) =>
    set((state) => ({
      studio: {
        ...state.studio,
        customJsonMode: false,
        prompt: item.prompt,
        negativePrompt: item.negativePrompt || "",
        selectedCheckpoint: item.checkpoint,
        width: item.width,
        height: item.height,
        steps: item.steps,
        cfg: item.cfg,
        seed: item.seed || "",
      },
    })),
}));
