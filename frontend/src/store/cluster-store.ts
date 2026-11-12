import { create } from "zustand";
import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";
import { resolvePreferredVmTarget } from "@/lib/vm-select";
import { WORKFLOW_PRESETS, type WorkflowPreset } from "@/lib/orchestrator/workflow-presets";

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
  outputs: GeneratedOutput[];
  durationMs: number | null;
  queueElapsedMs: number | null;
  queuePending: number;
}

interface ClusterUiState {
  selectedTarget: string;
  manualTargetPinned: boolean;
  setSelectedTarget: (target: string, pinned?: boolean) => void;
  syncTargetWithVms: (vms: PublicVmInstance[]) => void;

  activeStream: ActiveStreamState | null;
  startStream: (params: {
    target: string;
    jobId?: number | null;
    fetchJobId?: string | null;
    transport?: "rclone-gdrive" | "sidecar-fetch";
    modelName: string;
    category: string;
  }) => void;
  setActiveStream: (stream: ActiveStreamState | null) => void;

  studio: StudioFormState;
  updateStudio: (patch: Partial<StudioFormState>) => void;
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
  startStream: ({ target, jobId, fetchJobId, transport, modelName, category }) =>
    set({
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
        totalBytes: 0,
        etaSeconds: null,
        speedText: fetchJobId ? "Starting HF/Civitai aria2c fetch..." : "Starting Rclone...",
        active: true,
        completed: false,
        error: null,
      },
    }),
  setActiveStream: (activeStream) => set({ activeStream }),

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
    outputs: [],
    durationMs: null,
    queueElapsedMs: null,
    queuePending: 0,
  },

  updateStudio: (patch) =>
    set((state) => ({
      studio: { ...state.studio, ...patch },
    })),

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
