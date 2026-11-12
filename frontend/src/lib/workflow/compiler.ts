import { prisma } from "@/lib/db/prisma";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import { getOrCreateWorkspaceSettings } from "@/lib/settings/workspace-settings";
import type { WorkerProfileId } from "@/lib/catalog/worker-profiles";

export type WorkflowPipelineKind =
  | "sdxl_txt2img"
  | "sdxl_detailer_upscale"
  | "flux_gguf"
  | "qwen_edit"
  | "audio_kokoro"
  | "audio_f5"
  | "audio_mmaudio"
  | "audio_stable"
  | "video_ltx"
  | "video_latentsync";

export interface LoraSlotSpec {
  filename: string;
  strength?: number;
}

export interface WorkflowBuildSpec {
  pipeline: WorkflowPipelineKind;
  baseModel?: string;
  vaeModel?: string;
  textEncoder1?: string;
  textEncoder2?: string;
  loras?: LoraSlotSpec[];
  upscalerModel?: string;
  enableFaceDetailer?: boolean;
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  batchSize?: number;
  seed?: number;
  // Multimodal parameters
  dialogueText?: string;
  voice?: string;
  speed?: number;
  bgmMood?: string;
  durationSec?: number;
  sfxPrompt?: string;
  refImagePath?: string;
  refAudioPath?: string;
  videoPath?: string;
  numFrames?: number;
}

export interface RequiredModelRef {
  category: string;
  filename: string;
  slug?: string;
}

export interface CompiledWorkflowResult {
  pipeline: WorkflowPipelineKind;
  modality: "IMAGE" | "AUDIO" | "VIDEO";
  recommendedProfile: WorkerProfileId;
  requiredNodes: string[];
  requiredModels: RequiredModelRef[];
  vramEstimateGb: number;
  vramStatus: "SAFE" | "TIGHT" | "OVER_T4_LIMIT";
  t4GuardrailsApplied: string[];
  warnings: string[];
  graph: Record<string, unknown>;
}

const DEFAULT_VRAM_BY_PIPELINE: Record<WorkflowPipelineKind, number> = {
  sdxl_txt2img: 7.4,
  sdxl_detailer_upscale: 10.6,
  flux_gguf: 13.8,
  qwen_edit: 14.5,
  audio_kokoro: 0.6,
  audio_f5: 2.5,
  audio_mmaudio: 3.2,
  audio_stable: 3.8,
  video_ltx: 7.8,
  video_latentsync: 5.2,
};

export function detectPipelineFromModalityAndModel(
  modality?: string,
  baseModelFilename?: string
): WorkflowPipelineKind {
  const m = (modality || "").toUpperCase();
  const f = (baseModelFilename || "").toLowerCase();
  if (f.includes("flux")) return "flux_gguf";
  if (f.includes("qwen")) return "qwen_edit";
  if (f.includes("kokoro")) return "audio_kokoro";
  if (f.includes("f5")) return "audio_f5";
  if (f.includes("mmaudio")) return "audio_mmaudio";
  if (f.includes("stable-audio") || f.includes("stable_audio")) return "audio_stable";
  if (f.includes("latentsync")) return "video_latentsync";
  if (f.includes("ltx") || f.includes("wan") || m === "VIDEO") return "video_ltx";
  if (m === "AUDIO") return "audio_kokoro";
  return "sdxl_txt2img";
}

export async function compileResourceAwareWorkflow(
  userId: string,
  spec: WorkflowBuildSpec,
  targetVm?: string
): Promise<CompiledWorkflowResult> {
  const [settings, userAssets, vm] = await Promise.all([
    getOrCreateWorkspaceSettings(userId),
    prisma.modelAsset.findMany({ where: { userId } }),
    targetVm
      ? prisma.vmInstance.findUnique({ where: { userId_target: { userId, target: targetVm } } })
      : Promise.resolve(null),
  ]);

  const byFilename = new Map(userAssets.map((a) => [a.filename.toLowerCase(), a]));
  const guardrails: string[] = [];
  const warnings: string[] = [];
  const requiredModels: RequiredModelRef[] = [];

  const registerModel = (category: string, filename?: string) => {
    if (!filename) return;
    const asset = byFilename.get(filename.toLowerCase());
    if (!requiredModels.some((m) => m.filename === filename && m.category === category)) {
      requiredModels.push({ category, filename, slug: asset?.slug });
    }
  };

  const seed = spec.seed ?? Math.floor(Math.random() * 2_000_000_000);
  const pipeline = spec.pipeline || "sdxl_txt2img";
  let vramEstimate = DEFAULT_VRAM_BY_PIPELINE[pipeline] ?? 8.0;
  let recommendedProfile: WorkerProfileId = "BASE_COMFY";
  let modality: "IMAGE" | "AUDIO" | "VIDEO" = "IMAGE";
  let requiredNodes: string[] = [];
  let graph: Record<string, unknown> = {};

  if (pipeline === "sdxl_txt2img" || pipeline === "sdxl_detailer_upscale") {
    const ckpt = spec.baseModel || "waiNSFWIllustrious_v110.safetensors";
    registerModel("checkpoints", ckpt);

    let vae = spec.vaeModel;
    if (!vae && settings.autoVaeFixSdxl) {
      vae = "sdxl_vae_fp16_fix.safetensors";
      guardrails.push("Auto-injected sdxl_vae_fp16_fix.safetensors (16 GB T4 NaN prevention).");
    }
    if (vae) registerModel("vae", vae);

    const loras = (spec.loras || []).filter((l) => Boolean(l.filename)).slice(0, 3);
    loras.forEach((l) => registerModel("loras", l.filename));

    const width = spec.width ?? 1024;
    const height = spec.height ?? 1024;
    const batchSize = Math.min(4, Math.max(1, spec.batchSize ?? 1));

    const nodes: Record<string, unknown> = {
      "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
      "2": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: batchSize } },
    };

    let modelRef: [string, number] = ["1", 0];
    let clipRef: [string, number] = ["1", 1];
    let vaeRef: [string, number] = ["1", 2];

    if (vae) {
      nodes["11"] = { class_type: "VAELoader", inputs: { vae_name: vae } };
      vaeRef = ["11", 0];
    }

    loras.forEach((l, idx) => {
      const nid = String(20 + idx);
      const strength = l.strength ?? 0.85;
      nodes[nid] = {
        class_type: "LoraLoader",
        inputs: {
          model: modelRef,
          clip: clipRef,
          lora_name: l.filename,
          strength_model: strength,
          strength_clip: strength,
        },
      };
      modelRef = [nid, 0];
      clipRef = [nid, 1];
      vramEstimate += 0.35;
    });

    nodes["3"] = {
      class_type: "CLIPTextEncode",
      inputs: { text: spec.prompt || "masterpiece, best quality, anime illustration", clip: clipRef },
    };
    nodes["4"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: spec.negativePrompt || "bad quality, blurry, deformed, lowres, watermark",
        clip: clipRef,
      },
    };
    nodes["5"] = {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: spec.steps ?? 24,
        cfg: spec.cfg ?? 6.0,
        sampler_name: spec.samplerName || "euler_ancestral",
        scheduler: spec.scheduler || "normal",
        denoise: 1.0,
        model: modelRef,
        positive: ["3", 0],
        negative: ["4", 0],
        latent_image: ["2", 0],
      },
    };
    nodes["6"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: vaeRef },
    };

    let finalImgRef: [string, number] = ["6", 0];
    requiredNodes = [
      "CheckpointLoaderSimple",
      "EmptyLatentImage",
      "CLIPTextEncode",
      "KSampler",
      "VAEDecode",
      "SaveImage",
    ];
    if (vae) requiredNodes.push("VAELoader");
    if (loras.length > 0) requiredNodes.push("LoraLoader");

    if (pipeline === "sdxl_detailer_upscale" && spec.enableFaceDetailer) {
      recommendedProfile = "IMAGE_CORE";
      registerModel("ultralytics", "face_yolov8m.pt");
      registerModel("sams", "sam_vit_b_01ec64.pth");
      nodes["30"] = {
        class_type: "UltralyticsDetectorProvider",
        inputs: { model_name: "bbox/face_yolov8m.pt" },
      };
      nodes["31"] = {
        class_type: "SAMLoader",
        inputs: { model_name: "sam_vit_b_01ec64.pth", device_mode: "AUTO" },
      };
      nodes["32"] = {
        class_type: "FaceDetailer",
        inputs: {
          image: finalImgRef,
          model: modelRef,
          clip: clipRef,
          vae: vaeRef,
          positive: ["3", 0],
          negative: ["4", 0],
          bbox_detector: ["30", 0],
          sam_model_opt: ["31", 0],
          guide_size: 384,
          guide_size_for: true,
          max_size: 1024,
          seed,
          steps: 14,
          cfg: spec.cfg ?? 6.0,
          sampler_name: spec.samplerName || "euler_ancestral",
          scheduler: spec.scheduler || "normal",
          denoise: 0.45,
          feather: 5,
          noise_mask: true,
          force_inpaint: true,
          bbox_threshold: 0.5,
          bbox_dilation: 10,
          bbox_crop_factor: 3.0,
          sam_detection_hint: "center-1",
          sam_dilation: 0,
          sam_threshold: 0.93,
          sam_bbox_expansion: 0,
          sam_mask_hint_threshold: 0.7,
          sam_mask_hint_use_negative: "False",
          drop_size: 10,
          wildcard: "",
          cycle: 1,
        },
      };
      finalImgRef = ["32", 0];
      vramEstimate += 1.6;
      requiredNodes.push("UltralyticsDetectorProvider", "SAMLoader", "FaceDetailer");
    }

    if (spec.upscalerModel) {
      registerModel("upscale_models", spec.upscalerModel);
      nodes["40"] = {
        class_type: "UpscaleModelLoader",
        inputs: { model_name: spec.upscalerModel },
      };
      nodes["41"] = {
        class_type: "ImageUpscaleWithModel",
        inputs: { upscale_model: ["40", 0], image: finalImgRef },
      };
      finalImgRef = ["41", 0];
      vramEstimate += 1.1;
      requiredNodes.push("UpscaleModelLoader", "ImageUpscaleWithModel");
    }

    if (width * height > 1344 * 1024) {
      warnings.push("High base resolution (>1.3M px) on 16 GB T4; consider 1024x1024 + upscaler.");
      vramEstimate += 1.2;
    }

    nodes["7"] = {
      class_type: "SaveImage",
      inputs: { filename_prefix: "Scriptoria_Studio", images: finalImgRef },
    };
    graph = nodes;
  } else if (pipeline === "flux_gguf") {
    recommendedProfile = "IMAGE_GGUF_EDIT";
    const unet = spec.baseModel || "flux1-dev-Q4_K_S.gguf";
    const t5 = spec.textEncoder1 || "t5-v1_1-xxl-encoder-Q4_K_M.gguf";
    const clipL = spec.textEncoder2 || "clip_l.safetensors";
    const vae = spec.vaeModel || "ae.safetensors";
    registerModel("unet", unet);
    registerModel("text_encoders", t5);
    registerModel("clip", clipL);
    registerModel("vae", vae);

    guardrails.push("Selected quantized Q4_K_S UNet + Q4_K_M T5 encoder to fit inside 16 GB T4.");
    requiredNodes = [
      "UnetLoaderGGUF",
      "DualCLIPLoaderGGUF",
      "VAELoader",
      "CLIPTextEncode",
      "EmptyLatentImage",
      "KSampler",
      "VAEDecode",
      "SaveImage",
    ];
    graph = {
      "1": { class_type: "UnetLoaderGGUF", inputs: { unet_name: unet } },
      "2": {
        class_type: "DualCLIPLoaderGGUF",
        inputs: { clip_name1: t5, clip_name2: clipL, type: "flux" },
      },
      "3": { class_type: "VAELoader", inputs: { vae_name: vae } },
      "4": {
        class_type: "CLIPTextEncode",
        inputs: { text: spec.prompt || "cinematic concept art", clip: ["2", 0] },
      },
      "5": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["2", 0] } },
      "6": {
        class_type: "EmptyLatentImage",
        inputs: { width: spec.width ?? 1024, height: spec.height ?? 1024, batch_size: 1 },
      },
      "7": {
        class_type: "KSampler",
        inputs: {
          seed,
          steps: spec.steps ?? 20,
          cfg: spec.cfg ?? 1.0,
          sampler_name: spec.samplerName || "euler",
          scheduler: spec.scheduler || "simple",
          denoise: 1.0,
          model: ["1", 0],
          positive: ["4", 0],
          negative: ["5", 0],
          latent_image: ["6", 0],
        },
      },
      "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
      "9": {
        class_type: "SaveImage",
        inputs: { filename_prefix: "Scriptoria_Flux", images: ["8", 0] },
      },
    };
  } else if (pipeline === "qwen_edit") {
    recommendedProfile = "IMAGE_GGUF_EDIT";
    const unet = spec.baseModel || "qwen-image-edit-2511-Q4_K_M.gguf";
    const te = spec.textEncoder1 || "qwen_2.5_vl_7b_fp8_scaled.safetensors";
    const vae = spec.vaeModel || "qwen_image_vae.safetensors";
    registerModel("diffusion_models", unet);
    registerModel("text_encoders", te);
    registerModel("vae", vae);
    requiredNodes = ["UnetLoaderGGUF", "CLIPLoader", "VAELoader", "KSampler", "VAEDecode", "SaveImage"];
    graph = {
      "1": { class_type: "UnetLoaderGGUF", inputs: { unet_name: unet } },
      "2": { class_type: "CLIPLoader", inputs: { clip_name: te, type: "qwen_image" } },
      "3": { class_type: "VAELoader", inputs: { vae_name: vae } },
      "4": {
        class_type: "CLIPTextEncode",
        inputs: { text: spec.prompt || "relight scene with warm sunset rim light", clip: ["2", 0] },
      },
      "5": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["2", 0] } },
      "6": {
        class_type: "EmptyLatentImage",
        inputs: { width: spec.width ?? 1024, height: spec.height ?? 1024, batch_size: 1 },
      },
      "7": {
        class_type: "KSampler",
        inputs: {
          seed,
          steps: spec.steps ?? 4,
          cfg: spec.cfg ?? 1.0,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: 1.0,
          model: ["1", 0],
          positive: ["4", 0],
          negative: ["5", 0],
          latent_image: ["6", 0],
        },
      },
      "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
      "9": {
        class_type: "SaveImage",
        inputs: { filename_prefix: "Scriptoria_QwenEdit", images: ["8", 0] },
      },
    };
  } else if (pipeline === "audio_kokoro") {
    modality = "AUDIO";
    recommendedProfile = "AUDIO_LIPSYNC";
    registerModel("kokoro", spec.baseModel || "kokoro-v1.0.onnx");
    requiredNodes = ["KokoroSpeaker", "KokoroGenerator", "SaveAudio"];
    graph = {
      "1": { class_type: "KokoroSpeaker", inputs: { speaker_name: spec.voice || "af_heart" } },
      "2": {
        class_type: "KokoroGenerator",
        inputs: {
          speaker: ["1", 0],
          text: spec.dialogueText || spec.prompt || "Hello, welcome to Scriptoria.",
          speed: spec.speed ?? 1.0,
          lang: "English",
        },
      },
      "3": {
        class_type: "SaveAudio",
        inputs: { audio: ["2", 0], filename_prefix: "Scriptoria_Kokoro" },
      },
    };
  } else if (pipeline === "audio_f5") {
    modality = "AUDIO";
    recommendedProfile = "AUDIO_LIPSYNC";
    registerModel("tts", spec.baseModel || "F5TTS_v1_Base.safetensors");
    requiredNodes = ["F5TTSAudio", "SaveAudio"];
    graph = {
      "1": {
        class_type: "F5TTSAudio",
        inputs: {
          sample_audio: spec.refAudioPath || "",
          sample_text: "",
          speech: spec.dialogueText || spec.prompt || "Narrating the next scene.",
          seed,
          model: "F5TTS_v1_Base",
        },
      },
      "2": { class_type: "SaveAudio", inputs: { audio: ["1", 0], filename_prefix: "Scriptoria_F5" } },
    };
  } else if (pipeline === "audio_mmaudio") {
    modality = "AUDIO";
    recommendedProfile = "AUDIO_LIPSYNC";
    registerModel("mmaudio", spec.baseModel || "mmaudio_small_16k_v2.safetensors");
    requiredNodes = ["MMAudioSampler", "SaveAudio"];
    graph = {
      "1": {
        class_type: "MMAudioSampler",
        inputs: {
          prompt: spec.sfxPrompt || spec.prompt || "footsteps on wet cobblestones, distant thunder",
          duration: spec.durationSec ?? 8,
          seed,
        },
      },
      "2": {
        class_type: "SaveAudio",
        inputs: { audio: ["1", 0], filename_prefix: "Scriptoria_SFX" },
      },
    };
  } else if (pipeline === "audio_stable") {
    modality = "AUDIO";
    recommendedProfile = "AUDIO_LIPSYNC";
    registerModel("checkpoints", spec.baseModel || "stable-audio-open-small.safetensors");
    requiredNodes = ["StableAudioSampler", "SaveAudio"];
    graph = {
      "1": {
        class_type: "StableAudioSampler",
        inputs: {
          prompt: spec.bgmMood || spec.prompt || "ambient atmospheric synth pads, soft piano",
          seconds_total: spec.durationSec ?? 30,
          steps: spec.steps ?? 35,
          seed,
        },
      },
      "2": {
        class_type: "SaveAudio",
        inputs: { audio: ["1", 0], filename_prefix: "Scriptoria_BGM" },
      },
    };
  } else if (pipeline === "video_ltx") {
    modality = "VIDEO";
    recommendedProfile = "VIDEO_MOTION";
    const ckpt = spec.baseModel || "ltx-video-2b-v0.9.5-fp8.safetensors";
    registerModel("checkpoints", ckpt);
    requiredNodes = ["CheckpointLoaderSimple", "CLIPTextEncode", "VHS_VideoCombine"];
    graph = {
      "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
      "2": {
        class_type: "CLIPTextEncode",
        inputs: { text: spec.prompt || "subtle camera push in, hair and cloak blowing in wind", clip: ["1", 1] },
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: spec.negativePrompt || "low quality, jitter, flicker", clip: ["1", 1] },
      },
      "4": {
        class_type: "EmptyLTXVLatentVideo",
        inputs: {
          width: spec.width ?? 768,
          height: spec.height ?? 512,
          length: spec.numFrames ?? 97,
          batch_size: 1,
        },
      },
      "5": {
        class_type: "KSampler",
        inputs: {
          seed,
          steps: spec.steps ?? 20,
          cfg: spec.cfg ?? 3.0,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: 1.0,
          model: ["1", 0],
          positive: ["2", 0],
          negative: ["3", 0],
          latent_image: ["4", 0],
        },
      },
      "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
      "7": {
        class_type: "VHS_VideoCombine",
        inputs: {
          images: ["6", 0],
          frame_rate: 24,
          format: "video/h264-mp4",
          filename_prefix: "Scriptoria_LTX",
          save_output: true,
        },
      },
    };
  } else {
    modality = "VIDEO";
    recommendedProfile = "AUDIO_LIPSYNC";
    registerModel("lipsync", spec.baseModel || "latentsync_unet.pt");
    requiredNodes = ["LatentSyncNode", "VHS_VideoCombine"];
    graph = {
      "1": {
        class_type: "LatentSyncNode",
        inputs: {
          video: spec.videoPath || "",
          audio: spec.refAudioPath || "",
          seed,
        },
      },
      "2": {
        class_type: "VHS_VideoCombine",
        inputs: {
          images: ["1", 0],
          frame_rate: 25,
          format: "video/h264-mp4",
          filename_prefix: "Scriptoria_LipSync",
          save_output: true,
        },
      },
    };
  }

  // Live VM profile & node verification if target VM is supplied
  if (vm) {
    if (vm.workerProfile !== recommendedProfile && vm.workerProfile === "BASE_COMFY" && recommendedProfile !== "BASE_COMFY") {
      warnings.push(
        `Target ${vm.target.toUpperCase()} has profile '${vm.workerProfile}', but this pipeline recommends '${recommendedProfile}'.`
      );
    }
    if (vm.status === "ONLINE" && vm.publicUrl) {
      try {
        const objInfo = await VmGateway.callJson<Record<string, unknown>>(vm, "/object_info", {
          method: "GET",
          targetPort: vm.internalPort,
          timeoutMs: 8000,
        });
        const missing = requiredNodes.filter((n) => !(n in objInfo));
        if (missing.length > 0) {
          warnings.push(
            `Target ${vm.target.toUpperCase()} is missing ComfyUI node(s): ${missing.join(", ")}.`
          );
        }
      } catch {
        // Ignore transient probe check errors during offline compose
      }
    }
  }

  vramEstimate = Number(vramEstimate.toFixed(1));
  const vramStatus: CompiledWorkflowResult["vramStatus"] =
    vramEstimate > 15.4 ? "OVER_T4_LIMIT" : vramEstimate > 13.5 ? "TIGHT" : "SAFE";

  if (vramStatus === "OVER_T4_LIMIT") {
    warnings.push(`Estimated ${vramEstimate} GB VRAM exceeds safe 16 GB Tesla T4 ceiling (~15.4 GB).`);
  }

  return {
    pipeline,
    modality,
    recommendedProfile,
    requiredNodes,
    requiredModels,
    vramEstimateGb: vramEstimate,
    vramStatus,
    t4GuardrailsApplied: guardrails,
    warnings,
    graph,
  };
}
