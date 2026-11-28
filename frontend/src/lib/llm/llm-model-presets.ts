import type { WorkerProfileId } from "@/lib/catalog/worker-profiles";
import type { LlmTopologyMode } from "@/lib/orchestrator/vm-helpers";

export interface LlmModelCompanionSpec {
  role: "extract" | "vision" | "replica_b";
  repoId: string;
  quantHint: string;
  preferredFilenames: string[];
  mmprojHints: string[];
}

export interface LlmModelPresetSpec {
  id: string;
  label: string;
  shortLabel: string;
  profileId: WorkerProfileId;
  repoId: string;
  quantHint: string;
  preferredFilenames: string[];
  mmprojHints: string[];
  approxDiskGb: number;
  approxWeightsGb?: number;
  approxMmprojGb?: number;
  approxVramGb: number;
  visionCapable: boolean;
  recommendedTopology: LlmTopologyMode;
  isCanonical?: boolean;
  legacy?: boolean;
  notes: string;
  companionRepos?: LlmModelCompanionSpec[];
}

export const CANONICAL_LLM_PROFILE_ID: WorkerProfileId = "LLM_QWEN_VLM";
export const CANONICAL_LLM_PRESET_ID = "qwen3.8-27b-vlm";
export const CANONICAL_LLM_DATASET_NAME = "scriptoria-qwen-llm";

export const CANONICAL_LLM_PRESET: LlmModelPresetSpec = {
  id: CANONICAL_LLM_PRESET_ID,
  label: "Qwen 3.8 27B Vision + Native MTP (Dual-T4 53:47 · ~17.8 GB)",
  shortLabel: "Qwen3.8-27B VLM + MTP",
  profileId: CANONICAL_LLM_PROFILE_ID,
  repoId: "unsloth/Qwen3.8-27B-GGUF",
  quantHint: "UD-Q4_K_M",
  preferredFilenames: [
    "*UD-Q4_K_M*.gguf",
    "*Q4_K_M*.gguf",
    "*IQ4_XS*.gguf",
    "*Q3_K_M*.gguf",
  ],
  mmprojHints: ["*mmproj-F16*.gguf", "*mmproj-BF16*.gguf", "*mmproj*.gguf"],
  approxDiskGb: 17.8,
  approxWeightsGb: 16.56,
  approxMmprojGb: 1.24,
  approxVramGb: 19.2,
  visionCapable: true,
  recommendedTopology: "llm_layer_split",
  isCanonical: true,
  notes:
    "Canonical single-model production stack: Qwen3.8-27B-UD-Q4_K_M (~16.56 GB) + mmproj-F16 (~1.2 GB) split 53:47 across 2× Tesla T4 (~19.2 GB VRAM) with q8_0 16K KV cache and embedded Native MTP (draft-mtp).",
};

/** Strictly the single-model UI list exposed inside the refactored LLM Studio & VM loader. */
export const PRIMARY_LLM_MODEL_PRESETS: LlmModelPresetSpec[] = [CANONICAL_LLM_PRESET];

/** Full backwards-compatible preset table (legacy entries retained for older API callers & test suites). */
export const LLM_MODEL_PRESETS: LlmModelPresetSpec[] = [
  CANONICAL_LLM_PRESET,
  {
    id: "qwen3-vl-8b",
    label: "Qwen3-VL 8B Instruct (Legacy · ~6.2 GB)",
    shortLabel: "Qwen3-VL 8B",
    profileId: "LLM_QWEN_FAST_8B",
    repoId: "unsloth/Qwen3-VL-8B-Instruct-GGUF",
    quantHint: "Q4_K_M",
    preferredFilenames: ["*Q4_K_M*.gguf", "*Q4_K_S*.gguf", "*Q4_0*.gguf"],
    mmprojHints: ["*mmproj-F16*.gguf", "*mmproj-BF16*.gguf", "*mmproj*.gguf"],
    approxDiskGb: 6.2,
    approxVramGb: 6.8,
    visionCapable: true,
    recommendedTopology: "llm_dual_replica",
    legacy: true,
    notes: "Legacy lightweight multimodal preset.",
  },
  {
    id: "qwen3.5-9b",
    label: "Qwen3.5 9B (Legacy · ~5.6 GB)",
    shortLabel: "Qwen3.5 9B",
    profileId: "LLM_QWEN_TEXT_TURBO",
    repoId: "unsloth/Qwen3.5-9B-GGUF",
    quantHint: "Q4_K_M",
    preferredFilenames: ["*Q4_K_M*.gguf", "*Q4_K_S*.gguf", "*IQ4_XS*.gguf"],
    mmprojHints: [],
    approxDiskGb: 5.6,
    approxVramGb: 6.4,
    visionCapable: false,
    recommendedTopology: "llm_ab_arena",
    legacy: true,
    notes: "Legacy 9B text preset.",
  },
  {
    id: "qwen3.5-swarm",
    label: "Qwen Light Trio / Swarm (Legacy · ~9.4 GB)",
    shortLabel: "Qwen Light Swarm",
    profileId: "LLM_LIGHTWEIGHT_SWARM",
    repoId: "unsloth/Qwen3.5-9B-GGUF",
    quantHint: "Q4_K_M",
    preferredFilenames: ["*Q4_K_M*.gguf", "*Q4_K_S*.gguf"],
    mmprojHints: [],
    approxDiskGb: 9.4,
    approxVramGb: 11.5,
    visionCapable: true,
    recommendedTopology: "llm_swarm_multi",
    legacy: true,
    notes: "Legacy swarm preset retained for API backwards compatibility.",
    companionRepos: [
      {
        role: "extract",
        repoId: "unsloth/Qwen3.5-4B-GGUF",
        quantHint: "Q4_K_M",
        preferredFilenames: ["*Q4_K_M*.gguf", "*Q4_K_S*.gguf"],
        mmprojHints: [],
      },
      {
        role: "vision",
        repoId: "openbmb/MiniCPM-V-4.7-1B-gguf",
        quantHint: "Q4_K_M",
        preferredFilenames: ["*Q4_K_M*.gguf", "*Q4_K*.gguf", "*ggml-model*.gguf"],
        mmprojHints: ["*mmproj*.gguf"],
      },
    ],
  },
  {
    id: "qwen3.8-27b-text",
    label: "Qwen3.8 27B Text Only (Legacy · ~16.6 GB)",
    shortLabel: "Qwen3.8 27B Text",
    profileId: "LLM_QWEN_TEXT_TURBO",
    repoId: "unsloth/Qwen3.8-27B-GGUF",
    quantHint: "UD-Q4_K_M",
    preferredFilenames: ["*UD-Q4_K_M*.gguf", "*Q4_K_M*.gguf", "*IQ4_XS*.gguf", "*Q3_K_M*.gguf"],
    mmprojHints: [],
    approxDiskGb: 16.6,
    approxVramGb: 18.0,
    visionCapable: false,
    recommendedTopology: "llm_layer_split",
    legacy: true,
    notes: "27B text-only variant without mmproj projector.",
  },
  {
    id: "qwen3.6-35b-a3b",
    label: "Qwen3.6 35B-A3B Sparse MoE (Legacy · ~17.7 GB)",
    shortLabel: "Qwen3.6 35B-A3B MoE",
    profileId: "LLM_QWEN_MOE_35B",
    repoId: "unsloth/Qwen3.6-35B-A3B-GGUF",
    quantHint: "IQ4_XS",
    preferredFilenames: ["*IQ4_XS*.gguf", "*Q3_K_M*.gguf", "*Q4_K_S*.gguf"],
    mmprojHints: ["*mmproj-F16*.gguf", "*mmproj-BF16*.gguf", "*mmproj*.gguf"],
    approxDiskGb: 17.7,
    approxVramGb: 18.7,
    visionCapable: true,
    recommendedTopology: "llm_layer_split",
    legacy: true,
    notes: "Legacy 35B-A3B Sparse MoE preset.",
  },
];

export function resolveLlmPresetById(presetId?: string | null): LlmModelPresetSpec | null {
  if (!presetId) return null;
  return LLM_MODEL_PRESETS.find((p) => p.id === presetId) ?? null;
}

export function getDefaultPresetForLlmProfile(profileId?: string | null): LlmModelPresetSpec {
  switch (profileId) {
    case "LLM_QWEN_FAST_8B":
      return resolveLlmPresetById("qwen3-vl-8b") || CANONICAL_LLM_PRESET;
    case "LLM_QWEN_TEXT_TURBO":
      return resolveLlmPresetById("qwen3.8-27b-text") || CANONICAL_LLM_PRESET;
    case "LLM_LIGHTWEIGHT_SWARM":
      return resolveLlmPresetById("qwen3.5-swarm") || CANONICAL_LLM_PRESET;
    case "LLM_QWEN_MOE_35B":
      return resolveLlmPresetById("qwen3.6-35b-a3b") || CANONICAL_LLM_PRESET;
    case "LLM_QWEN_VLM":
    default:
      return CANONICAL_LLM_PRESET;
  }
}
