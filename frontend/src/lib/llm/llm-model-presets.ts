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
  approxVramGb: number;
  visionCapable: boolean;
  recommendedTopology: LlmTopologyMode;
  notes: string;
  companionRepos?: LlmModelCompanionSpec[];
}

export const LLM_MODEL_PRESETS: LlmModelPresetSpec[] = [
  {
    id: "qwen3-vl-8b",
    label: "Qwen3-VL 8B Instruct (Vision + Fast Text · ~6.2 GB)",
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
    notes: "Lightweight multimodal model. Fits on 1 T4 (~6.8 GB VRAM) or 2x parallel replicas across Dual-T4 (~30-35 tok/s per replica, ~61 tok/s combined).",
  },
  {
    id: "qwen3.5-9b",
    label: "Qwen3.5 9B (Text / Arena / QC · ~5.6 GB)",
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
    notes: "Fast 9B reasoning model (~45-70 tok/s). Pairs cleanly with Qwen3-VL 8B for A/B Arena.",
  },
  {
    id: "qwen3.5-swarm",
    label: "Qwen Light Trio / Swarm (9B + 4B + MiniCPM-V · ~9.4 GB)",
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
    notes: "Bundles Qwen3.5-9B + Qwen3.5-4B + MiniCPM-V-1B in one dataset (<10 GB) for 4-service swarm mode.",
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
    id: "qwen3.8-27b-vlm",
    label: "Qwen3.8 27B Vision + LLM (Dual-T4 Split · ~17.8 GB)",
    shortLabel: "Qwen3.8 27B VLM",
    profileId: "LLM_QWEN_VLM",
    repoId: "unsloth/Qwen3.8-27B-GGUF",
    quantHint: "Q4_K_M",
    preferredFilenames: ["*Q4_K_M*.gguf", "*IQ4_XS*.gguf", "*Q3_K_M*.gguf"],
    mmprojHints: ["*mmproj-F16*.gguf", "*mmproj-BF16*.gguf", "*mmproj*.gguf"],
    approxDiskGb: 17.8,
    approxVramGb: 19.2,
    visionCapable: true,
    recommendedTopology: "llm_layer_split",
    notes: "Flagship 27B multimodal model split 53:47 across Dual-T4 (~19.2 GB VRAM) with F16 projector and embedded Native MTP (draft-mtp) for both Vision QA and strict JSON.",
  },
  {
    id: "qwen3.8-27b-text",
    label: "Qwen3.8 27B Text Only (Dual-T4 Split · ~16.6 GB)",
    shortLabel: "Qwen3.8 27B Text",
    profileId: "LLM_QWEN_TEXT_TURBO",
    repoId: "unsloth/Qwen3.8-27B-GGUF",
    quantHint: "Q4_K_M",
    preferredFilenames: ["*Q4_K_M*.gguf", "*IQ4_XS*.gguf", "*Q3_K_M*.gguf"],
    mmprojHints: [],
    approxDiskGb: 16.6,
    approxVramGb: 18.0,
    visionCapable: false,
    recommendedTopology: "llm_layer_split",
    notes: "27B text-only across Dual-T4 with Native MTP (or optional text-only DFlash2) and zero projector overhead.",
  },
  {
    id: "qwen3.6-35b-a3b",
    label: "Qwen3.6 35B-A3B Sparse MoE (Vision · ~17.7 GB IQ4_XS)",
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
    notes: "35B Sparse MoE with 3B active parameters (~45-51 tok/s on Dual-T4). Uses IQ4_XS so the dataset fits Kaggle's 19.5 GiB Output limit.",
  },
];

export function resolveLlmPresetById(presetId?: string | null): LlmModelPresetSpec | null {
  if (!presetId) return null;
  return LLM_MODEL_PRESETS.find((p) => p.id === presetId) ?? null;
}

export function getDefaultPresetForLlmProfile(profileId?: string | null): LlmModelPresetSpec {
  switch (profileId) {
    case "LLM_QWEN_FAST_8B":
      return LLM_MODEL_PRESETS[0];
    case "LLM_QWEN_TEXT_TURBO":
      return LLM_MODEL_PRESETS[1];
    case "LLM_LIGHTWEIGHT_SWARM":
      return LLM_MODEL_PRESETS[2];
    case "LLM_QWEN_VLM":
      return LLM_MODEL_PRESETS[3];
    case "LLM_QWEN_MOE_35B":
      return LLM_MODEL_PRESETS[5];
    default:
      return LLM_MODEL_PRESETS[0];
  }
}
