import { prisma } from "@/lib/db/prisma";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import { getOrCreateWorkspaceSettings } from "@/lib/settings/workspace-settings";
import type { WorkerProfileId } from "@/lib/catalog/worker-profiles";
import {
  assembleModularWorkflow,
  type ArchitectureFamily,
  type ControlNetModuleInput,
  type IpConnectorModuleInput,
  type MultiCharRegionInput,
  type RelightMode,
  type StylePresetId,
} from "./modules";

export type WorkflowPipelineKind =
  | "sdxl_txt2img"
  | "sdxl_detailer_upscale"
  | "noob_vpred"
  | "animagine_v4"
  | "neta_lumina"
  | "anima_v1"
  | "flux_gguf"
  | "flux3_klein"
  | "moss_image"
  | "qwen_edit"
  | "qwen21_edit"
  | "panorama_360"
  | "modular"
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
  architecture?: ArchitectureFamily;
  stylePreset?: StylePresetId;
  baseModel?: string;
  vaeModel?: string;
  textEncoder1?: string;
  textEncoder2?: string;
  loras?: LoraSlotSpec[];
  ipConnectors?: IpConnectorModuleInput[];
  controlNets?: ControlNetModuleInput[];
  characters?: MultiCharRegionInput[];
  relight?: RelightMode;
  relightRefImagePath?: string;
  inpaintMaskImagePath?: string;
  upscalerModel?: string;
  enableFaceDetailer?: boolean;
  enableHandDetailer?: boolean;
  enable360Preview?: boolean;
  dualGpuSplit?: boolean;
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
  noob_vpred: 7.4,
  animagine_v4: 7.2,
  neta_lumina: 8.5,
  anima_v1: 5.8,
  flux_gguf: 13.8,
  flux3_klein: 18.0,
  moss_image: 17.5,
  qwen_edit: 14.5,
  qwen21_edit: 20.5,
  panorama_360: 18.0,
  modular: 8.5,
  audio_kokoro: 0.6,
  audio_f5: 2.5,
  audio_mmaudio: 3.2,
  audio_stable: 3.8,
  video_ltx: 7.8,
  video_latentsync: 5.2,
};

function resolveModularArchitecture(spec: WorkflowBuildSpec): ArchitectureFamily | null {
  const p = spec.pipeline;
  const b = (spec.baseModel || "").toLowerCase();
  if (spec.architecture) return spec.architecture;
  if (p === "noob_vpred" || b.includes("vpred")) return "noobai_vpred";
  if (p === "animagine_v4" || b.includes("animagine")) return "animagine";
  if (p === "neta_lumina" || b.includes("lumina") || b.includes("netayume")) return "neta_lumina";
  if (p === "anima_v1" || (b.includes("anima") && !b.includes("animagine"))) return "anima_v1";
  if (p === "flux3_klein" || b.includes("flux3") || b.includes("klein")) return "flux3_klein";
  if (p === "moss_image" || b.includes("moss")) return "moss_image";
  if (p === "qwen21_edit" || b.includes("2.1") || b.includes("2_1")) return "qwen21";
  if (p === "panorama_360" || b.includes("2512") || b.includes("360")) return "qwen_360";
  if (p === "qwen_edit") return "qwen_edit";
  if (p === "flux_gguf") return "flux1_gguf";
  if (p === "sdxl_txt2img" || p === "sdxl_detailer_upscale" || p === "modular") {
    return "sdxl_illustrious";
  }
  return null;
}

export function detectPipelineFromModalityAndModel(
  modality?: string,
  baseModelFilename?: string
): WorkflowPipelineKind {
  const m = (modality || "").toUpperCase();
  const f = (baseModelFilename || "").toLowerCase();
  if (f.includes("vpred") || f.includes("noobai-xl-vpred")) return "noob_vpred";
  if (f.includes("animagine")) return "animagine_v4";
  if (f.includes("netayume") || f.includes("lumina")) return "neta_lumina";
  if (f.includes("anima") && !f.includes("animagine")) return "anima_v1";
  if (f.includes("flux3") || f.includes("klein")) return "flux3_klein";
  if (f.includes("moss")) return "moss_image";
  if (f.includes("360") || f.includes("2512")) return "panorama_360";
  if (f.includes("2.1") || f.includes("2_1")) return "qwen21_edit";
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

  const modularArch = resolveModularArchitecture(spec);
  if (modularArch) {
    modality = "IMAGE";
    const slugMap = new Map(userAssets.map((a) => [a.filename.toLowerCase(), a.slug]));
    const assembled = assembleModularWorkflow(
      {
        architecture: modularArch,
        stylePreset: spec.stylePreset,
        baseModel: spec.baseModel,
        vaeModel: spec.vaeModel,
        textEncoder1: spec.textEncoder1,
        textEncoder2: spec.textEncoder2,
        loras: spec.loras,
        ipConnectors: spec.ipConnectors,
        controlNets: spec.controlNets,
        characters: spec.characters,
        relight: spec.relight,
        relightRefImagePath: spec.relightRefImagePath,
        inpaintMaskImagePath: spec.inpaintMaskImagePath,
        enableFaceDetailer:
          spec.enableFaceDetailer ?? pipeline === "sdxl_detailer_upscale",
        enableHandDetailer: spec.enableHandDetailer,
        upscalerModel: spec.upscalerModel,
        enable360Preview: spec.enable360Preview,
        dualGpuSplit: spec.dualGpuSplit,
        autoVaeFixSdxl: settings.autoVaeFixSdxl,
        prompt: spec.prompt,
        negativePrompt: spec.negativePrompt,
        refImagePath: spec.refImagePath,
        width: spec.width,
        height: spec.height,
        steps: spec.steps,
        cfg: spec.cfg,
        samplerName: spec.samplerName,
        scheduler: spec.scheduler,
        batchSize: spec.batchSize,
        seed,
      },
      slugMap
    );
    recommendedProfile = assembled.recommendedProfile;
    vramEstimate = assembled.vramEstimateGb;
    requiredNodes = assembled.requiredNodes;
    assembled.requiredModels.forEach((m) => registerModel(m.category, m.filename));
    assembled.t4GuardrailsApplied.forEach((g) => guardrails.push(g));
    assembled.warnings.forEach((w) => warnings.push(w));
    graph = assembled.graph;
  } else if (pipeline === "audio_kokoro") {
    modality = "AUDIO";
    recommendedProfile = "AUDIO_LIPSYNC";
    registerModel("tts", spec.baseModel || "kokoro-v1.0.onnx");
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
    registerModel("audio_sfx", spec.baseModel || "mmaudio_small_16k_v2.safetensors");
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
    if (recommendedProfile === "IMAGE_DIT_DUAL_T4" && vm.workerProfile !== "IMAGE_DIT_DUAL_T4") {
      warnings.push(
        `Target ${vm.target.toUpperCase()} has profile '${vm.workerProfile}', but Dual-T4 DiT split requires 'IMAGE_DIT_DUAL_T4' (CUDA_VISIBLE_DEVICES=0,1).`
      );
    } else if (vm.workerProfile !== recommendedProfile && vm.workerProfile === "BASE_COMFY" && recommendedProfile !== "BASE_COMFY") {
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
  const vramLimitGb = recommendedProfile === "IMAGE_DIT_DUAL_T4" ? 30.8 : 15.4;
  const vramTightGb = recommendedProfile === "IMAGE_DIT_DUAL_T4" ? 27.0 : 13.5;
  const vramStatus: CompiledWorkflowResult["vramStatus"] =
    vramEstimate > vramLimitGb ? "OVER_T4_LIMIT" : vramEstimate > vramTightGb ? "TIGHT" : "SAFE";

  if (vramStatus === "OVER_T4_LIMIT") {
    warnings.push(
      `Estimated ${vramEstimate} GB VRAM exceeds safe ${
        recommendedProfile === "IMAGE_DIT_DUAL_T4" ? "32 GB Dual-T4" : "16 GB Single-T4"
      } ceiling (~${vramLimitGb} GB).`
    );
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
