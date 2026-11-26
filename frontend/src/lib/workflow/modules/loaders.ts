import type { GraphBuilderContext, LoadedBaseRefs, ModularWorkflowInput, NodeRef } from "./types";

function isSdxlFamily(arch: ModularWorkflowInput["architecture"]): boolean {
  return arch === "sdxl_illustrious" || arch === "noobai_vpred" || arch === "animagine";
}

function attachSdxlVaeAndLoras(
  ctx: GraphBuilderContext,
  arch: "sdxl_illustrious" | "noobai_vpred" | "animagine",
  input: ModularWorkflowInput,
  ckptDefault: string
): { model: NodeRef; clip: NodeRef; vae: NodeRef } {
  const ckpt = input.baseModel || ckptDefault;
  ctx.registerModel("checkpoints", ckpt);
  const ckptNode = ctx.addNode("CheckpointLoaderSimple", { ckpt_name: ckpt });

  let model = ctx.ref(ckptNode, 0);
  let clip = ctx.ref(ckptNode, 1);
  let vae = ctx.ref(ckptNode, 2);

  const autoVae = input.autoVaeFixSdxl !== false;
  let candidateVae = input.vaeModel;
  if (candidateVae && /flux|qwen|ae\.safetensors/i.test(candidateVae)) {
    ctx.addGuardrail(
      `Replaced incompatible DiT VAE '${candidateVae}' with T4-safe 'sdxl_vae_fp16_fix.safetensors'.`
    );
    candidateVae = "sdxl_vae_fp16_fix.safetensors";
  }
  const vaeName = candidateVae || (autoVae ? "sdxl_vae_fp16_fix.safetensors" : undefined);
  if (vaeName) {
    ctx.registerModel("vae", vaeName);
    const vaeNode = ctx.addNode("VAELoader", { vae_name: vaeName });
    vae = ctx.ref(vaeNode, 0);
    if (!candidateVae && autoVae) {
      ctx.addGuardrail("Auto-injected sdxl_vae_fp16_fix.safetensors (Tesla T4 NaN black-image prevention).");
    }
  }

  for (const l of (input.loras || []).filter((x) => Boolean(x.filename)).slice(0, 4)) {
    ctx.registerModel("loras", l.filename);
    const strength = l.strength ?? 0.85;
    const strengthClip = l.strengthClip ?? strength;
    const loraNode = ctx.addNode("LoraLoader", {
      model,
      clip,
      lora_name: l.filename,
      strength_model: strength,
      strength_clip: strengthClip,
    });
    model = ctx.ref(loraNode, 0);
    clip = ctx.ref(loraNode, 1);
    ctx.addVram(0.35);
  }

  if (arch === "noobai_vpred") {
    const msNode = ctx.addNode("ModelSamplingDiscrete", {
      model,
      sampling: "v_prediction",
      zsnr: true,
    });
    const rescaleNode = ctx.addNode("RescaleCFG", {
      model: ctx.ref(msNode, 0),
      multiplier: 0.7,
    });
    model = ctx.ref(rescaleNode, 0);
    ctx.addGuardrail("Enforced NoobAI V-Pred ModelSamplingDiscrete(zsnr=True) + RescaleCFG(0.7).");
  }

  return { model, clip, vae };
}

function attachDualT4DeviceSplit(
  ctx: GraphBuilderContext,
  model: NodeRef,
  clip: NodeRef | undefined,
  vae: NodeRef,
  enableSplit: boolean
): { model: NodeRef; clip: NodeRef | undefined; vae: NodeRef } {
  if (!enableSplit) {
    return { model, clip, vae };
  }
  const mDev = ctx.addNode("SelectModelDevice", { model, device: "cuda:0" });
  const vDev = ctx.addNode("SelectVAEDevice", { vae, device: "cuda:0" });
  const cDev = clip ? ctx.addNode("SelectCLIPDevice", { clip, device: "cuda:1" }) : undefined;
  ctx.recommendedProfile = "IMAGE_DIT_DUAL_T4";
  ctx.addGuardrail("Applied Dual-T4 Split: DiT+VAE pinned to cuda:0, 9B Text Encoder pinned to cuda:1.");
  return {
    model: ctx.ref(mDev, 0),
    clip: cDev ? ctx.ref(cDev, 0) : clip,
    vae: ctx.ref(vDev, 0),
  };
}

function attachModelOnlyLoras(
  ctx: GraphBuilderContext,
  model: NodeRef,
  loras?: ModularWorkflowInput["loras"]
): NodeRef {
  let out = model;
  for (const l of (loras || []).filter((x) => Boolean(x.filename)).slice(0, 4)) {
    ctx.registerModel("loras", l.filename);
    const ln = ctx.addNode("LoraLoaderModelOnly", {
      model: out,
      lora_name: l.filename,
      strength_model: l.strength ?? 1.0,
    });
    out = ctx.ref(ln, 0);
    ctx.addVram(0.35);
  }
  return out;
}

function pickCompatibleDiTVae(
  ctx: GraphBuilderContext,
  inputVae: string | undefined,
  defaultDiTVae: string
): string {
  if (!inputVae) return defaultDiTVae;
  const lower = inputVae.toLowerCase();
  if (lower.includes("sdxl") || lower.includes("ft-mse") || lower.includes("ft_mse")) {
    ctx.addGuardrail(
      `Replaced incompatible SDXL VAE '${inputVae}' with native DiT VAE '${defaultDiTVae}'.`
    );
    return defaultDiTVae;
  }
  return inputVae;
}

/**
 * Builds the architecture-specific model, text encoder, VAE, LoRA, and
 * Dual-T4 device-split backbone nodes.
 */
export function buildBaseModelLoader(
  ctx: GraphBuilderContext,
  input: ModularWorkflowInput
): LoadedBaseRefs {
  const arch = input.architecture;

  if (arch === "noobai_vpred") {
    ctx.recommendedProfile = "IMAGE_CORE";
    ctx.vramEstimateGb = 7.4;
    const refs = attachSdxlVaeAndLoras(ctx, arch, input, "NoobAI-XL-Vpred-v1.0.safetensors");
    return {
      architecture: arch,
      ...refs,
      dualT4Split: false,
      defaultSteps: 28,
      defaultCfg: 5.0,
      defaultSampler: "euler",
      defaultScheduler: "normal",
      filenamePrefix: "Scriptoria_NoobVPred",
      isAnime2D: true,
      isDiT: false,
    };
  }

  if (arch === "animagine") {
    ctx.recommendedProfile = "IMAGE_CORE";
    ctx.vramEstimateGb = 7.2;
    const refs = attachSdxlVaeAndLoras(ctx, arch, input, "animagine-xl-4.0-opt.safetensors");
    return {
      architecture: arch,
      ...refs,
      dualT4Split: false,
      defaultSteps: 26,
      defaultCfg: 5.0,
      defaultSampler: "euler_ancestral",
      defaultScheduler: "normal",
      filenamePrefix: "Scriptoria_Animagine4",
      isAnime2D: true,
      isDiT: false,
    };
  }

  if (isSdxlFamily(arch)) {
    ctx.recommendedProfile = "IMAGE_CORE";
    ctx.vramEstimateGb = 7.4;
    const baseName = input.baseModel || "Illustrious-XL-v2.0.safetensors";
    const isPhotoreal =
      input.stylePreset === "photoreal_cinematic" ||
      /juggernaut|realvis|dreamshaper/i.test(baseName);
    const refs = attachSdxlVaeAndLoras(ctx, "sdxl_illustrious", input, baseName);
    return {
      architecture: arch,
      ...refs,
      dualT4Split: false,
      defaultSteps: isPhotoreal && /lightning|turbo/i.test(baseName) ? 7 : 26,
      defaultCfg: isPhotoreal && /lightning|turbo/i.test(baseName) ? 2.0 : 5.5,
      defaultSampler: isPhotoreal ? "dpmpp_2m_sde" : "euler_ancestral",
      defaultScheduler: isPhotoreal ? "karras" : "normal",
      filenamePrefix: "Scriptoria_SDXL",
      isAnime2D: !isPhotoreal,
      isDiT: false,
    };
  }

  if (arch === "neta_lumina") {
    ctx.recommendedProfile = "IMAGE_CORE";
    ctx.vramEstimateGb = 8.5;
    const ckpt = input.baseModel || "NetaYume_v4_all_in_one.safetensors";
    ctx.registerModel("checkpoints", ckpt);
    const ckptNode = ctx.addNode("CheckpointLoaderSimple", { ckpt_name: ckpt });
    let model = ctx.ref(ckptNode, 0);
    let clip = ctx.ref(ckptNode, 1);
    const vae = ctx.ref(ckptNode, 2);
    for (const l of (input.loras || []).filter((x) => Boolean(x.filename)).slice(0, 3)) {
      ctx.registerModel("loras", l.filename);
      const ln = ctx.addNode("LoraLoader", {
        model,
        clip,
        lora_name: l.filename,
        strength_model: l.strength ?? 0.85,
        strength_clip: l.strengthClip ?? 0.85,
      });
      model = ctx.ref(ln, 0);
      clip = ctx.ref(ln, 1);
      ctx.addVram(0.35);
    }
    return {
      architecture: arch,
      model,
      clip,
      vae,
      dualT4Split: false,
      defaultSteps: 24,
      defaultCfg: 4.5,
      defaultSampler: "euler",
      defaultScheduler: "linear_quadratic",
      filenamePrefix: "Scriptoria_NetaLumina",
      isAnime2D: true,
      isDiT: true,
    };
  }

  if (arch === "anima_v1") {
    const base = input.baseModel || "anima-turbo-v1.0-Q5_K_M.gguf";
    const isGguf = base.toLowerCase().endsWith(".gguf");
    const te = input.textEncoder1 || "qwen_3_06b_base.safetensors";
    const vaeName = pickCompatibleDiTVae(ctx, input.vaeModel, "qwen_image_vae.safetensors");
    ctx.recommendedProfile = input.dualGpuSplit ? "IMAGE_DIT_DUAL_T4" : "IMAGE_GGUF_EDIT";
    ctx.vramEstimateGb = isGguf ? 5.8 : 7.8;

    ctx.registerModel(isGguf ? "unet" : "diffusion_models", base);
    ctx.registerModel("text_encoders", te);
    ctx.registerModel("vae", vaeName);

    const unetNode = isGguf
      ? ctx.addNode("UnetLoaderGGUF", { unet_name: base })
      : ctx.addNode("UNETLoader", { unet_name: base, weight_dtype: "default" });
    const clipNode = ctx.addNode("CLIPLoader", { clip_name: te, type: "anima" });
    const vaeNode = ctx.addNode("VAELoader", { vae_name: vaeName });

    const modelWithLoras = attachModelOnlyLoras(ctx, ctx.ref(unetNode, 0), input.loras);
    const split = attachDualT4DeviceSplit(
      ctx,
      modelWithLoras,
      ctx.ref(clipNode, 0),
      ctx.ref(vaeNode, 0),
      Boolean(input.dualGpuSplit)
    );
    const isTurbo = base.toLowerCase().includes("turbo");
    return {
      architecture: arch,
      ...split,
      dualT4Split: Boolean(input.dualGpuSplit),
      defaultSteps: isTurbo ? 8 : 24,
      defaultCfg: isTurbo ? 2.0 : 4.0,
      defaultSampler: "er_sde",
      defaultScheduler: "simple",
      filenamePrefix: "Scriptoria_Anima",
      isAnime2D: true,
      isDiT: true,
    };
  }

  if (arch === "flux1_gguf") {
    ctx.recommendedProfile = "IMAGE_GGUF_EDIT";
    ctx.vramEstimateGb = 13.8;
    const unet = input.baseModel || "flux1-dev-Q4_K_S.gguf";
    const t5 = input.textEncoder1 || "t5-v1_1-xxl-encoder-Q4_K_M.gguf";
    const clipL = input.textEncoder2 || "clip_l.safetensors";
    const vaeName = pickCompatibleDiTVae(ctx, input.vaeModel, "ae.safetensors");

    ctx.registerModel("unet", unet);
    ctx.registerModel("text_encoders", t5);
    ctx.registerModel("text_encoders", clipL);
    ctx.registerModel("vae", vaeName);
    ctx.addGuardrail("Selected Flux.1 Q4_K_S GGUF + T5-XXL Q4_K_M to fit 16 GB Tesla T4.");

    const unetNode = ctx.addNode("UnetLoaderGGUF", { unet_name: unet });
    const clipNode = ctx.addNode("DualCLIPLoaderGGUF", { clip_name1: t5, clip_name2: clipL, type: "flux" });
    const vaeNode = ctx.addNode("VAELoader", { vae_name: vaeName });

    const model = attachModelOnlyLoras(ctx, ctx.ref(unetNode, 0), input.loras);
    return {
      architecture: arch,
      model,
      clip: ctx.ref(clipNode, 0),
      vae: ctx.ref(vaeNode, 0),
      dualT4Split: false,
      defaultSteps: unet.toLowerCase().includes("schnell") ? 4 : 20,
      defaultCfg: 1.0,
      defaultSampler: "euler",
      defaultScheduler: "simple",
      filenamePrefix: "Scriptoria_Flux1",
      isAnime2D: false,
      isDiT: true,
    };
  }

  if (arch === "flux3_klein") {
    let base = input.baseModel || "flux3-image-klein-int8-convrot.safetensors";
    if (/nvfp4|fp8/i.test(base)) {
      ctx.addGuardrail("Swapped FP8/NVFP4 FLUX 3 weight to Turing-safe INT8 ConvRot for Tesla T4.");
      base = "flux3-image-klein-int8-convrot.safetensors";
    }
    const te = input.textEncoder1 || "qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors";
    const vaeName = pickCompatibleDiTVae(ctx, input.vaeModel, "flux2-vae.safetensors");
    const useSplit = input.dualGpuSplit !== false;
    ctx.recommendedProfile = useSplit ? "IMAGE_DIT_DUAL_T4" : "IMAGE_GGUF_EDIT";
    ctx.vramEstimateGb = useSplit ? 18.0 : 14.5;

    ctx.registerModel("diffusion_models", base);
    ctx.registerModel("text_encoders", te);
    ctx.registerModel("vae", vaeName);

    const unetNode = ctx.addNode("UNETLoader", { unet_name: base, weight_dtype: "default" });
    const clipNode = ctx.addNode("CLIPLoader", { clip_name: te, type: "flux3" });
    const vaeNode = ctx.addNode("VAELoader", { vae_name: vaeName });
    const model = attachModelOnlyLoras(ctx, ctx.ref(unetNode, 0), input.loras);

    const split = attachDualT4DeviceSplit(
      ctx,
      model,
      ctx.ref(clipNode, 0),
      ctx.ref(vaeNode, 0),
      useSplit
    );
    const isBaseVariant = base.toLowerCase().includes("base");
    return {
      architecture: arch,
      ...split,
      dualT4Split: useSplit,
      defaultSteps: isBaseVariant ? 24 : 12,
      defaultCfg: isBaseVariant ? 3.5 : 1.0,
      defaultSampler: "euler",
      defaultScheduler: "simple",
      filenamePrefix: "Scriptoria_Flux3Klein",
      isAnime2D: input.stylePreset !== "photoreal_cinematic",
      isDiT: true,
    };
  }

  if (arch === "moss_image") {
    const base = input.baseModel || "moss_image_sft_int8_convrot.safetensors";
    const isGguf = base.toLowerCase().endsWith(".gguf");
    const te = input.textEncoder1 || "qwen3.5_9b_int8_convrot.safetensors";
    const vaeName = pickCompatibleDiTVae(ctx, input.vaeModel, "flux2-vae.safetensors");
    const useSplit = input.dualGpuSplit !== false;
    ctx.recommendedProfile = useSplit ? "IMAGE_DIT_DUAL_T4" : "IMAGE_GGUF_EDIT";
    ctx.vramEstimateGb = useSplit ? 17.5 : 14.0;

    ctx.registerModel(isGguf ? "unet" : "diffusion_models", base);
    ctx.registerModel("text_encoders", te);
    ctx.registerModel("vae", vaeName);

    const unetNode = isGguf
      ? ctx.addNode("UnetLoaderGGUF", { unet_name: base })
      : ctx.addNode("UNETLoader", { unet_name: base, weight_dtype: "default" });
    const clipNode = ctx.addNode("CLIPLoader", { clip_name: te, type: "moss" });
    const vaeNode = ctx.addNode("VAELoader", { vae_name: vaeName });

    const effectiveLoras = input.loras ? [...input.loras] : [];
    const hasDmd2 = effectiveLoras.some((l) => l.filename.toLowerCase().includes("dmd2"));
    const wantsFast = !input.steps || input.steps <= 10;
    if (wantsFast && !hasDmd2) {
      effectiveLoras.unshift({ filename: "moss_image_base_dmd2_v2_bf16.safetensors", strength: 1.0 });
      ctx.addGuardrail("Injected MOSS-Image 8-step DMD2 LoRA for rapid Dual-T4 generation.");
    }
    const model = attachModelOnlyLoras(ctx, ctx.ref(unetNode, 0), effectiveLoras);
    const split = attachDualT4DeviceSplit(ctx, model, ctx.ref(clipNode, 0), ctx.ref(vaeNode, 0), useSplit);
    const useDmd2Settings = wantsFast || hasDmd2;
    return {
      architecture: arch,
      ...split,
      dualT4Split: useSplit,
      defaultSteps: useDmd2Settings ? 8 : 24,
      defaultCfg: useDmd2Settings ? 1.0 : 3.5,
      defaultSampler: "euler",
      defaultScheduler: "simple",
      filenamePrefix: "Scriptoria_MOSS",
      isAnime2D: input.stylePreset !== "photoreal_cinematic",
      isDiT: true,
    };
  }

  if (arch === "qwen21") {
    const base = input.baseModel || "qwen_image_2.1_turbo_int8_convrot.safetensors";
    const isI2I = Boolean(input.refImagePath);
    const te =
      input.textEncoder1 ||
      (isI2I
        ? "qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors"
        : "qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors");
    const vaeName = pickCompatibleDiTVae(ctx, input.vaeModel, "qwen_image_2.1_vae_bf16.safetensors");
    const useSplit = input.dualGpuSplit !== false;
    ctx.recommendedProfile = useSplit ? "IMAGE_DIT_DUAL_T4" : "IMAGE_GGUF_EDIT";
    ctx.vramEstimateGb = useSplit ? 20.5 : 15.2;

    ctx.registerModel("diffusion_models", base);
    ctx.registerModel("text_encoders", te);
    ctx.registerModel("vae", vaeName);

    const unetNode = ctx.addNode("UNETLoader", { unet_name: base, weight_dtype: "default" });
    const clipNode = ctx.addNode("CLIPLoader", { clip_name: te, type: "qwen_image" });
    const vaeNode = ctx.addNode("VAELoader", { vae_name: vaeName });
    const model = attachModelOnlyLoras(ctx, ctx.ref(unetNode, 0), input.loras);
    const split = attachDualT4DeviceSplit(ctx, model, ctx.ref(clipNode, 0), ctx.ref(vaeNode, 0), useSplit);
    const isTurbo = base.toLowerCase().includes("turbo");

    return {
      architecture: arch,
      ...split,
      dualT4Split: useSplit,
      defaultSteps: isTurbo ? 8 : 24,
      defaultCfg: isTurbo ? 1.0 : 3.5,
      defaultSampler: "euler",
      defaultScheduler: "simple",
      filenamePrefix: "Scriptoria_Qwen21",
      isAnime2D: input.stylePreset !== "photoreal_cinematic",
      isDiT: true,
    };
  }

  if (arch === "qwen_360") {
    const base = input.baseModel || "qwen-image-2512-Q4_K_M.gguf";
    const te = input.textEncoder1 || "qwen_2.5_vl_7b_fp8_scaled.safetensors";
    const vaeName = pickCompatibleDiTVae(ctx, input.vaeModel, "qwen_image_vae.safetensors");
    const useSplit = input.dualGpuSplit !== false;
    ctx.recommendedProfile = "IMAGE_DIT_DUAL_T4";
    ctx.vramEstimateGb = useSplit ? 18.0 : 14.5;

    ctx.registerModel("unet", base);
    ctx.registerModel("text_encoders", te);
    ctx.registerModel("vae", vaeName);

    const loras = [...(input.loras || [])];
    if (!loras.some((l) => l.filename.includes("360"))) {
      loras.unshift({ filename: "qwen-360-diffusion-2512-int8-bf16-v2.safetensors", strength: 1.0 });
    }

    const unetNode = ctx.addNode("UnetLoaderGGUF", { unet_name: base });
    const clipNode = ctx.addNode("CLIPLoader", { clip_name: te, type: "qwen_image" });
    const vaeNode = ctx.addNode("VAELoader", { vae_name: vaeName });
    const model = attachModelOnlyLoras(ctx, ctx.ref(unetNode, 0), loras);
    const split = attachDualT4DeviceSplit(ctx, model, ctx.ref(clipNode, 0), ctx.ref(vaeNode, 0), useSplit);

    return {
      architecture: arch,
      ...split,
      dualT4Split: useSplit,
      defaultSteps: 20,
      defaultCfg: 3.5,
      defaultSampler: "euler",
      defaultScheduler: "simple",
      filenamePrefix: "Scriptoria_360Pano",
      isAnime2D: false,
      isDiT: true,
    };
  }

  // qwen_edit (default fallback for Qwen-Image-Edit 2511)
  ctx.recommendedProfile = "IMAGE_GGUF_EDIT";
  ctx.vramEstimateGb = 14.5;
  const unet = input.baseModel || "qwen-image-edit-2511-Q4_K_M.gguf";
  const te = input.textEncoder1 || "qwen_2.5_vl_7b_fp8_scaled.safetensors";
  const vaeName = pickCompatibleDiTVae(ctx, input.vaeModel, "qwen_image_vae.safetensors");
  const editLoras = input.loras?.length
    ? input.loras
    : [{ filename: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", strength: 1.0 }];

  ctx.registerModel("unet", unet);
  ctx.registerModel("text_encoders", te);
  ctx.registerModel("vae", vaeName);

  const unetNode = ctx.addNode("UnetLoaderGGUF", { unet_name: unet });
  const clipNode = ctx.addNode("CLIPLoader", { clip_name: te, type: "qwen_image" });
  const vaeNode = ctx.addNode("VAELoader", { vae_name: vaeName });

  let model = attachModelOnlyLoras(ctx, ctx.ref(unetNode, 0), editLoras);
  const auraNode = ctx.addNode("ModelSamplingAuraFlow", { model, shift: 3.0 });
  const cfgNormNode = ctx.addNode("CFGNorm", { model: ctx.ref(auraNode, 0), strength: 1.0 });
  model = ctx.ref(cfgNormNode, 0);

  return {
    architecture: "qwen_edit",
    model,
    clip: ctx.ref(clipNode, 0),
    vae: ctx.ref(vaeNode, 0),
    dualT4Split: false,
    defaultSteps: 4,
    defaultCfg: 1.0,
    defaultSampler: "euler",
    defaultScheduler: "simple",
    filenamePrefix: "Scriptoria_QwenEdit",
    isAnime2D: false,
    isDiT: true,
  };
}
