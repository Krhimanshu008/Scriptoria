export interface WorkflowPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  recommendedCheckpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  hiresPass?: boolean;
  defaultPrompt: string;
  defaultNegativePrompt: string;
}

export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: "sdxl-illustrious-hq",
    name: "Illustrious Anime HQ",
    badge: "1024×1024 · 25 Steps",
    description: "Balanced SDXL/Illustrious txt2img pipeline with Euler Ancestral sampling for sharp illustrations.",
    recommendedCheckpoint: "Wai_Illustrious_v16.safetensors",
    width: 1024,
    height: 1024,
    steps: 25,
    cfg: 6.0,
    samplerName: "euler_ancestral",
    scheduler: "normal",
    defaultPrompt:
      "masterpiece, best quality, highly detailed anime fantasy portrait, cinematic volumetric lighting, intricate outfit, sharp focus",
    defaultNegativePrompt: "bad quality, blurry, deformed, lowres, extra limbs, watermark, text",
  },
  {
    id: "sdxl-turbo-fast",
    name: "DreamShaper Turbo Fast",
    badge: "1024×1024 · 8 Steps",
    description: "Ultra-fast 8-step DPM++ SDE Karras preset (~5-8s per image on T4) tuned for Turbo/LCM checkpoints.",
    recommendedCheckpoint: "DreamShaperXL_Turbo_v2_1.safetensors",
    width: 1024,
    height: 1024,
    steps: 8,
    cfg: 2.0,
    samplerName: "dpmpp_sde",
    scheduler: "karras",
    defaultPrompt:
      "cinematic photorealistic cyberpunk alley at twilight, neon rain reflections, 85mm lens, shallow depth of field, ultra detailed",
    defaultNegativePrompt: "blurry, oversaturated, plastic skin, lowres, watermark",
  },
  {
    id: "sdxl-landscape-16x9",
    name: "Cinematic Widescreen 16:9",
    badge: "1344×768 · Keyframe",
    description: "Wide 16:9 composition ideal for storyboards, key art, and scene establishing shots.",
    recommendedCheckpoint: "Wai_Illustrious_v16.safetensors",
    width: 1344,
    height: 768,
    steps: 24,
    cfg: 6.0,
    samplerName: "euler_ancestral",
    scheduler: "normal",
    defaultPrompt:
      "wide shot, epic fantasy floating citadel above glowing clouds at golden hour, dramatic god rays, painterly anime background art",
    defaultNegativePrompt: "cropped, blurry, lowres, distorted perspective, text, watermark",
  },
  {
    id: "sdxl-portrait-9x16",
    name: "Vertical Comic Panel 9:16",
    badge: "768×1344 · DPM++ 2M",
    description: "Tall 9:16 framing with DPM++ 2M Karras for clean character sheets and vertical comic panels.",
    recommendedCheckpoint: "Wai_Illustrious_v16.safetensors",
    width: 768,
    height: 1344,
    steps: 26,
    cfg: 6.5,
    samplerName: "dpmpp_2m",
    scheduler: "karras",
    defaultPrompt:
      "full body character portrait, silver-haired mage holding an arcane astrolabe, flowing cloak, dramatic rim light, clean lineart",
    defaultNegativePrompt: "bad anatomy, extra fingers, blurry, lowres, cropped head",
  },
  {
    id: "sdxl-hires-upscale",
    name: "2-Pass Latent Hires Fix",
    badge: "768² ➔ 1536² · 2-Pass",
    description: "Two-stage ComfyUI graph: base latent generation followed by bislerp 2x LatentUpscale + 0.55 denoise refinement pass.",
    recommendedCheckpoint: "Wai_Illustrious_v16.safetensors",
    width: 768,
    height: 768,
    steps: 22,
    cfg: 6.0,
    samplerName: "dpmpp_2m",
    scheduler: "karras",
    hiresPass: true,
    defaultPrompt:
      "masterpiece, ultra-detailed editorial fantasy illustration, bioluminescent forest shrine, volumetric mist, crisp textures",
    defaultNegativePrompt: "bad quality, artifacts, blurry, lowres, deformed",
  },
];

export function getPresetById(id?: string | null): WorkflowPreset | undefined {
  if (!id) return undefined;
  return WORKFLOW_PRESETS.find((p) => p.id === id);
}

