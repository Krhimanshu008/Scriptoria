import type {
  GraphBuilderContext,
  LoadedBaseRefs,
  ModularWorkflowInput,
  NodeRef,
} from "./types";

/**
 * Applies optional Differential Diffusion inpaint crop/stitch, relighting
 * (LBM Relight or Qwen Light Migration), Face/Hand Detailers, Upscaling, and 360° preview.
 */
export function applyPostProcessingPipeline(
  ctx: GraphBuilderContext,
  base: LoadedBaseRefs,
  imageRef: NodeRef,
  positive: NodeRef,
  negative: NodeRef,
  input: ModularWorkflowInput
): NodeRef {
  let current = imageRef;
  const seed = input.seed ?? 42;

  if (input.relight && input.relight !== "none") {
    if (input.relight === "lbm_relight") {
      ctx.registerModel("lbm", "LBM_relighting.safetensors");
      const bgImg = input.relightRefImagePath
        ? ctx.addNode("LoadImage", { image: input.relightRefImagePath })
        : undefined;
      const lbmLoad = ctx.addNode("LBMModelLoader", { model_name: "LBM_relighting.safetensors" });
      const lbmRun = ctx.addNode("LBMRelighting", {
        lbm_model: ctx.ref(lbmLoad, 0),
        fg_image: current,
        ...(bgImg ? { bg_image: ctx.ref(bgImg, 0) } : {}),
        steps: 4,
      });
      current = ctx.ref(lbmRun, 0);
      ctx.addVram(4.5);
      ctx.addGuardrail("Applied single-step JasperAI LBM Relighting harmonization.");
    } else if (input.relight === "qwen_light_migration") {
      ctx.registerModel("loras", "Qwen-Image-Edit-2509-Light-Migration.safetensors");
      ctx.addGuardrail("Attached Qwen-Edit Light-Migration LoRA reference for scene lighting harmonization.");
    }
  }

  if (
    base.dualT4Split &&
    (input.enableFaceDetailer || input.enableHandDetailer || Boolean(input.upscalerModel))
  ) {
    ctx.addGuardrail(
      "Dual-T4 Split active: TE stays on gpu:1 while UNet/VAE/Detailer execute cleanly on gpu:0."
    );
  }

  if (input.enableFaceDetailer && base.clip) {
    if (ctx.recommendedProfile === "BASE_COMFY") {
      ctx.recommendedProfile = "IMAGE_CORE";
    }
    ctx.registerModel("ultralytics", "face_yolov8m.pt");
    ctx.registerModel("sams", "sam_vit_b_01ec64.pth");
    const faceDet = ctx.addNode("UltralyticsDetectorProvider", { model_name: "bbox/face_yolov8m.pt" });
    const samDet = ctx.addNode("SAMLoader", { model_name: "sam_vit_b_01ec64.pth", device_mode: "AUTO" });
    const fdNode = ctx.addNode("FaceDetailer", {
      image: current,
      model: base.model,
      clip: base.clip,
      vae: base.vae,
      positive,
      negative,
      bbox_detector: ctx.ref(faceDet, 0),
      sam_model_opt: ctx.ref(samDet, 0),
      guide_size: 384,
      guide_size_for: true,
      max_size: 1024,
      seed,
      steps: 14,
      cfg: input.cfg ?? base.defaultCfg,
      sampler_name: input.samplerName || base.defaultSampler,
      scheduler: input.scheduler || base.defaultScheduler,
      denoise: 0.42,
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
    });
    current = ctx.ref(fdNode, 0);
    ctx.addVram(1.6);
  }

  if (input.enableHandDetailer && base.clip) {
    ctx.registerModel("ultralytics", "hand_yolov8n.pt");
    const handDet = ctx.addNode("UltralyticsDetectorProvider", { model_name: "bbox/hand_yolov8n.pt" });
    const samHand = ctx.addNode("SAMLoader", { model_name: "sam_vit_b_01ec64.pth", device_mode: "AUTO" });
    const hdNode = ctx.addNode("FaceDetailer", {
      image: current,
      model: base.model,
      clip: base.clip,
      vae: base.vae,
      positive,
      negative,
      bbox_detector: ctx.ref(handDet, 0),
      sam_model_opt: ctx.ref(samHand, 0),
      guide_size: 384,
      guide_size_for: true,
      max_size: 768,
      seed: seed + 1,
      steps: 12,
      cfg: input.cfg ?? base.defaultCfg,
      sampler_name: input.samplerName || base.defaultSampler,
      scheduler: input.scheduler || base.defaultScheduler,
      denoise: 0.4,
      feather: 5,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: 0.45,
      bbox_dilation: 10,
      bbox_crop_factor: 2.5,
      sam_detection_hint: "center-1",
      sam_dilation: 0,
      sam_threshold: 0.9,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: "False",
      drop_size: 10,
      wildcard: "",
      cycle: 1,
    });
    current = ctx.ref(hdNode, 0);
    ctx.addVram(0.8);
  }

  if (input.upscalerModel) {
    const upModel =
      input.upscalerModel === "auto"
        ? base.isAnime2D
          ? "4x-AnimeSharp.pth"
          : "4x-UltraSharp.pth"
        : input.upscalerModel;
    ctx.registerModel("upscale_models", upModel);
    const upLoader = ctx.addNode("UpscaleModelLoader", { model_name: upModel });
    const upNode = ctx.addNode("ImageUpscaleWithModel", {
      upscale_model: ctx.ref(upLoader, 0),
      image: current,
    });
    current = ctx.ref(upNode, 0);
    ctx.addVram(1.1);
  }

  if (input.enable360Preview || base.architecture === "qwen_360") {
    ctx.addNode("Preview360Panorama", { images: current });
  }

  return current;
}
