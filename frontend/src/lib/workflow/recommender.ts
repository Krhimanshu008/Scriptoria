import { prisma } from "@/lib/db/prisma";
import { ensureUserCatalogSeeded } from "@/lib/catalog/seed-catalog";
import type { WorkerProfileId } from "@/lib/catalog/worker-profiles";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import {
  compileResourceAwareWorkflow,
  type CompiledWorkflowResult,
  type WorkflowBuildSpec,
} from "./compiler";
import {
  tunePromptForArchitecture,
  type ArchitectureFamily,
  type ControlNetMode,
  type IpConnectorMode,
  type RelightMode,
  type StylePresetId,
} from "./modules";

export type RecommendationTaskType =
  | "txt2img"
  | "character_turnaround"
  | "consistent_ip"
  | "multi_char_scene"
  | "controlnet_guided"
  | "relight_composite"
  | "image_edit"
  | "panorama_360"
  | "storyboard_fast"
  | "portrait";

export type SpeedPriority = "quality" | "balanced" | "fast";

export interface RecommendWorkflowInput {
  goal?: string;
  task?: RecommendationTaskType;
  stylePreset?: StylePresetId;
  consistencyMode?: IpConnectorMode | "auto" | "none";
  controlNetMode?: ControlNetMode;
  relight?: RelightMode;
  characterCount?: number;
  speedPriority?: SpeedPriority;
  preferWarmCache?: boolean;
  includeCompiledGraph?: boolean;
}

export interface InferredWorkflowIntent {
  task: RecommendationTaskType;
  stylePreset: StylePresetId;
  consistencyMode: IpConnectorMode | "none";
  controlNetMode: ControlNetMode;
  relight: RelightMode;
  characterCount: number;
  speedPriority: SpeedPriority;
  promptHint: string;
}

export type ModelCacheReadiness = "WARM_ON_GPU" | "IN_DRIVE" | "MIRROR_READY";

export interface ModelReadinessItem {
  category: string;
  filename: string;
  slug?: string;
  readiness: ModelCacheReadiness;
}

export interface WorkflowStackRecommendation {
  rank: number;
  recipeId: string;
  title: string;
  score: number;
  architecture: ArchitectureFamily;
  targetProfile: WorkerProfileId;
  t4ExecutionMode: "dual_t4_split" | "dual_t4_parallel" | "single_t4";
  t4DevicePlan: string;
  whyRecommended: string[];
  tradeoffs: string[];
  ipConnectorRecommended: IpConnectorMode;
  controlNetRecommended: ControlNetMode;
  relightRecommended: RelightMode;
  licenseNote?: string;
  vramEstimateGb: number;
  recommendedSpec: WorkflowBuildSpec;
  tunedPromptSample: {
    positive: string;
    negative: string;
  };
  readinessSummary: ModelReadinessItem[];
  warmCount: number;
  inDriveCount: number;
  compiled?: CompiledWorkflowResult;
}

interface StackRecipe {
  id: string;
  title: string;
  architecture: ArchitectureFamily;
  targetProfile: WorkerProfileId;
  t4ExecutionMode: "dual_t4_split" | "dual_t4_parallel" | "single_t4";
  t4DevicePlan: string;
  supportedTasks: RecommendationTaskType[];
  bestStyles: StylePresetId[];
  goodStyles: StylePresetId[];
  defaultIp: IpConnectorMode;
  supportedIp: IpConnectorMode[];
  supportedControlNets: ControlNetMode[];
  supportsRelight: RelightMode[];
  supportsMultiChar: boolean;
  speedTier: SpeedPriority;
  vramEstimateGb: number;
  requiredModelFilenames: string[];
  licenseNote?: string;
  strengths: string[];
  tradeoffs: string[];
  buildSpec: (intent: InferredWorkflowIntent) => WorkflowBuildSpec;
}

const STACK_RECIPES: StackRecipe[] = [
  {
    id: "illustrious-v2-anime-flagship",
    title: "Illustrious XL v2.0 + NoobAI IPA Mk1 + Eugeoter ControlNet",
    architecture: "sdxl_illustrious",
    targetProfile: "IMAGE_CORE",
    t4ExecutionMode: "dual_t4_parallel",
    t4DevicePlan: "Runs independently per T4 (:8188 & :8189) so 2 story frames render in parallel.",
    supportedTasks: [
      "txt2img",
      "character_turnaround",
      "consistent_ip",
      "multi_char_scene",
      "controlnet_guided",
      "portrait",
    ],
    bestStyles: ["anime_vibrant", "lineart_sketch"],
    goodStyles: ["anime_clean_cel", "painterly_fantasy", "manhwa_webtoon"],
    defaultIp: "noob_ipa_mk1",
    supportedIp: ["noob_ipa_mk1", "style_aligned", "none"],
    supportedControlNets: ["canny", "depth", "lineart_anime", "openpose", "tile", "none"],
    supportsRelight: ["none", "lbm_relight"],
    supportsMultiChar: true,
    speedTier: "balanced",
    vramEstimateGb: 9.8,
    requiredModelFilenames: ["Illustrious-XL-v2.0.safetensors", "sdxl_vae_fp16_fix.safetensors"],
    strengths: [
      "Highest anime character expression, Danbooru tag accuracy, & ComfyCouple isolation",
      "Supports NoobAI IP-Adapter Mk1 (ViT-bigG) & StyleAligned batch sheet locks",
    ],
    tradeoffs: ["Tag-driven prompting; typography lags behind Qwen 2.1 / FLUX 3"],
    buildSpec: (intent) => ({
      pipeline: intent.task === "character_turnaround" ? "sdxl_detailer_upscale" : "sdxl_txt2img",
      architecture: "sdxl_illustrious",
      stylePreset: intent.stylePreset,
      baseModel: "Illustrious-XL-v2.0.safetensors",
      loras:
        intent.task === "character_turnaround"
          ? [{ filename: "vn_character_sheet_v4.safetensors", strength: 0.85 }]
          : undefined,
      ipConnectors:
        intent.consistencyMode !== "none"
          ? [{ mode: intent.consistencyMode === "style_aligned" ? "style_aligned" : "noob_ipa_mk1", weight: 0.72 }]
          : undefined,
      controlNets:
        intent.controlNetMode !== "none"
          ? [{ mode: intent.controlNetMode, strength: 0.8 }]
          : undefined,
      relight: intent.relight,
      enableFaceDetailer: intent.task === "portrait" || intent.task === "character_turnaround",
      upscalerModel: intent.task === "character_turnaround" ? "4x-AnimeSharp.pth" : undefined,
      width: intent.task === "character_turnaround" ? 1280 : 1024,
      height: intent.task === "character_turnaround" ? 768 : 1024,
      prompt: intent.promptHint,
    }),
  },
  {
    id: "noobai-vpred-dramatic",
    title: "NoobAI-XL V-Pred 1.0 (ZSNR + RescaleCFG + Laxhar CN)",
    architecture: "noobai_vpred",
    targetProfile: "IMAGE_CORE",
    t4ExecutionMode: "dual_t4_parallel",
    t4DevicePlan: "Runs per T4 (:8188 & :8189) with auto zsnr=True & RescaleCFG(0.7).",
    supportedTasks: ["txt2img", "consistent_ip", "multi_char_scene", "controlnet_guided", "portrait"],
    bestStyles: ["anime_dramatic_vpred", "gothic_dark"],
    goodStyles: ["anime_vibrant", "painterly_fantasy"],
    defaultIp: "noob_ipa_mk1",
    supportedIp: ["noob_ipa_mk1", "style_aligned", "none"],
    supportedControlNets: ["canny", "depth", "lineart_anime", "openpose", "tile", "none"],
    supportsRelight: ["none", "lbm_relight"],
    supportsMultiChar: true,
    speedTier: "balanced",
    vramEstimateGb: 7.4,
    requiredModelFilenames: ["NoobAI-XL-Vpred-v1.0.safetensors", "sdxl_vae_fp16_fix.safetensors"],
    licenseNote: "Non-commercial research & story visualization",
    strengths: [
      "Unmatched deep shadows, neon night contrast, & dramatic anime battle lighting",
      "Auto-applies V-Prediction ZSNR + RescaleCFG + strips 'simple background' hazards",
    ],
    tradeoffs: ["Requires V-Pred ZSNR node & darker lighting prompts"],
    buildSpec: (intent) => ({
      pipeline: "noob_vpred",
      architecture: "noobai_vpred",
      stylePreset: intent.stylePreset,
      baseModel: "NoobAI-XL-Vpred-v1.0.safetensors",
      ipConnectors:
        intent.consistencyMode !== "none"
          ? [{ mode: intent.consistencyMode === "style_aligned" ? "style_aligned" : "noob_ipa_mk1", weight: 0.72 }]
          : undefined,
      controlNets:
        intent.controlNetMode !== "none"
          ? [{ mode: intent.controlNetMode, strength: 0.8 }]
          : undefined,
      relight: intent.relight,
      enableFaceDetailer: intent.task === "portrait",
      prompt: intent.promptHint,
    }),
  },
  {
    id: "animagine-v4-clean-cel",
    title: "Animagine XL 4.0 Opt (Clean Studio Cel & Expressions)",
    architecture: "animagine",
    targetProfile: "IMAGE_CORE",
    t4ExecutionMode: "dual_t4_parallel",
    t4DevicePlan: "Runs independently on each T4 (:8188 / :8189) for fast cel-shaded panels.",
    supportedTasks: ["txt2img", "character_turnaround", "portrait", "storyboard_fast"],
    bestStyles: ["anime_clean_cel"],
    goodStyles: ["anime_vibrant", "lineart_sketch"],
    defaultIp: "style_aligned",
    supportedIp: ["style_aligned", "noob_ipa_mk1", "none"],
    supportedControlNets: ["canny", "lineart_anime", "openpose", "none"],
    supportsRelight: ["none"],
    supportsMultiChar: true,
    speedTier: "balanced",
    vramEstimateGb: 7.2,
    requiredModelFilenames: ["animagine-xl-4.0-opt.safetensors", "sdxl_vae_fp16_fix.safetensors"],
    strengths: ["Crisp TV-anime cel shading and reliable clean facial expressions"],
    tradeoffs: ["Fewer painterly/gritty shadows than NoobAI V-Pred"],
    buildSpec: (intent) => ({
      pipeline: "animagine_v4",
      architecture: "animagine",
      stylePreset: intent.stylePreset,
      baseModel: "animagine-xl-4.0-opt.safetensors",
      ipConnectors:
        intent.consistencyMode !== "none"
          ? [{ mode: intent.consistencyMode === "noob_ipa_mk1" ? "noob_ipa_mk1" : "style_aligned", weight: 0.7 }]
          : undefined,
      controlNets:
        intent.controlNetMode !== "none"
          ? [{ mode: intent.controlNetMode, strength: 0.75 }]
          : undefined,
      prompt: intent.promptHint,
    }),
  },
  {
    id: "anima-turbo-ref-v2",
    title: "Anima Turbo v1.0 GGUF + Ref Adapter v2 (Fast 8-Step Anime DiT)",
    architecture: "anima_v1",
    targetProfile: "IMAGE_GGUF_EDIT",
    t4ExecutionMode: "single_t4",
    t4DevicePlan: "Ultra-compact 2B DiT (~5.8 GB VRAM) runs cleanly on a single 16 GB T4 with headroom.",
    supportedTasks: ["txt2img", "storyboard_fast", "consistent_ip", "character_turnaround", "controlnet_guided"],
    bestStyles: ["anime_vibrant", "anime_clean_cel"],
    goodStyles: ["painterly_fantasy", "manhwa_webtoon"],
    defaultIp: "anima_ref_v2",
    supportedIp: ["anima_ref_v2", "none"],
    supportedControlNets: ["lineart_anime", "depth", "openpose", "none"],
    supportsRelight: ["none"],
    supportsMultiChar: false,
    speedTier: "fast",
    vramEstimateGb: 6.5,
    requiredModelFilenames: [
      "anima-turbo-v1.0-Q5_K_M.gguf",
      "qwen_3_06b_base.safetensors",
      "qwen_image_vae.safetensors",
    ],
    licenseNote: "Non-commercial research & story visualization",
    strengths: [
      "Fast 8-step Anime DiT in ~6.5 GB VRAM + native Anima Ref Adapter v2 character lock",
      "Supports ultra-light LLLite lineart, depth, and openpose ControlNets",
    ],
    tradeoffs: ["Less battle-tested on multi-character scenes than MOSS-Image or ComfyCouple"],
    buildSpec: (intent) => ({
      pipeline: "anima_v1",
      architecture: "anima_v1",
      stylePreset: intent.stylePreset,
      baseModel: "anima-turbo-v1.0-Q5_K_M.gguf",
      ipConnectors:
        intent.consistencyMode !== "none" ? [{ mode: "anima_ref_v2", weight: 0.78 }] : undefined,
      controlNets:
        intent.controlNetMode !== "none" ? [{ mode: intent.controlNetMode, strength: 0.8 }] : undefined,
      steps: 8,
      cfg: 2.0,
      prompt: intent.promptHint,
    }),
  },
  {
    id: "flux3-klein-dual-t4",
    title: "FLUX 3 Image Klein INT8 ConvRot (Dual-T4 Split · Multi-Style)",
    architecture: "flux3_klein",
    targetProfile: "IMAGE_DIT_DUAL_T4",
    t4ExecutionMode: "dual_t4_split",
    t4DevicePlan: "CUDA:0 holds FLUX 3 Klein INT8 ConvRot + VAE; CUDA:1 holds Qwen3.5-9B Prompt Upsampler.",
    supportedTasks: ["txt2img", "consistent_ip", "multi_char_scene", "portrait", "storyboard_fast", "image_edit"],
    bestStyles: ["painterly_fantasy", "photoreal_cinematic", "manhwa_webtoon"],
    goodStyles: ["anime_vibrant", "anime_dramatic_vpred", "gothic_dark"],
    defaultIp: "flux3_ref_latent",
    supportedIp: ["flux3_ref_latent", "none"],
    supportedControlNets: ["none"],
    supportsRelight: ["lbm_relight", "none"],
    supportsMultiChar: true,
    speedTier: "fast",
    vramEstimateGb: 18.0,
    requiredModelFilenames: [
      "flux3-image-klein-int8-convrot.safetensors",
      "qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors",
      "flux2-vae.safetensors",
    ],
    strengths: [
      "Best natural-language prompt adherence, scene typography, & painterly fantasy fidelity",
      "Zero-trainer ReferenceLatent subject lock on Dual-T4 32 GB aggregate VRAM",
    ],
    tradeoffs: ["Occupies both T4 GPUs (:8188 single process) so batch throughput is 1 scene at a time"],
    buildSpec: (intent) => ({
      pipeline: "flux3_klein",
      architecture: "flux3_klein",
      stylePreset: intent.stylePreset,
      baseModel: "flux3-image-klein-int8-convrot.safetensors",
      dualGpuSplit: true,
      ipConnectors:
        intent.consistencyMode !== "none" ? [{ mode: "flux3_ref_latent", weight: 0.8 }] : undefined,
      relight: intent.relight,
      steps: intent.speedPriority === "quality" ? 20 : 12,
      cfg: 1.0,
      prompt: intent.promptHint,
    }),
  },
  {
    id: "moss-image-dual-t4-dmd2",
    title: "MOSS-Image 5B INT8 + 8-Step DMD2 (Multi-Char Webtoon Dual-T4)",
    architecture: "moss_image",
    targetProfile: "IMAGE_DIT_DUAL_T4",
    t4ExecutionMode: "dual_t4_split",
    t4DevicePlan: "CUDA:0 runs MOSS SFT INT8 ConvRot + 8-step DMD2 LoRA; CUDA:1 runs Qwen3.5-9B INT8.",
    supportedTasks: ["multi_char_scene", "storyboard_fast", "txt2img", "controlnet_guided"],
    bestStyles: ["manhwa_webtoon", "painterly_fantasy"],
    goodStyles: ["anime_vibrant", "photoreal_cinematic"],
    defaultIp: "none",
    supportedIp: ["none"],
    supportedControlNets: ["moss_color_depth", "none"],
    supportsRelight: ["none", "lbm_relight"],
    supportsMultiChar: true,
    speedTier: "fast",
    vramEstimateGb: 17.5,
    requiredModelFilenames: [
      "moss_image_sft_int8_convrot.safetensors",
      "qwen3.5_9b_int8_convrot.safetensors",
      "flux2-vae.safetensors",
      "moss_image_base_dmd2_v2_bf16.safetensors",
    ],
    strengths: [
      "Cleanest spatial blocking for 2–4 distinct characters in one comic/manhwa panel",
      "8-step DMD2 distillation keeps Dual-T4 inference fast (~10-15s)",
    ],
    tradeoffs: ["Uses spatial ConditioningSetArea rather than SDXL IP-Adapters"],
    buildSpec: (intent) => ({
      pipeline: "moss_image",
      architecture: "moss_image",
      stylePreset: intent.stylePreset,
      baseModel: "moss_image_sft_int8_convrot.safetensors",
      dualGpuSplit: true,
      loras: [{ filename: "moss_image_base_dmd2_v2_bf16.safetensors", strength: 1.0 }],
      controlNets:
        intent.controlNetMode !== "none" ? [{ mode: "moss_color_depth", strength: 0.85 }] : undefined,
      steps: 8,
      cfg: 1.0,
      prompt: intent.promptHint,
    }),
  },
  {
    id: "qwen21-turbo-dual-t4",
    title: "Qwen-Image 2.1 Turbo INT8 ConvRot (Dual-T4 Split)",
    architecture: "qwen21",
    targetProfile: "IMAGE_DIT_DUAL_T4",
    t4ExecutionMode: "dual_t4_split",
    t4DevicePlan: "CUDA:0 holds Qwen 2.1 Turbo INT8 + VAE; CUDA:1 holds Qwen3.5-9B PE Encoder.",
    supportedTasks: ["consistent_ip", "txt2img", "image_edit", "controlnet_guided", "storyboard_fast"],
    bestStyles: ["anime_dramatic_vpred", "manhwa_webtoon", "photoreal_cinematic"],
    goodStyles: ["anime_vibrant", "painterly_fantasy"],
    defaultIp: "qwen21_ref_strength",
    supportedIp: ["qwen21_ref_strength", "none"],
    supportedControlNets: ["qwen_fun_union", "canny", "depth", "openpose", "none"],
    supportsRelight: ["qwen_light_migration", "none"],
    supportsMultiChar: true,
    speedTier: "fast",
    vramEstimateGb: 20.5,
    requiredModelFilenames: [
      "qwen_image_2.1_turbo_int8_convrot.safetensors",
      "qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors",
      "qwen_image_2.1_vae_bf16.safetensors",
    ],
    licenseNote: "Non-commercial research & story visualization",
    strengths: [
      "Superb East-Asian webnovel aesthetic + crisp multi-language scene typography",
      "Pairs natively with Qwen 2.1 Fun ControlNet Union INT8 & 8-step turbo sampling",
    ],
    tradeoffs: ["Requires full Dual-T4 split (:8188 single process)"],
    buildSpec: (intent) => ({
      pipeline: "qwen21_edit",
      architecture: "qwen21",
      stylePreset: intent.stylePreset,
      baseModel: "qwen_image_2.1_turbo_int8_convrot.safetensors",
      dualGpuSplit: true,
      ipConnectors:
        intent.consistencyMode !== "none" ? [{ mode: "qwen21_ref_strength", weight: 0.78 }] : undefined,
      controlNets:
        intent.controlNetMode !== "none" ? [{ mode: "qwen_fun_union", strength: 0.75 }] : undefined,
      steps: 8,
      cfg: 1.0,
      prompt: intent.promptHint,
    }),
  },
  {
    id: "netayume-lumina-gothic",
    title: "NetaYume Lumina v4 All-in-One (Gothic & Atmospheric Anime)",
    architecture: "neta_lumina",
    targetProfile: "IMAGE_CORE",
    t4ExecutionMode: "dual_t4_parallel",
    t4DevicePlan: "All-in-one checkpoint fits inside single T4 (:8188 / :8189).",
    supportedTasks: ["txt2img", "portrait"],
    bestStyles: ["gothic_dark", "painterly_fantasy"],
    goodStyles: ["anime_dramatic_vpred"],
    defaultIp: "none",
    supportedIp: ["none"],
    supportedControlNets: ["none"],
    supportsRelight: ["none"],
    supportsMultiChar: false,
    speedTier: "balanced",
    vramEstimateGb: 8.5,
    requiredModelFilenames: ["NetaYume_v4_all_in_one.safetensors"],
    strengths: ["Dense long-prompt understanding with soft gothic anime atmosphere"],
    tradeoffs: ["Minimal ControlNet/IP-Adapter support compared to SDXL/Illustrious"],
    buildSpec: (intent) => ({
      pipeline: "neta_lumina",
      architecture: "neta_lumina",
      stylePreset: intent.stylePreset,
      baseModel: "NetaYume_v4_all_in_one.safetensors",
      prompt: intent.promptHint,
    }),
  },
  {
    id: "qwen-edit-relight-composite",
    title: "Qwen-Image-Edit 2511 + Light-Migration / LBM Relight",
    architecture: "qwen_edit",
    targetProfile: "IMAGE_GGUF_EDIT",
    t4ExecutionMode: "single_t4",
    t4DevicePlan: "Runs Qwen-Edit GGUF Q4_K_M + 4-Step Lightning in ~14.5 GB on Single-T4.",
    supportedTasks: ["relight_composite", "image_edit"],
    bestStyles: ["photoreal_cinematic", "painterly_fantasy", "anime_vibrant"],
    goodStyles: ["anime_dramatic_vpred", "manhwa_webtoon"],
    defaultIp: "none",
    supportedIp: ["none"],
    supportedControlNets: ["none"],
    supportsRelight: ["qwen_light_migration", "lbm_relight"],
    supportsMultiChar: false,
    speedTier: "fast",
    vramEstimateGb: 14.5,
    requiredModelFilenames: [
      "qwen-image-edit-2511-Q4_K_M.gguf",
      "qwen_2.5_vl_7b_fp8_scaled.safetensors",
      "qwen_image_vae.safetensors",
      "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
    ],
    strengths: ["Matches subject illumination & color temperature cleanly onto new scene backgrounds in 4 steps"],
    tradeoffs: ["Requires a source reference image input"],
    buildSpec: (intent) => ({
      pipeline: "qwen_edit",
      architecture: "qwen_edit",
      stylePreset: intent.stylePreset,
      baseModel: "qwen-image-edit-2511-Q4_K_M.gguf",
      relight: intent.relight === "none" ? "qwen_light_migration" : intent.relight,
      steps: 4,
      cfg: 1.0,
      prompt: intent.promptHint,
    }),
  },
  {
    id: "qwen-360-panorama-world",
    title: "Qwen-Image 2512 + qwen-360-diffusion (360° World Environment)",
    architecture: "qwen_360",
    targetProfile: "IMAGE_DIT_DUAL_T4",
    t4ExecutionMode: "dual_t4_split",
    t4DevicePlan: "Dual-T4 split generates seamless 2:1 equirectangular skyboxes with 360° preview.",
    supportedTasks: ["panorama_360"],
    bestStyles: ["panorama_360", "painterly_fantasy", "photoreal_cinematic"],
    goodStyles: ["anime_vibrant", "gothic_dark"],
    defaultIp: "none",
    supportedIp: ["none"],
    supportedControlNets: ["none"],
    supportsRelight: ["none"],
    supportsMultiChar: false,
    speedTier: "quality",
    vramEstimateGb: 18.0,
    requiredModelFilenames: [
      "qwen-image-2512-Q4_K_M.gguf",
      "qwen_2.5_vl_7b_fp8_scaled.safetensors",
      "qwen_image_vae.safetensors",
      "qwen-360-diffusion-2512-int8-bf16-v2.safetensors",
    ],
    strengths: ["Wrap-free 2:1 spherical environments for interactive 3D/VR story backdrops"],
    tradeoffs: ["Only for environment panoramas, not close-up portraits"],
    buildSpec: (intent) => ({
      pipeline: "panorama_360",
      architecture: "qwen_360",
      stylePreset: "panorama_360",
      baseModel: "qwen-image-2512-Q4_K_M.gguf",
      dualGpuSplit: true,
      enable360Preview: true,
      width: 1536,
      height: 768,
      prompt: intent.promptHint,
    }),
  },
  {
    id: "dreamshaper-juggernaut-photoreal",
    title: "DreamShaper XL Turbo / Juggernaut XL v9 (Fast SDXL / Photoreal)",
    architecture: "sdxl_illustrious",
    targetProfile: "IMAGE_CORE",
    t4ExecutionMode: "dual_t4_parallel",
    t4DevicePlan: "Runs independently on T4 :8188 & :8189 in ~5-12s per panel.",
    supportedTasks: ["storyboard_fast", "txt2img", "portrait", "consistent_ip"],
    bestStyles: ["photoreal_cinematic"],
    goodStyles: ["painterly_fantasy"],
    defaultIp: "sdxl_ipa_photoreal",
    supportedIp: ["sdxl_ipa_photoreal", "style_aligned", "none"],
    supportedControlNets: ["canny", "depth", "openpose", "none"],
    supportsRelight: ["lbm_relight", "none"],
    supportsMultiChar: true,
    speedTier: "fast",
    vramEstimateGb: 7.2,
    requiredModelFilenames: ["Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors", "sdxl_vae_fp16_fix.safetensors"],
    strengths: ["Fastest SDXL photorealistic live-action & filmic storyboards across parallel T4s"],
    tradeoffs: ["Less authentic for 2D anime/manga line styles than Illustrious/NoobAI"],
    buildSpec: (intent) => {
      const useTurbo = intent.task === "storyboard_fast" || intent.speedPriority === "fast";
      return {
        pipeline: "sdxl_txt2img",
        architecture: "sdxl_illustrious",
        stylePreset: intent.stylePreset,
        baseModel: useTurbo
          ? "DreamShaperXL_Turbo_v2_1.safetensors"
          : "Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors",
        ipConnectors:
          intent.consistencyMode !== "none" ? [{ mode: "sdxl_ipa_photoreal", weight: 0.7 }] : undefined,
        controlNets:
          intent.controlNetMode !== "none" ? [{ mode: intent.controlNetMode, strength: 0.75 }] : undefined,
        steps: useTurbo ? 7 : 26,
        cfg: useTurbo ? 2.0 : 5.5,
        prompt: intent.promptHint,
      };
    },
  },
];

/**
 * Deterministic keyword intent classifier used as baseline and when LLM keys are not configured.
 */
export function inferIntentFromGoal(input: RecommendWorkflowInput): InferredWorkflowIntent {
  const g = (input.goal || "").toLowerCase();

  let task: RecommendationTaskType = input.task || "txt2img";
  if (!input.task) {
    if (/360|panorama|equirectangular|vr world|skybox/.test(g)) task = "panorama_360";
    else if (/relight|lighting match|composite|replace light/.test(g)) task = "relight_composite";
    else if (/turnaround|character sheet|multi angle|reference sheet/.test(g)) task = "character_turnaround";
    else if (/two char|2 char|three char|group|duo|couple|dialogue scene|crowd|vs /.test(g)) task = "multi_char_scene";
    else if (/consistent|same character|identity|ip[- ]?adapter|recurring|match ref/.test(g)) task = "consistent_ip";
    else if (/pose|openpose|depth|canny|lineart|sketch to|controlnet/.test(g)) task = "controlnet_guided";
    else if (/edit|change outfit|swap background|inpaint/.test(g)) task = "image_edit";
    else if (/storyboard|quick draft|fast preview|rapid/.test(g)) task = "storyboard_fast";
    else if (/portrait|close-up|closeup|face/.test(g)) task = "portrait";
  }

  let stylePreset: StylePresetId = input.stylePreset || "anime_vibrant";
  if (!input.stylePreset) {
    if (task === "panorama_360") stylePreset = "panorama_360";
    else if (/dramatic|v-pred|vpred|neon|chiaroscuro|dark battle|night rain|action anime/.test(g)) stylePreset = "anime_dramatic_vpred";
    else if (/manhwa|webtoon|korean comic|solo leveling|vertical panel/.test(g)) stylePreset = "manhwa_webtoon";
    else if (/cel|tv anime|clean studio|animagine|chibi|slice of life/.test(g)) stylePreset = "anime_clean_cel";
    else if (/gothic|noir|moody|horror|lumina/.test(g)) stylePreset = "gothic_dark";
    else if (/painterly|fantasy art|oil|concept art|semi[- ]?real/.test(g)) stylePreset = "painterly_fantasy";
    else if (/lineart|ink|sketch|manga black/.test(g)) stylePreset = "lineart_sketch";
    else if (/photoreal|live[- ]?action|cinematic film|realistic|photography/.test(g)) stylePreset = "photoreal_cinematic";
  }

  let controlNetMode: ControlNetMode = input.controlNetMode || "none";
  if (controlNetMode === "none") {
    if (/openpose|pose/.test(g)) controlNetMode = "openpose";
    else if (/lineart|sketch/.test(g)) controlNetMode = "lineart_anime";
    else if (/depth/.test(g)) controlNetMode = "depth";
    else if (/canny|edge/.test(g)) controlNetMode = "canny";
  }

  let relight: RelightMode = input.relight || "none";
  if (relight === "none") {
    if (/lbm/.test(g)) relight = "lbm_relight";
    else if (/relight|light migration|match lighting/.test(g)) relight = "qwen_light_migration";
  }

  const characterCount = input.characterCount ?? (task === "multi_char_scene" ? 2 : 1);
  const speedPriority: SpeedPriority =
    input.speedPriority || (task === "storyboard_fast" || /\bfast\b|\bturbo\b|\b8-?step\b/.test(g) ? "fast" : "balanced");

  let consistencyMode: IpConnectorMode | "none" =
    input.consistencyMode && input.consistencyMode !== "auto" ? input.consistencyMode : "none";
  if (input.consistencyMode === "auto" || (!input.consistencyMode && (task === "consistent_ip" || /consistent|same character|style aligned/.test(g)))) {
    consistencyMode = /style ?align|batch/.test(g)
      ? "style_aligned"
      : stylePreset === "photoreal_cinematic"
      ? "sdxl_ipa_photoreal"
      : "noob_ipa_mk1";
  }

  return {
    task,
    stylePreset,
    consistencyMode,
    controlNetMode,
    relight,
    characterCount,
    speedPriority,
    promptHint: (input.goal || "storytelling keyframe illustration").trim(),
  };
}

/**
 * Ranks the Top-3 workflow stacks across Task x Style x IP-Connector x ControlNet x T4 Cluster State.
 * Non-commercial visualization service: zero commercial-license filtering is applied.
 */
export async function recommendWorkflowStacks(
  userId: string,
  input: RecommendWorkflowInput
): Promise<{
  inferredIntent: InferredWorkflowIntent;
  recommendations: WorkflowStackRecommendation[];
  onlineTargets: Array<{ target: string; workerProfile: string }>;
}> {
  await ensureUserCatalogSeeded(userId);
  const intent = inferIntentFromGoal(input);

  const [assets, vms] = await Promise.all([
    prisma.modelAsset.findMany({
      where: { userId },
      select: { slug: true, category: true, filename: true, backupStatus: true, gdrivePath: true },
    }),
    prisma.vmInstance.findMany({
      where: { userId },
      select: {
        target: true,
        status: true,
        workerProfile: true,
        publicUrl: true,
        vmSecret: true,
        internalPort: true,
        useRouteLess: true,
      },
    }),
  ]);

  const assetByFile = new Map(assets.map((a) => [a.filename.toLowerCase(), a]));
  const onlineVms = vms.filter((v) => v.status === "ONLINE" && v.publicUrl);

  // Best-effort warm file cache lookup across online ComfyUI GPUs
  const warmFileSet = new Set<string>();
  await Promise.all(
    onlineVms
      .filter((v) => !v.workerProfile.startsWith("LLM_") && !v.target.startsWith("tpu"))
      .slice(0, 4)
      .map(async (vm) => {
        try {
          const cat = await new ComfyClient(vm).getCatalog(vm.target);
          [
            ...cat.models.checkpoints,
            ...cat.models.loras,
            ...cat.models.vaes,
            ...cat.models.controlnets,
            ...cat.models.ipadapters,
            ...cat.models.clip_vision,
          ].forEach((f) => warmFileSet.add(f.toLowerCase()));
        } catch {
          // Offline / timeout safe fallback
        }
      })
  );

  const onlineProfileSet = new Set(onlineVms.map((v) => v.workerProfile));

  const scored = STACK_RECIPES.map((recipe) => {
    let score = 40;
    const reasons: string[] = [];

    if (recipe.supportedTasks.includes(intent.task)) {
      const idx = recipe.supportedTasks.indexOf(intent.task);
      score += idx === 0 ? 25 : 17;
      reasons.push(`Designed for '${intent.task.replace(/_/g, " ")}' tasks.`);
    } else if (intent.task === "panorama_360" || intent.task === "relight_composite") {
      score -= 30;
    }

    if (recipe.bestStyles.includes(intent.stylePreset)) {
      score += 24;
      reasons.push(`Top-tier aesthetic match for '${intent.stylePreset.replace(/_/g, " ")}'.`);
    } else if (recipe.goodStyles.includes(intent.stylePreset)) {
      score += 12;
      reasons.push(`Strong style compatibility for '${intent.stylePreset.replace(/_/g, " ")}'.`);
    }

    if (intent.characterCount >= 2 && recipe.supportsMultiChar) {
      score += recipe.architecture === "moss_image" || recipe.architecture === "sdxl_illustrious" ? 12 : 6;
      reasons.push("Supports multi-character spatial isolation cleanly.");
    } else if (intent.characterCount >= 2 && !recipe.supportsMultiChar) {
      score -= 10;
    }

    if (intent.consistencyMode !== "none") {
      if (recipe.defaultIp !== "none") {
        score += 10;
        reasons.push(`Native identity/style connector (${recipe.defaultIp}).`);
      } else {
        score -= 8;
      }
    }

    if (intent.controlNetMode !== "none") {
      if (recipe.supportedControlNets.includes(intent.controlNetMode)) {
        score += 10;
        reasons.push(`Supports '${intent.controlNetMode}' ControlNet guidance.`);
      } else {
        score -= 12;
      }
    }

    if (intent.relight !== "none" && recipe.supportsRelight.includes(intent.relight)) {
      score += 12;
      reasons.push(`Supports '${intent.relight}' lighting harmonization.`);
    }

    if (intent.speedPriority === recipe.speedTier) {
      score += 8;
    }

    const readinessSummary: ModelReadinessItem[] = recipe.requiredModelFilenames.map((fname) => {
      const row = assetByFile.get(fname.toLowerCase());
      const readiness: ModelCacheReadiness = warmFileSet.has(fname.toLowerCase())
        ? "WARM_ON_GPU"
        : row && (row.backupStatus === "BACKED_UP" || Boolean(row.gdrivePath))
        ? "IN_DRIVE"
        : "MIRROR_READY";
      return {
        category: row?.category || "checkpoints",
        filename: fname,
        slug: row?.slug,
        readiness,
      };
    });

    const warmCount = readinessSummary.filter((r) => r.readiness === "WARM_ON_GPU").length;
    const inDriveCount = readinessSummary.filter((r) => r.readiness === "IN_DRIVE").length;

    if (onlineProfileSet.has(recipe.targetProfile)) {
      score += input.preferWarmCache ? 14 : 8;
      reasons.push(`Matching worker profile (${recipe.targetProfile}) is currently ONLINE.`);
    }
    score += warmCount * (input.preferWarmCache ? 6 : 3);
    score += inDriveCount * 2;

    const chosenIp =
      intent.consistencyMode !== "none"
        ? recipe.supportedIp.includes(intent.consistencyMode)
          ? intent.consistencyMode
          : recipe.defaultIp
        : "none";

    const chosenCn =
      intent.controlNetMode !== "none"
        ? recipe.supportedControlNets.includes(intent.controlNetMode)
          ? intent.controlNetMode
          : recipe.supportedControlNets[0]
        : "none";

    const chosenRelight: RelightMode =
      intent.relight !== "none" && recipe.supportsRelight.includes(intent.relight)
        ? intent.relight
        : "none";

    const spec = recipe.buildSpec({
      ...intent,
      consistencyMode: chosenIp,
      controlNetMode: chosenCn,
      relight: chosenRelight,
    });

    const tuned = tunePromptForArchitecture(
      intent.promptHint,
      "",
      recipe.architecture,
      intent.stylePreset
    );

    return {
      recipe,
      score,
      reasons: reasons.length > 0 ? reasons : recipe.strengths,
      chosenIp,
      chosenCn,
      chosenRelight,
      spec,
      tuned,
      readinessSummary,
      warmCount,
      inDriveCount,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const top3 = scored.slice(0, 3);

  const recommendations: WorkflowStackRecommendation[] = await Promise.all(
    top3.map(async (item, i) => {
      const compiled = input.includeCompiledGraph
        ? await compileResourceAwareWorkflow(userId, item.spec).catch(() => undefined)
        : undefined;

      return {
        rank: i + 1,
        recipeId: item.recipe.id,
        title: item.recipe.title,
        score: Math.max(0, Math.min(100, Math.round(item.score))),
        architecture: item.recipe.architecture,
        targetProfile: item.recipe.targetProfile,
        t4ExecutionMode: item.recipe.t4ExecutionMode,
        t4DevicePlan: item.recipe.t4DevicePlan,
        whyRecommended: [...item.reasons, ...item.recipe.strengths].slice(0, 4),
        tradeoffs: item.recipe.tradeoffs,
        ipConnectorRecommended: item.chosenIp,
        controlNetRecommended: item.chosenCn,
        relightRecommended: item.chosenRelight,
        licenseNote: item.recipe.licenseNote,
        vramEstimateGb: compiled?.vramEstimateGb ?? item.recipe.vramEstimateGb,
        recommendedSpec: item.spec,
        tunedPromptSample: {
          positive: item.tuned.positive,
          negative: item.tuned.negative,
        },
        readinessSummary: item.readinessSummary,
        warmCount: item.warmCount,
        inDriveCount: item.inDriveCount,
        ...(compiled ? { compiled } : {}),
      };
    })
  );

  return {
    inferredIntent: intent,
    recommendations,
    onlineTargets: onlineVms.map((v) => ({ target: v.target, workerProfile: v.workerProfile })),
  };
}
