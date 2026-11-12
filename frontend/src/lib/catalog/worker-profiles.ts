export type WorkerProfileId =
  | "BASE_COMFY"
  | "IMAGE_CORE"
  | "IMAGE_GGUF_EDIT"
  | "AUDIO_LIPSYNC"
  | "VIDEO_MOTION"
  | "LLM_QWEN_VLM"
  | "LLM_QWEN_TEXT_TURBO";

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
    label: "Image Core (SDXL + Detailers + IP-Adapter)",
    shortTag: "IMG-CORE",
    description:
      "SDXL / Illustrious / Pony stack with IP-Adapter Plus, ControlNet Aux, and Impact-Pack Face/Hand Detailers for 16 GB T4.",
    recommendedTargets: ["gpu0", "gpu1"],
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
        name: "comfyui_controlnet_aux",
        repoUrl: "https://github.com/Fannovel16/comfyui_controlnet_aux.git",
      },
    ],
  },
  IMAGE_GGUF_EDIT: {
    id: "IMAGE_GGUF_EDIT",
    label: "Flux & Qwen-Edit (GGUF 16GB)",
    shortTag: "GGUF-EDIT",
    description:
      "Includes ComfyUI-GGUF for quantized Flux.1 Dev/Schnell and Qwen-Image-Edit 2511 fusion/relight/angle workflows.",
    recommendedTargets: ["gpu2"],
    customNodes: [
      {
        name: "ComfyUI-GGUF",
        repoUrl: "https://github.com/city96/ComfyUI-GGUF.git",
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
  LLM_QWEN_VLM: {
    id: "LLM_QWEN_VLM",
    label: "Qwen 27B Vision + LLM (Dual-T4)",
    shortTag: "QWEN-LLM",
    description:
      "Dual-T4 llama-server + DFlash2 speculative drafter + mmproj vision. Best for Visual QA, multi-modal frame auditing, and mixed storyboarding (~35-85 tok/s).",
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
};

export const WORKER_PROFILE_LIST: WorkerProfileSpec[] = Object.values(WORKER_PROFILES);

export function isValidWorkerProfile(id?: string | null): id is WorkerProfileId {
  return Boolean(id && id in WORKER_PROFILES);
}

export function isLlmWorkerProfile(id?: string | null): boolean {
  return id === "LLM_QWEN_VLM" || id === "LLM_QWEN_TEXT_TURBO";
}

export function getWorkerProfile(id?: string | null): WorkerProfileSpec {
  if (id && id in WORKER_PROFILES) {
    return WORKER_PROFILES[id as WorkerProfileId];
  }
  return WORKER_PROFILES.BASE_COMFY;
}

export function defaultWorkerProfileForTarget(target: string): WorkerProfileId {
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

