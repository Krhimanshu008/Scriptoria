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

export interface ParsedWorkflowRequest {
  target: string;
  preset?: WorkflowPreset;
  customWorkflowJson: Record<string, unknown> | null;
  prompt: string;
  negativePrompt: string;
  requestedCheckpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  hiresPass: boolean;
  batchSize: number;
  loraName: string;
  loraStrength: number;
  seed: number;
}

export function parseWorkflowParamsFromBody(
  body: Record<string, unknown>
): ParsedWorkflowRequest {
  const target = String(body.target || "gpu0");
  const preset = getPresetById(body.presetId ? String(body.presetId) : null);
  const customWorkflowJson =
    body.customWorkflowJson && typeof body.customWorkflowJson === "object"
      ? (body.customWorkflowJson as Record<string, unknown>)
      : null;

  const prompt = String(body.prompt || preset?.defaultPrompt || "").trim();
  const negativePrompt = body.negativePrompt
    ? String(body.negativePrompt)
    : preset?.defaultNegativePrompt || "bad quality, blurry, deformed";
  const requestedCheckpoint = body.checkpoint ? String(body.checkpoint).trim() : "";
  const width = Number(body.width) || preset?.width || 1024;
  const height = Number(body.height) || preset?.height || 1024;
  const steps = Number(body.steps) || preset?.steps || 25;
  const cfg = Number(body.cfg) || preset?.cfg || 6.0;
  const samplerName = String(body.samplerName || preset?.samplerName || "euler_ancestral");
  const scheduler = String(body.scheduler || preset?.scheduler || "normal");
  const hiresPass =
    typeof body.hiresPass === "boolean" ? body.hiresPass : Boolean(preset?.hiresPass);
  const batchSize = Math.min(4, Math.max(1, Math.round(Number(body.batchSize) || 1)));
  const loraName = body.loraName ? String(body.loraName).trim() : "";
  const rawStrength = Number(body.loraStrength);
  const loraStrength = Number.isFinite(rawStrength) && body.loraStrength !== "" ? rawStrength : 0.85;
  const seed = body.seed
    ? Number(body.seed)
    : Math.floor(100_000 + Math.random() * 999_000_000);

  return {
    target,
    preset,
    customWorkflowJson,
    prompt,
    negativePrompt,
    requestedCheckpoint,
    width,
    height,
    steps,
    cfg,
    samplerName,
    scheduler,
    hiresPass,
    batchSize,
    loraName,
    loraStrength,
    seed,
  };
}

