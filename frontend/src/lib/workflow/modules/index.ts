import { buildBaseModelLoader } from "./loaders";
import { applyControlNets, applyIpConnectors, applyMultiCharacterIsolation } from "./adapters";
import { applyPostProcessingPipeline } from "./postprocess";
import { GraphBuilderContext, type ModularWorkflowInput, type NodeRef, type StylePresetId } from "./types";

export * from "./types";

export interface StylePromptTuneResult {
  positive: string;
  negative: string;
  notes: string[];
}

/**
 * Tunes user prompts cleanly for the target model architecture without breaking
 * native tag vs natural-language expectations.
 */
export function tunePromptForArchitecture(
  rawPrompt: string,
  rawNegative: string,
  architecture: ModularWorkflowInput["architecture"],
  stylePreset?: StylePresetId
): StylePromptTuneResult {
  let positive = (rawPrompt || "masterpiece, dramatic anime story scene").trim();
  const negative = (rawNegative || "").trim();
  const notes: string[] = [];

  if (architecture === "noobai_vpred") {
    // Trap #3: NoobAI V-Pred breaks or flattens contrast with "simple background" / "white background"
    if (/\b(simple background|white background|grey background|transparent background)\b/i.test(positive)) {
      positive = positive.replace(/\b(simple background|white background|grey background|transparent background)\b,?/gi, "").trim();
      positive = `${positive}, volumetric lighting, detailed textured environment`.replace(/^,\s*/, "");
      notes.push("Stripped V-Pred luminance-collapse trigger ('simple background') and anchored lighting depth.");
    }
    if (!/\b(masterpiece|best quality)\b/i.test(positive)) {
      positive = `masterpiece, best quality, ${positive}`;
    }
    return {
      positive,
      negative:
        negative || "worst quality, low quality, blurry, watermark, bad anatomy, extra digits",
      notes,
    };
  }

  if (architecture === "animagine") {
    if (!/\b(newest|year 2024|year 2025)\b/i.test(positive)) {
      positive = `masterpiece, high score, great score, newest, ${positive}`;
      notes.push("Prepended Animagine 4.0 quality/year tags.");
    }
    return {
      positive,
      negative: negative || "lowres, bad anatomy, bad hands, text, error, worst quality, low quality",
      notes,
    };
  }

  if (architecture === "sdxl_illustrious" || architecture === "neta_lumina") {
    if (!/\b(masterpiece|best quality)\b/i.test(positive) && stylePreset !== "photoreal_cinematic") {
      positive = `masterpiece, best quality, ${positive}`;
    }
    return {
      positive,
      negative: negative || "lowres, bad quality, blurry, deformed, watermark, signature",
      notes,
    };
  }

  if (architecture === "qwen_360" && !/equirectangular|360/i.test(positive)) {
    positive = `equirectangular 360 degree seamless spherical panorama, ${positive}`;
    notes.push("Injected equirectangular 360 spherical anchor.");
  }

  // DiT families (FLUX 3 Klein, MOSS-Image, Qwen 2.1, Anima) prefer clean descriptive natural language & empty negative for CFG=1.0
  if (stylePreset === "manhwa_webtoon" && !/webtoon|manhwa/i.test(positive)) {
    positive = `modern Korean webtoon manhwa comic illustration style, crisp ink lineart, cel shading, ${positive}`;
    notes.push("Added Manhwa/Webtoon art-direction cues.");
  } else if (stylePreset === "painterly_fantasy" && !/painterly|oil/i.test(positive)) {
    positive = `painterly fantasy concept art, rich brushwork, volumetric atmosphere, ${positive}`;
  } else if (stylePreset === "lineart_sketch" && !/lineart|sketch/i.test(positive)) {
    positive = `monochrome ink lineart illustration, expressive hatching, clean sketch, ${positive}`;
  }

  return {
    positive,
    negative: negative || (architecture === "anima_v1" ? "worst quality, lowres, deformed" : ""),
    notes,
  };
}

export interface AssembledModularWorkflow {
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  requiredModels: Array<{ category: string; filename: string; slug?: string }>;
  requiredNodes: string[];
  recommendedProfile: GraphBuilderContext["recommendedProfile"];
  vramEstimateGb: number;
  t4GuardrailsApplied: string[];
  warnings: string[];
  tunedPrompt: string;
  tunedNegativePrompt: string;
  effectiveSteps: number;
  effectiveCfg: number;
  effectiveSampler: string;
  effectiveScheduler: string;
}

/**
 * Compiles a complete composable ComfyUI graph from Loader + IP-Connectors +
 * ControlNets + Multi-Char Spatial Isolation + Sampler + PostProcess modules.
 */
export function assembleModularWorkflow(
  input: ModularWorkflowInput,
  slugByFilename?: Map<string, string>
): AssembledModularWorkflow {
  const ctx = new GraphBuilderContext(slugByFilename);
  const base = buildBaseModelLoader(ctx, input);

  const seed = input.seed ?? Math.floor(Math.random() * 2_000_000_000);
  const width = input.architecture === "qwen_360" ? input.width ?? 1536 : input.width ?? 1024;
  const height = input.architecture === "qwen_360" ? input.height ?? 768 : input.height ?? 1024;
  const batchSize =
    input.ipConnectors?.some((c) => c.mode === "style_aligned")
      ? Math.max(2, Math.min(4, input.batchSize ?? 2))
      : Math.min(4, Math.max(1, input.batchSize ?? 1));

  const tuned = tunePromptForArchitecture(
    input.prompt || "dynamic story keyframe scene",
    input.negativePrompt || "",
    base.architecture,
    input.stylePreset
  );
  tuned.notes.forEach((n) => ctx.addGuardrail(n));

  let positive: NodeRef;
  let negative: NodeRef;
  let latentImage: NodeRef;
  let currentModel: NodeRef = base.model;

  if (base.architecture === "qwen_edit") {
    const orderedRefs: string[] = [];
    const pushRef = (p?: string) => {
      const s = p?.trim();
      if (s && !orderedRefs.includes(s)) orderedRefs.push(s);
    };
    pushRef(input.refImagePath);
    for (const c of input.ipConnectors || []) {
      if (c && c.mode !== "none") pushRef(c.refImagePath);
    }
    if (orderedRefs.length === 0) {
      orderedRefs.push("character_ref.png");
    }

    const encInputs: Record<string, unknown> = {
      clip: base.clip!,
      vae: base.vae,
      prompt: tuned.positive,
    };
    let firstImgNode = "";
    orderedRefs.slice(0, 3).forEach((refPath, idx) => {
      const ld = ctx.addNode("LoadImage", { image: refPath });
      if (idx === 0) firstImgNode = ld;
      encInputs[`image${idx + 1}`] = ctx.ref(ld, 0);
    });

    const encPlus = ctx.addNode("TextEncodeQwenImageEditPlus", encInputs);
    const negEnc = ctx.addNode("CLIPTextEncode", { text: tuned.negative, clip: base.clip! });
    positive = ctx.ref(encPlus, 0);
    negative = ctx.ref(negEnc, 0);

    if (input.useEmptyLatent) {
      const emptyLat = ctx.addNode("EmptyLatentImage", { width, height, batch_size: batchSize });
      latentImage = ctx.ref(emptyLat, 0);
      ctx.addGuardrail(
        `Qwen-Edit Anchor Mode: EmptyLatentImage ${width}x${height} with ${Math.min(3, orderedRefs.length)} reference slots (image1..image${Math.min(3, orderedRefs.length)}).`
      );
    } else {
      const vaeEnc = ctx.addNode("VAEEncode", { pixels: ctx.ref(firstImgNode, 0), vae: base.vae });
      latentImage = ctx.ref(vaeEnc, 0);
    }
  } else {
    const posEnc = ctx.addNode("CLIPTextEncode", { text: tuned.positive, clip: base.clip! });
    const negEnc = ctx.addNode("CLIPTextEncode", { text: tuned.negative, clip: base.clip! });
    positive = ctx.ref(posEnc, 0);
    negative = ctx.ref(negEnc, 0);

    // Optional differential diffusion inpaint crop if user provides inpaint mask + refImage
    if (input.inpaintMaskImagePath && input.refImagePath) {
      const diffNode = ctx.addNode("DifferentialDiffusion", { model: currentModel });
      currentModel = ctx.ref(diffNode, 0);
      const srcImg = ctx.addNode("LoadImage", { image: input.refImagePath });
      const maskImg = ctx.addNode("LoadImage", { image: input.inpaintMaskImagePath });
      const cropNode = ctx.addNode("InpaintCropImproved", {
        image: ctx.ref(srcImg, 0),
        mask: ctx.ref(maskImg, 0),
        context_expand_pixels: 32,
        context_expand_factor: 1.2,
      });
      const vaeInpaint = ctx.addNode("VAEEncodeForInpaint", {
        pixels: ctx.ref(cropNode, 1),
        vae: base.vae,
        mask: ctx.ref(cropNode, 2),
        grow_mask_by: 8,
      });
      latentImage = ctx.ref(vaeInpaint, 0);
      ctx.addGuardrail("Applied DifferentialDiffusion + InpaintCropImproved masked refinement.");
    } else {
      const emptyLat = ctx.addNode("EmptyLatentImage", { width, height, batch_size: batchSize });
      latentImage = ctx.ref(emptyLat, 0);
    }
  }

  // Apply IP-Connectors first (with anime FaceID guardrail); skip duplicate ReferenceLatent on qwen_edit slots already wired into TextEncodeQwenImageEditPlus
  const effectiveConnectors =
    base.architecture === "qwen_edit"
      ? (input.ipConnectors || []).filter(
          (c) => c.mode !== "qwen21_ref_strength" && c.mode !== "flux3_ref_latent"
        )
      : input.ipConnectors;
  const ipOut = applyIpConnectors(ctx, { ...base, model: currentModel }, positive, negative, effectiveConnectors);
  currentModel = ipOut.model;
  positive = ipOut.positive;
  negative = ipOut.negative;

  // Apply Multi-Char Spatial Isolation on the IP-hooked model, forwarding both coupled MODEL and POSITIVE outputs
  const multiOut = applyMultiCharacterIsolation(
    ctx,
    { ...base, model: currentModel },
    positive,
    input.characters,
    width,
    height
  );
  currentModel = multiOut.model;
  positive = multiOut.positive;

  // Apply ControlNets (with NoobAI/Illustrious Xinsir guardrail)
  const cnOut = applyControlNets(ctx, { ...base, model: currentModel }, positive, negative, input.controlNets);
  currentModel = cnOut.model;
  positive = cnOut.positive;
  negative = cnOut.negative;

  const effectiveSteps = input.steps ?? base.defaultSteps;
  const effectiveCfg = input.cfg ?? base.defaultCfg;
  const effectiveSampler = input.samplerName || base.defaultSampler;
  const effectiveScheduler = input.scheduler || base.defaultScheduler;

  const ksampler = ctx.addNode("KSampler", {
    seed,
    steps: effectiveSteps,
    cfg: effectiveCfg,
    sampler_name: effectiveSampler,
    scheduler: effectiveScheduler,
    denoise: 1.0,
    model: currentModel,
    positive,
    negative,
    latent_image: latentImage,
  });

  const vaeDec = ctx.addNode("VAEDecode", { samples: ctx.ref(ksampler, 0), vae: base.vae });
  const finalImg = applyPostProcessingPipeline(
    ctx,
    { ...base, model: currentModel },
    ctx.ref(vaeDec, 0),
    positive,
    negative,
    input
  );

  ctx.addNode("SaveImage", {
    filename_prefix: base.filenamePrefix,
    images: finalImg,
  });

  if (width * height > 1344 * 1024 && base.architecture !== "qwen_360") {
    ctx.addWarning("Base resolution > 1.3M px on 16 GB T4; prefer 1024x1024 + upscaler for extra safety.");
    ctx.addVram(1.2);
  }

  return {
    graph: ctx.nodes,
    requiredModels: ctx.requiredModels,
    requiredNodes: Array.from(ctx.requiredNodes),
    recommendedProfile: ctx.recommendedProfile,
    vramEstimateGb: ctx.vramEstimateGb,
    t4GuardrailsApplied: ctx.guardrails,
    warnings: ctx.warnings,
    tunedPrompt: tuned.positive,
    tunedNegativePrompt: tuned.negative,
    effectiveSteps,
    effectiveCfg,
    effectiveSampler,
    effectiveScheduler,
  };
}

/**
 * Builds Stage 2 of a Dual-T4 Pipelined execution: takes the Stage 1 generated image via
 * LoadImage placeholder and runs Detailers, Relighting, and/or Upscaling independently on GPU1.
 */
export function assemblePostProcessStage2(
  input: ModularWorkflowInput,
  stage1ImagePlaceholder: string,
  slugByFilename?: Map<string, string>
): AssembledModularWorkflow {
  const ctx = new GraphBuilderContext(slugByFilename);
  const srcImg = ctx.addNode("LoadImage", { image: stage1ImagePlaceholder });
  const needsDiffusionDetailer = Boolean(input.enableFaceDetailer || input.enableHandDetailer);

  const tuned = tunePromptForArchitecture(
    input.prompt || "detailed story portrait",
    input.negativePrompt || "",
    input.architecture,
    input.stylePreset
  );

  let baseRefs: import("./types").LoadedBaseRefs;
  let positive: NodeRef = ctx.ref(srcImg, 0);
  let negative: NodeRef = ctx.ref(srcImg, 0);

  if (needsDiffusionDetailer) {
    baseRefs = buildBaseModelLoader(ctx, { ...input, dualGpuSplit: false });
    const posEnc = ctx.addNode("CLIPTextEncode", { text: tuned.positive, clip: baseRefs.clip! });
    const negEnc = ctx.addNode("CLIPTextEncode", { text: tuned.negative, clip: baseRefs.clip! });
    positive = ctx.ref(posEnc, 0);
    negative = ctx.ref(negEnc, 0);
  } else {
    ctx.recommendedProfile = "IMAGE_CORE";
    ctx.vramEstimateGb = input.relight === "lbm_relight" ? 4.8 : 2.2;
    baseRefs = {
      architecture: input.architecture,
      model: ctx.ref(srcImg, 0),
      vae: ctx.ref(srcImg, 0),
      dualT4Split: false,
      defaultSteps: 14,
      defaultCfg: 6.0,
      defaultSampler: input.samplerName || "euler_ancestral",
      defaultScheduler: input.scheduler || "normal",
      filenamePrefix: `${input.architecture}_Stage2`,
      isAnime2D: true,
      isDiT: false,
    };
  }

  const finalImg = applyPostProcessingPipeline(
    ctx,
    baseRefs,
    ctx.ref(srcImg, 0),
    positive,
    negative,
    { ...input, dualGpuSplit: false }
  );

  ctx.addNode("SaveImage", {
    filename_prefix: `${input.architecture}_Stage2`,
    images: finalImg,
  });
  ctx.addGuardrail("Dual-T4 Pipeline Stage 2: Runs Detailer/Relight/Upscaler independently on GPU1.");

  return {
    graph: ctx.nodes,
    requiredModels: ctx.requiredModels,
    requiredNodes: Array.from(ctx.requiredNodes),
    recommendedProfile: ctx.recommendedProfile,
    vramEstimateGb: ctx.vramEstimateGb,
    t4GuardrailsApplied: ctx.guardrails,
    warnings: ctx.warnings,
    tunedPrompt: tuned.positive,
    tunedNegativePrompt: tuned.negative,
    effectiveSteps: input.steps ?? baseRefs.defaultSteps,
    effectiveCfg: input.cfg ?? baseRefs.defaultCfg,
    effectiveSampler: input.samplerName || baseRefs.defaultSampler,
    effectiveScheduler: input.scheduler || baseRefs.defaultScheduler,
  };
}
