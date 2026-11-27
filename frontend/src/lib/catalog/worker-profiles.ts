export type WorkerProfileId =
  | "BASE_COMFY"
  | "IMAGE_CORE"
  | "IMAGE_GGUF_EDIT"
  | "IMAGE_DIT_DUAL_T4"
  | "AUDIO_LIPSYNC"
  | "VIDEO_MOTION"
  | "LLM_QWEN_FAST_8B"
  | "LLM_QWEN_VLM"
  | "LLM_QWEN_TEXT_TURBO"
  | "LLM_QWEN_MOE_35B"
  | "LLM_LIGHTWEIGHT_SWARM"
  | "TPU_QWEN27B_V5E";

export interface CustomNodeSpec {
  name: string;
  repoUrl: string;
}

export interface WorkerProfileSpec {
  id: WorkerProfileId;
  label: string;
  shortTag: string;
  description: string;
  recommendedTargets: string[];
  customNodes: CustomNodeSpec[];
  accelerator?: "gpu" | "tpu";
  multiGpuMode?: "dual_process" | "single_dual_gpu";
}

export const WORKER_PROFILES: Record<WorkerProfileId, WorkerProfileSpec> = {
  BASE_COMFY: {
    id: "BASE_COMFY",
    label: "Fast Base ComfyUI",
    shortTag: "BASE",
    description:
      "Fastest boot (~30s). Core ComfyUI without extra custom nodes; ideal for standard SDXL, Illustrious, Turbo & Upscale workflows.",
    recommendedTargets: ["gpu0", "gpu1"],
    customNodes: [],
  },
  IMAGE_CORE: {
    id: "IMAGE_CORE",
    label: "Image Core (SDXL / NoobAI + IP-Adapter + Detailers)",
    shortTag: "IMG-CORE",
    description:
      "Illustrious v2.0 / NoobAI V-Pred 1.0 / Animagine 4.0 stack on single T4 (:8188 / :8189) with NoobAI IP-Adapter Mk1, Laxhar ControlNets, StyleAligned, ComfyCouple, Crop&Stitch, RMBG, and FaceDetailer.",
    recommendedTargets: ["gpu0", "gpu1"],
    multiGpuMode: "dual_process",
    customNodes: [
      {
        name: "ComfyUI_IPAdapter_plus",
        repoUrl: "https://github.com/cubiq/ComfyUI_IPAdapter_plus.git",
      },
      {
        name: "ComfyUI-Impact-Pack",
        repoUrl: "https://github.com/ltdrdata/ComfyUI-Impact-Pack.git",
      },
      {
        name: "ComfyUI-Impact-Subpack",
        repoUrl: "https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git",
      },
      {
        name: "ComfyUI-Inspire-Pack",
        repoUrl: "https://github.com/ltdrdata/ComfyUI-Inspire-Pack.git",
      },
      {
        name: "comfyui_controlnet_aux",
        repoUrl: "https://github.com/Fannovel16/comfyui_controlnet_aux.git",
      },
      {
        name: "ComfyUI-KJNodes",
        repoUrl: "https://github.com/kijai/ComfyUI-KJNodes.git",
      },
      {
        name: "ComfyUI_UltimateSDUpscale",
        repoUrl: "https://github.com/ssitu/ComfyUI_UltimateSDUpscale.git",
      },
      {
        name: "ComfyUI-ComfyCouple",
        repoUrl: "https://github.com/Danand/ComfyUI-ComfyCouple.git",
      },
      {
        name: "style_aligned_comfy",
        repoUrl: "https://github.com/jasonphillips/style_aligned_comfy.git",
      },
      {
        name: "ComfyUI-Inpaint-CropAndStitch",
        repoUrl: "https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch.git",
      },
      {
        name: "ComfyUI-RMBG",
        repoUrl: "https://github.com/1038lab/ComfyUI-RMBG.git",
      },
    ],
  },
  IMAGE_GGUF_EDIT: {
    id: "IMAGE_GGUF_EDIT",
    label: "Flux / Anima / Qwen-Edit (GGUF 16GB Single-T4)",
    shortTag: "GGUF-EDIT",
    description:
      "16 GB single-T4 stack for Anima v1.0 GGUF + Ref Adapter v2, Flux.1 GGUF, Qwen-Image-Edit 2511, and LBM/Light-Migration relighting.",
    recommendedTargets: ["gpu2"],
    multiGpuMode: "dual_process",
    customNodes: [
      {
        name: "ComfyUI-GGUF",
        repoUrl: "https://github.com/city96/ComfyUI-GGUF.git",
      },
      {
        name: "ComfyUI-MultiGPU",
        repoUrl: "https://github.com/pollockjj/ComfyUI-MultiGPU.git",
      },
      {
        name: "ComfyUI-KJNodes",
        repoUrl: "https://github.com/kijai/ComfyUI-KJNodes.git",
      },
      {
        name: "ComfyUI-Anima-Ref-Adapter",
        repoUrl: "https://github.com/ElectronGirl/ComfyUI-Anima-Ref-Adapter.git",
      },
      {
        name: "ComfyUI-Anima-CharRef-LLLite",
        repoUrl: "https://github.com/quinteroac/ComfyUI-Anima-CharRef-LLLite.git",
      },
      {
        name: "ComfyUI-LBM",
        repoUrl: "https://github.com/1038lab/ComfyUI-LBM.git",
      },
      {
        name: "ComfyUI-RMBG",
        repoUrl: "https://github.com/1038lab/ComfyUI-RMBG.git",
      },
      {
        name: "ComfyUI-Inpaint-CropAndStitch",
        repoUrl: "https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch.git",
      },
    ],
  },
  IMAGE_DIT_DUAL_T4: {
    id: "IMAGE_DIT_DUAL_T4",
    label: "Next-Gen DiT Split (Dual-T4 · FLUX 3 / MOSS / Qwen 2.1 / 360°)",
    shortTag: "DIT-32G",
    description:
      "Runs 1 unified ComfyUI process spanning CUDA:0+CUDA:1 (32 GB total VRAM): DiT INT8 ConvRot/GGUF on cuda:0 and Qwen3.5-9B / Qwen3VL-8B Text Encoders on cuda:1. Supports FLUX 3 Klein, MOSS-Image 8-step DMD2, Qwen-Image 2.1, Anima Ref v2, and 360° Panoramas.",
    recommendedTargets: ["gpu0", "gpu1"],
    multiGpuMode: "single_dual_gpu",
    customNodes: [
      {
        name: "ComfyUI-GGUF",
        repoUrl: "https://github.com/city96/ComfyUI-GGUF.git",
      },
      {
        name: "ComfyUI-MultiGPU",
        repoUrl: "https://github.com/pollockjj/ComfyUI-MultiGPU.git",
      },
      {
        name: "ComfyUI-KJNodes",
        repoUrl: "https://github.com/kijai/ComfyUI-KJNodes.git",
      },
      {
        name: "ComfyUI-Inspire-Pack",
        repoUrl: "https://github.com/ltdrdata/ComfyUI-Inspire-Pack.git",
      },
      {
        name: "comfyui_controlnet_aux",
        repoUrl: "https://github.com/Fannovel16/comfyui_controlnet_aux.git",
      },
      {
        name: "ComfyUI-Anima-Ref-Adapter",
        repoUrl: "https://github.com/ElectronGirl/ComfyUI-Anima-Ref-Adapter.git",
      },
      {
        name: "ComfyUI-Anima-CharRef-LLLite",
        repoUrl: "https://github.com/quinteroac/ComfyUI-Anima-CharRef-LLLite.git",
      },
      {
        name: "RES4LYF",
        repoUrl: "https://github.com/ClownsharkBatwing/RES4LYF.git",
      },
      {
        name: "ComfyUI-LBM",
        repoUrl: "https://github.com/1038lab/ComfyUI-LBM.git",
      },
      {
        name: "ComfyUI-RMBG",
        repoUrl: "https://github.com/1038lab/ComfyUI-RMBG.git",
      },
      {
        name: "ComfyUI-Inpaint-CropAndStitch",
        repoUrl: "https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch.git",
      },
      {
        name: "ComfyUI-Olm-DragCrop",
        repoUrl: "https://github.com/o-l-l-i/ComfyUI-Olm-DragCrop.git",
      },
      {
        name: "ComfyUI_pytorch360convert",
        repoUrl: "https://github.com/ProGamerGov/ComfyUI_pytorch360convert.git",
      },
      {
        name: "ComfyUI_preview360panorama",
        repoUrl: "https://github.com/ProGamerGov/ComfyUI_preview360panorama.git",
      },
    ],
  },
  AUDIO_LIPSYNC: {
    id: "AUDIO_LIPSYNC",
    label: "Audio + LipSync Suite (~10.1 GB T4)",
    shortTag: "AUDIO",
    description:
      "Holds Kokoro TTS, F5-TTS voice cloning, MMAudio SFX, Stable Audio BGM, and LatentSync together inside 16 GB VRAM.",
    recommendedTargets: ["gcgpu", "gcgpu1"],
    customNodes: [
      {
        name: "comfyui-kokoro",
        repoUrl: "https://github.com/stavsap/comfyui-kokoro.git",
      },
      {
        name: "ComfyUI-F5-TTS",
        repoUrl: "https://github.com/niknah/ComfyUI-F5-TTS.git",
      },
      {
        name: "ComfyUI-MMAudio",
        repoUrl: "https://github.com/kijai/ComfyUI-MMAudio.git",
      },
      {
        name: "ComfyUI-StableAudioSampler",
        repoUrl: "https://github.com/lks-ai/ComfyUI-StableAudioSampler.git",
      },
      {
        name: "ComfyUI-LatentSyncWrapper",
        repoUrl: "https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper.git",
      },
    ],
  },
  VIDEO_MOTION: {
    id: "VIDEO_MOTION",
    label: "Video I2V (LTX-Video / Wan 2.1)",
    shortTag: "VIDEO",
    description:
      "Image-to-Video motion stack with LTX-Video, Wan 2.1 wrapper, and VideoHelperSuite for frame assembly.",
    recommendedTargets: ["gpu3"],
    customNodes: [
      {
        name: "ComfyUI-LTXVideo",
        repoUrl: "https://github.com/Lightricks/ComfyUI-LTXVideo.git",
      },
      {
        name: "ComfyUI-WanVideoWrapper",
        repoUrl: "https://github.com/kijai/ComfyUI-WanVideoWrapper.git",
      },
      {
        name: "ComfyUI-VideoHelperSuite",
        repoUrl: "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git",
      },
    ],
  },
  LLM_QWEN_FAST_8B: {
    id: "LLM_QWEN_FAST_8B",
    label: "Qwen 8B Fast Vision (15s Boot · ~45-60 tok/s)",
    shortTag: "QWEN-8B-FAST",
    description:
      "Ultra-lightweight Qwen3-VL-8B GGUF (~5.1 GB). Instant 15–20s boot, tiny VRAM footprint, and rapid 45–60 tok/s generation for responsive writing, testing & vision QA.",
    recommendedTargets: ["gpu2", "gpu3", "gpu0", "gpu1", "gpu4", "gpu5"],
    customNodes: [],
  },
  LLM_QWEN_VLM: {
    id: "LLM_QWEN_VLM",
    label: "Qwen 27B Vision + LLM (~16 tok/s · Dual-T4)",
    shortTag: "QWEN-LLM",
    description:
      "Dual-T4 llama-server + mmproj vision. Best for Visual QA, multi-modal frame auditing, and mixed storyboarding (~16 tok/s).",
    recommendedTargets: ["gpu0", "gpu1", "gpu2", "gpu3", "gpu4", "gpu5"],
    customNodes: [],
  },
  LLM_QWEN_TEXT_TURBO: {
    id: "LLM_QWEN_TEXT_TURBO",
    label: "Qwen 27B Ultra Text (ExLlamaV3 55-154 tok/s)",
    shortTag: "QWEN-TURBO",
    description:
      "Dual-T4 ExLlamaV3 + DFlash2 drafter + Tensor Parallelism. Fastest single-user text throughput (55-154 tok/s) for ingesting 100s of novel chapters without vision.",
    recommendedTargets: ["gpu0", "gpu1", "gpu2", "gpu3", "gpu4", "gpu5"],
    customNodes: [],
  },
  LLM_QWEN_MOE_35B: {
    id: "LLM_QWEN_MOE_35B",
    label: "Qwen 35B-A3B Vision MoE (~35-55 tok/s · Dual-T4)",
    shortTag: "QWEN-35B-MOE",
    description:
      "35B Sparse MoE with only 3B active parameters per token + native Vision. Fast decode (~35–55 tok/s) on 2× T4 with 52:48 layer split and sub-second prompt replies.",
    recommendedTargets: ["gpu2", "gpu3", "gpu4", "gpu5", "gpu0", "gpu1"],
    customNodes: [],
  },
  LLM_LIGHTWEIGHT_SWARM: {
    id: "LLM_LIGHTWEIGHT_SWARM",
    label: "Qwen 3.5 Swarm (4B Extract + 9B QC + MiniCPM-V + RAG)",
    shortTag: "5M-SWARM",
    description:
      "Parallel 5-model suite on 2× T4. Qwen3.5-4B (~95-180 tok/s extraction), MiniCPM-V 4.7-1B (~180 tok/s tagger), Qwen3.5-9B (~45 tok/s QC reasoning), and Lore RAG.",
    recommendedTargets: ["gpu0", "gpu1", "gpu2", "gpu3", "gpu4", "gpu5"],
    customNodes: [],
  },
  TPU_QWEN27B_V5E: {
    id: "TPU_QWEN27B_V5E",
    label: "Qwen 27B BF16 (TPU v5e-8 · 130 tok/s · 262k)",
    shortTag: "TPU-V5E",
    description:
      "Full unquantized Qwen3.8-27B BF16 on 8 TPU chips (128 GB HBM). Native Vision, 262K context, MTP speculative decoding (~130 tok/s), OpenAI-compatible /v1 API.",
    recommendedTargets: ["tpu0", "tpu1", "tpu2", "tpu3"],
    customNodes: [],
    accelerator: "tpu",
  },
};

export const WORKER_PROFILE_LIST: WorkerProfileSpec[] = Object.values(WORKER_PROFILES);

export function isValidWorkerProfile(id?: string | null): id is WorkerProfileId {
  return Boolean(id && id in WORKER_PROFILES);
}

export function isLlmWorkerProfile(id?: string | null): boolean {
  return (
    id === "LLM_QWEN_VLM" ||
    id === "LLM_QWEN_TEXT_TURBO" ||
    id === "LLM_QWEN_MOE_35B" ||
    id === "LLM_QWEN_FAST_8B" ||
    id === "LLM_LIGHTWEIGHT_SWARM" ||
    id === "TPU_QWEN27B_V5E"
  );
}

export function isSingleDualGpuProfile(id?: string | null): boolean {
  if (!id || !(id in WORKER_PROFILES)) return false;
  return WORKER_PROFILES[id as WorkerProfileId].multiGpuMode === "single_dual_gpu";
}

export function getWorkerProfile(id?: string | null): WorkerProfileSpec {
  if (id && id in WORKER_PROFILES) {
    return WORKER_PROFILES[id as WorkerProfileId];
  }
  return WORKER_PROFILES.BASE_COMFY;
}

export function defaultWorkerProfileForTarget(target: string): WorkerProfileId {
  if (target.startsWith("tpu")) {
    return "TPU_QWEN27B_V5E";
  }
  switch (target) {
    case "gpu2":
      return "IMAGE_GGUF_EDIT";
    case "gpu3":
      return "VIDEO_MOTION";
    case "gcgpu":
    case "gcgpu1":
      return "AUDIO_LIPSYNC";
    default:
      return "BASE_COMFY";
  }
}

