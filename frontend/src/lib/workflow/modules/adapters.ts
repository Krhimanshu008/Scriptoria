import type {
  ArchitectureFamily,
  ControlNetMode,
  ControlNetModuleInput,
  GraphBuilderContext,
  IpConnectorModuleInput,
  LoadedBaseRefs,
  MultiCharRegionInput,
  NodeRef,
} from "./types";

function resolveControlNetModel(
  arch: ArchitectureFamily,
  mode: ControlNetMode,
  explicitModel?: string
): { category: string; filename: string; isAnimaLLLite?: boolean; isQwenUnion?: boolean; isMossLora?: boolean } {
  if (explicitModel) {
    if (explicitModel.toLowerCase().includes("xinsir") && (arch === "sdxl_illustrious" || arch === "noobai_vpred")) {
      return {
        category: "controlnet",
        filename: mode === "depth" ? "noob_sdxl_controlnet_depth_fp16.safetensors" : "noob_sdxl_controlnet_canny.fp16.safetensors",
      };
    }
    return { category: "controlnet", filename: explicitModel };
  }

  if (arch === "anima_v1") {
    const map: Partial<Record<ControlNetMode, string>> = {
      lineart_anime: "anima-lllite-lineart-1.safetensors",
      depth: "anima-lllite-depth-1.safetensors",
      openpose: "anima-lllite-pose-1.safetensors",
      canny: "anima-lllite-lineart-1.safetensors",
    };
    return {
      category: "controlnet",
      filename: map[mode] || "anima-lllite-lineart-1.safetensors",
      isAnimaLLLite: true,
    };
  }

  if (arch === "qwen21") {
    return {
      category: "model_patches",
      filename: "qwen_image_2.1_fun_controlnet_union_int8_convrot.safetensors",
      isQwenUnion: true,
    };
  }

  if (arch === "moss_image") {
    return {
      category: "loras",
      filename: "moss_image_color_depth_control.safetensors",
      isMossLora: true,
    };
  }

  if (arch === "noobai_vpred" || arch === "sdxl_illustrious" || arch === "animagine") {
    const animeMap: Partial<Record<ControlNetMode, string>> = {
      canny: "noob_sdxl_controlnet_canny.fp16.safetensors",
      depth: "noob_sdxl_controlnet_depth_fp16.safetensors",
      lineart_anime: "noob_sdxl_controlnet_lineart_anime_fp16.safetensors",
      tile: "noob_sdxl_controlnet_tile_fp16.safetensors",
      openpose: "openpose_pre.safetensors",
    };
    return {
      category: "controlnet",
      filename: animeMap[mode] || "noob_sdxl_controlnet_canny.fp16.safetensors",
    };
  }

  return { category: "controlnet", filename: "xinsir-controlnet-union-sdxl-1.0-promax.safetensors" };
}

/**
 * Injects IP-Connectors for character & style consistency across SDXL/NoobAI,
 * Anima v1.0, FLUX 3 Klein, and Qwen-Image 2.1 while blocking FaceID on 2D anime.
 */
export function applyIpConnectors(
  ctx: GraphBuilderContext,
  base: LoadedBaseRefs,
  positive: NodeRef,
  negative: NodeRef,
  connectors?: IpConnectorModuleInput[]
): { model: NodeRef; positive: NodeRef; negative: NodeRef; refLatentAttached: boolean } {
  let model = base.model;
  let pos = positive;
  const neg = negative;
  let refLatentAttached = false;

  for (const conn of connectors || []) {
    if (!conn || conn.mode === "none") continue;
    let mode = conn.mode;

    if (mode === "sdxl_ipa_photoreal" && base.isAnime2D) {
      ctx.addGuardrail(
        "Blocked photoreal FaceID/ViT-H IP-Adapter on 2D Anime architecture; swapped to NoobAI IP-Adapter Mark 1 (CLIP-ViT-bigG)."
      );
      mode = "noob_ipa_mk1";
    }

    const refImage = conn.refImagePath || "character_ref.png";
    const weight = conn.weight ?? 0.72;

    if (mode === "noob_ipa_mk1" || mode === "sdxl_ipa_photoreal") {
      if (base.isDiT && base.architecture !== "neta_lumina") {
        ctx.addWarning(`IP-Adapter ${mode} requires SDXL/Illustrious/NoobAI UNet; skipped on ${base.architecture}.`);
        continue;
      }
      ctx.recommendedProfile = "IMAGE_CORE";
      const isNoob = mode === "noob_ipa_mk1";
      const ipaFile =
        conn.ipAdapterModel ||
        (isNoob ? "ip_adapter_Noobtest_800000.bin" : "ip-adapter-plus_sdxl_vit-h.safetensors");
      const clipVisFile =
        conn.clipVisionModel ||
        (isNoob ? "clip_vision_g.safetensors" : "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors");

      ctx.registerModel("ipadapter", ipaFile);
      ctx.registerModel("clip_vision", clipVisFile);

      const ipaNode = ctx.addNode("IPAdapterModelLoader", { ipadapter_file: ipaFile });
      const visNode = ctx.addNode("CLIPVisionLoader", { clip_name: clipVisFile });
      const imgNode = ctx.addNode("LoadImage", { image: refImage });
      const applyNode = ctx.addNode("IPAdapterAdvanced", {
        model,
        ipadapter: ctx.ref(ipaNode, 0),
        image: ctx.ref(imgNode, 0),
        weight,
        weight_type: isNoob ? "style and composition" : "linear",
        combine_embeds: "concat",
        start_at: conn.startAt ?? 0.0,
        end_at: conn.endAt ?? 0.9,
        embeds_scaling: "V only",
        clip_vision: ctx.ref(visNode, 0),
      });
      model = ctx.ref(applyNode, 0);
      ctx.addVram(2.4);
      continue;
    }

    if (mode === "style_aligned") {
      ctx.recommendedProfile = "IMAGE_CORE";
      const saNode = ctx.addNode("StyleAlignedSampleReferenceLatents", {
        model,
        share_norm: conn.styleAlignedShareNorm || "all",
        scale: weight,
        batch_size: 2,
      });
      model = ctx.ref(saNode, 0);
      ctx.addGuardrail("Enabled StyleAligned attention-sharing across batch frames for palette & line consistency.");
      continue;
    }

    if (mode === "anima_ref_v2") {
      ctx.registerModel("ipadapter", "anima_ref_adapter_v2_r64.safetensors");
      const imgNode = ctx.addNode("LoadImage", { image: refImage });
      const refNode = ctx.addNode("AnimaRefAdapterApply", {
        model,
        ref_image: ctx.ref(imgNode, 0),
        adapter_name: conn.ipAdapterModel || "anima_ref_adapter_v2_r64.safetensors",
        strength: weight,
        start_at: conn.startAt ?? 0.0,
        end_at: conn.endAt ?? 1.0,
      });
      model = ctx.ref(refNode, 0);
      ctx.addVram(0.6);
      continue;
    }

    if (mode === "flux3_ref_latent" || mode === "qwen21_ref_strength") {
      const imgNode = ctx.addNode("LoadImage", { image: refImage });
      const encNode = ctx.addNode("VAEEncode", { pixels: ctx.ref(imgNode, 0), vae: base.vae });
      const refLatNode = ctx.addNode("ReferenceLatent", {
        conditioning: pos,
        latent: ctx.ref(encNode, 0),
      });
      pos = ctx.ref(refLatNode, 0);
      refLatentAttached = true;
      ctx.addVram(0.8);
      ctx.addGuardrail(`Injected zero-trainer ${mode} reference latent conditioning.`);
    }
  }

  return { model, positive: pos, negative: neg, refLatentAttached };
}

/**
 * Attaches architecture-compatible ControlNets (Laxhar/Eugeoter Noob, Anima LLLite,
 * Qwen 2.1 Union INT8, MOSS Color+Depth) and blocks Xinsir Union on Illustrious/NoobAI.
 */
export function applyControlNets(
  ctx: GraphBuilderContext,
  base: LoadedBaseRefs,
  positive: NodeRef,
  negative: NodeRef,
  controlNets?: ControlNetModuleInput[]
): { model: NodeRef; positive: NodeRef; negative: NodeRef } {
  let model = base.model;
  let pos = positive;
  let neg = negative;

  for (const cn of controlNets || []) {
    if (!cn || cn.mode === "none") continue;
    const explicitXinsir = Boolean(cn.modelFilename && cn.modelFilename.toLowerCase().includes("xinsir"));
    if (explicitXinsir && (base.architecture === "sdxl_illustrious" || base.architecture === "noobai_vpred")) {
      ctx.addGuardrail(
        "Blocked Xinsir ControlNet Union on Illustrious/NoobAI; auto-swapped to Laxhar/Eugeoter Noob ControlNet."
      );
    }

    const resolved = resolveControlNetModel(base.architecture, cn.mode, cn.modelFilename);
    ctx.registerModel(resolved.category, resolved.filename);

    const imgNode = ctx.addNode("LoadImage", { image: cn.controlImagePath || "control_guide.png" });
    let guideImageRef = ctx.ref(imgNode, 0);

    if (cn.preprocessor) {
      if (cn.mode === "canny") {
        const pre = ctx.addNode("Canny", { image: guideImageRef, low_threshold: 0.3, high_threshold: 0.7 });
        guideImageRef = ctx.ref(pre, 0);
      } else if (cn.mode === "depth") {
        const pre = ctx.addNode("DepthAnythingV2Preprocessor", { image: guideImageRef, resolution: 1024 });
        guideImageRef = ctx.ref(pre, 0);
      } else if (cn.mode === "openpose") {
        const pre = ctx.addNode("DWPreprocessor", { image: guideImageRef, detect_hand: "enable", detect_body: "enable", detect_face: "enable", resolution: 1024 });
        guideImageRef = ctx.ref(pre, 0);
      } else if (cn.mode === "lineart_anime") {
        const pre = ctx.addNode("AnimeLineArtPreprocessor", { image: guideImageRef, resolution: 1024 });
        guideImageRef = ctx.ref(pre, 0);
      }
    }

    if (resolved.isMossLora) {
      const ln = ctx.addNode("LoraLoaderModelOnly", {
        model,
        lora_name: resolved.filename,
        strength_model: cn.strength ?? 0.85,
      });
      model = ctx.ref(ln, 0);
      ctx.addVram(0.4);
      continue;
    }

    if (resolved.isAnimaLLLite) {
      const lllNode = ctx.addNode("AnimaLLLiteApply", {
        model,
        positive: pos,
        negative: neg,
        lllite_name: resolved.filename,
        image: guideImageRef,
        strength: cn.strength ?? 0.8,
        start_percent: cn.startPercent ?? 0.0,
        end_percent: cn.endPercent ?? 0.85,
      });
      model = ctx.ref(lllNode, 0);
      pos = ctx.ref(lllNode, 1);
      neg = ctx.ref(lllNode, 2);
      ctx.addVram(0.5);
      continue;
    }

    if (resolved.isQwenUnion) {
      const mpNode = ctx.addNode("ModelPatchLoader", { name: resolved.filename });
      const applyNode = ctx.addNode("QwenImageDiffsynthControlnet", {
        model,
        model_patch: ctx.ref(mpNode, 0),
        vae: base.vae,
        image: guideImageRef,
        strength: cn.strength ?? 0.75,
      });
      model = ctx.ref(applyNode, 0);
      ctx.addVram(2.4);
      continue;
    }

    const cnLoader = ctx.addNode("ControlNetLoader", { control_net_name: resolved.filename });
    const applyCn = ctx.addNode("ControlNetApplyAdvanced", {
      positive: pos,
      negative: neg,
      control_net: ctx.ref(cnLoader, 0),
      image: guideImageRef,
      vae: base.vae,
      strength: cn.strength ?? 0.8,
      start_percent: cn.startPercent ?? 0.0,
      end_percent: cn.endPercent ?? 0.85,
    });
    pos = ctx.ref(applyCn, 0);
    neg = ctx.ref(applyCn, 1);
    ctx.addVram(1.6);
  }

  return { model, positive: pos, negative: neg };
}

/**
 * Applies multi-character spatial isolation:
 * - SDXL/NoobAI/Illustrious -> ComfyCoupleMask attention decoupling
 * - DiT (FLUX 3 / MOSS / Anima / Qwen 2.1) -> ConditioningSetArea spatial boxes (no UNet ComfyCouple!)
 */
export function applyMultiCharacterIsolation(
  ctx: GraphBuilderContext,
  base: LoadedBaseRefs,
  globalPositive: NodeRef,
  characters?: MultiCharRegionInput[],
  canvasWidth = 1024,
  canvasHeight = 1024
): { model: NodeRef; positive: NodeRef } {
  if (!characters || characters.length < 2 || !base.clip) {
    return { model: base.model, positive: globalPositive };
  }

  if (!base.isDiT) {
    ctx.recommendedProfile = "IMAGE_CORE";
    let model: NodeRef = base.model;
    let coupled: NodeRef = globalPositive;
    const regionConds: Array<{ cond: NodeRef; mask: NodeRef }> = [];

    for (const ch of characters.slice(0, 4)) {
      const enc = ctx.addNode("CLIPTextEncode", { text: ch.prompt, clip: base.clip });
      const mask = ctx.addNode("SolidMask", {
        value: 1.0,
        width: Math.max(64, Math.round(ch.w * canvasWidth)),
        height: Math.max(64, Math.round(ch.h * canvasHeight)),
      });
      const feather = ctx.addNode("FeatherMask", {
        mask: ctx.ref(mask, 0),
        left: 16,
        top: 16,
        right: 16,
        bottom: 16,
      });
      regionConds.push({ cond: ctx.ref(enc, 0), mask: ctx.ref(feather, 0) });
    }

    if (regionConds.length >= 2) {
      const coupleNode = ctx.addNode("ComfyCoupleMask", {
        model,
        positive_1: regionConds[0].cond,
        mask_1: regionConds[0].mask,
        positive_2: regionConds[1].cond,
        mask_2: regionConds[1].mask,
        global_positive: coupled,
      });
      model = ctx.ref(coupleNode, 0);
      coupled = ctx.ref(coupleNode, 1);
      ctx.addGuardrail("Enabled ComfyCoupleMask multi-character attention isolation on SDXL/NoobAI.");
    }
    return { model, positive: coupled };
  }

  // For DiT (MOSS / FLUX 3 / Anima / Qwen 2.1), never run UNet-only ComfyCouple; use ConditioningSetArea
  let combined: NodeRef = globalPositive;
  for (const ch of characters.slice(0, 4)) {
    const enc = ctx.addNode("CLIPTextEncode", { text: ch.prompt, clip: base.clip });
    const area = ctx.addNode("ConditioningSetArea", {
      conditioning: ctx.ref(enc, 0),
      width: Math.max(64, Math.round((ch.w * canvasWidth) / 8) * 8),
      height: Math.max(64, Math.round((ch.h * canvasHeight) / 8) * 8),
      x: Math.max(0, Math.round((ch.x * canvasWidth) / 8) * 8),
      y: Math.max(0, Math.round((ch.y * canvasHeight) / 8) * 8),
      strength: 1.0,
    });
    const comb = ctx.addNode("ConditioningCombine", {
      conditioning_1: combined,
      conditioning_2: ctx.ref(area, 0),
    });
    combined = ctx.ref(comb, 0);
  }
  ctx.addGuardrail("Used DiT-safe ConditioningSetArea spatial boxes (blocked UNet-only ComfyCouple on DiT).");
  return { model: base.model, positive: combined };
}
