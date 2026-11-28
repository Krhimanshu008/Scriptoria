import type { WorkerProfileId } from "@/lib/catalog/worker-profiles";

export interface ImageModelPackSpec {
  id: string;
  label: string;
  shortLabel: string;
  profiles: WorkerProfileId[];
  approxDiskGb: number;
  notes: string;
  slugs: string[];
}

export const IMAGE_MODEL_PACKS: ImageModelPackSpec[] = [
  {
    id: "qwen21-turbo-pack",
    label: "Qwen-Image 2.1 Turbo + pe_i2i (3 files · ~17.4 GB)",
    shortLabel: "Qwen 2.1 Turbo Pack",
    profiles: ["IMAGE_DIT_DUAL_T4", "IMAGE_GGUF_EDIT"],
    approxDiskGb: 17.4,
    notes: "Dual-T4 INT8 ConvRot UNet + pe_i2i reference text encoder + Qwen 2.1 VAE.",
    slugs: [
      "qwen-image-2-1-turbo-int8-convrot",
      "qwen35-9b-qwen21-pe-i2i-int8",
      "qwen-image-2-1-vae",
    ],
  },
  {
    id: "qwen-edit-2511-pack",
    label: "Qwen-Image-Edit 2511 + Lightning (4 files · ~23.3 GB)",
    shortLabel: "Qwen-Edit 2511 Pack",
    profiles: ["IMAGE_DIT_DUAL_T4", "IMAGE_GGUF_EDIT"],
    approxDiskGb: 23.3,
    notes: "Q4_K_M GGUF + Qwen2.5-VL 7B encoder + 4-step Lightning LoRA + Qwen VAE.",
    slugs: [
      "qwen-image-edit-2511-q4km",
      "qwen-2-5-vl-7b-fp8-scaled",
      "qwen-edit-2511-lightning-4step",
      "qwen-image-vae",
    ],
  },
  {
    id: "flux3-klein-pack",
    label: "FLUX 3 Klein Dual-T4 Pack (3 files · ~16.5 GB)",
    shortLabel: "FLUX 3 Klein Pack",
    profiles: ["IMAGE_DIT_DUAL_T4", "IMAGE_GGUF_EDIT"],
    approxDiskGb: 16.5,
    notes: "FLUX 3 Klein INT8 ConvRot + Qwen3.5 9B prompt upsampler + FLUX2 VAE.",
    slugs: [
      "flux3-image-klein-int8-convrot",
      "qwen35-9b-flux3-upsampler-int8",
      "flux2-vae",
    ],
  },
  {
    id: "moss-image-pack",
    label: "MOSS-Image 8-Step DMD2 Pack (4 files · ~17.2 GB)",
    shortLabel: "MOSS 8-Step Pack",
    profiles: ["IMAGE_DIT_DUAL_T4", "IMAGE_GGUF_EDIT"],
    approxDiskGb: 17.2,
    notes: "MOSS-Image SFT INT8 + Qwen3.5 9B encoder + DMD2 8-step LoRA + FLUX2 VAE.",
    slugs: [
      "moss-image-sft-int8-convrot",
      "qwen35-9b-int8-convrot",
      "moss-image-8step-dmd2-lora",
      "flux2-vae",
    ],
  },
  {
    id: "noobai-vpred-pack",
    label: "NoobAI V-Pred 1.0 + Detailers (4 files · ~7.5 GB)",
    shortLabel: "NoobAI V-Pred Pack",
    profiles: ["IMAGE_CORE", "BASE_COMFY"],
    approxDiskGb: 7.5,
    notes: "NoobAI V-Pred 1.0 + SDXL FP16 fix VAE + FaceDetailer YOLOv8m + SAM ViT-B.",
    slugs: [
      "noobai-xl-vpred-1-0",
      "sdxl-vae-fp16-fix",
      "yolo-face-yolov8m",
      "sam-vit-b",
    ],
  },
  {
    id: "illustrious-v2-pack",
    label: "Illustrious XL v2.0 + SDXL VAE (2 files · ~7.0 GB)",
    shortLabel: "Illustrious v2.0 Pack",
    profiles: ["IMAGE_CORE", "BASE_COMFY"],
    approxDiskGb: 7.0,
    notes: "Illustrious XL v2.0 base checkpoint + T4-safe SDXL FP16 fix VAE.",
    slugs: ["illustrious-xl-v2-0", "sdxl-vae-fp16-fix"],
  },
  {
    id: "dreamshaper-turbo-pack",
    label: "DreamShaper XL Turbo v2.1 + VAE (2 files · ~7.0 GB)",
    shortLabel: "DreamShaper Turbo Pack",
    profiles: ["IMAGE_CORE", "BASE_COMFY"],
    approxDiskGb: 7.0,
    notes: "Fast SDXL Turbo checkpoint + T4-safe SDXL FP16 fix VAE.",
    slugs: ["dreamshaper-xl-v2-turbo", "sdxl-vae-fp16-fix"],
  },
  {
    id: "audio-sfx-pack",
    label: "Kokoro TTS + MMAudio SFX (2 files · ~2.4 GB)",
    shortLabel: "Audio TTS + SFX Pack",
    profiles: ["AUDIO_LIPSYNC"],
    approxDiskGb: 2.4,
    notes: "Voices & foley/SFX runtime models.",
    slugs: ["kokoro-v1-0-tts", "mmaudio-small-16k"],
  },
];

export function getImagePacksForProfile(profileId?: string | null): ImageModelPackSpec[] {
  const pid = (profileId || "BASE_COMFY") as WorkerProfileId;
  const matched = IMAGE_MODEL_PACKS.filter((p) => p.profiles.includes(pid));
  return matched.length > 0 ? matched : IMAGE_MODEL_PACKS;
}

export function resolveImagePackById(packId?: string | null): ImageModelPackSpec | null {
  if (!packId) return null;
  return IMAGE_MODEL_PACKS.find((p) => p.id === packId) ?? null;
}
