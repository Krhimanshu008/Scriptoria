import type { WorkerProfileId } from "@/lib/catalog/worker-profiles";

export type NodeRef = [string, number];

export type ArchitectureFamily =
  | "sdxl_illustrious"
  | "noobai_vpred"
  | "animagine"
  | "neta_lumina"
  | "anima_v1"
  | "flux1_gguf"
  | "flux3_klein"
  | "moss_image"
  | "qwen21"
  | "qwen_edit"
  | "qwen_360";

export type IpConnectorMode =
  | "none"
  | "noob_ipa_mk1"
  | "style_aligned"
  | "anima_ref_v2"
  | "flux3_ref_latent"
  | "qwen21_ref_strength"
  | "sdxl_ipa_photoreal";

export type ControlNetMode =
  | "none"
  | "canny"
  | "depth"
  | "lineart_anime"
  | "openpose"
  | "tile"
  | "qwen_fun_union"
  | "moss_color_depth";

export type RelightMode = "none" | "qwen_light_migration" | "lbm_relight";

export type StylePresetId =
  | "anime_vibrant"
  | "anime_dramatic_vpred"
  | "anime_clean_cel"
  | "manhwa_webtoon"
  | "painterly_fantasy"
  | "lineart_sketch"
  | "gothic_dark"
  | "photoreal_cinematic"
  | "panorama_360";

export interface LoraModuleInput {
  filename: string;
  strength?: number;
  strengthClip?: number;
}

export interface IpConnectorModuleInput {
  mode: IpConnectorMode;
  refImagePath?: string;
  weight?: number;
  startAt?: number;
  endAt?: number;
  clipVisionModel?: string;
  ipAdapterModel?: string;
  styleAlignedShareNorm?: "all" | "q_and_k" | "k_only";
}

export interface ControlNetModuleInput {
  mode: ControlNetMode;
  controlImagePath?: string;
  strength?: number;
  startPercent?: number;
  endPercent?: number;
  modelFilename?: string;
  preprocessor?: boolean;
}

export interface MultiCharRegionInput {
  name?: string;
  prompt: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ModularWorkflowInput {
  architecture: ArchitectureFamily;
  stylePreset?: StylePresetId;
  baseModel?: string;
  vaeModel?: string;
  textEncoder1?: string;
  textEncoder2?: string;
  loras?: LoraModuleInput[];
  ipConnectors?: IpConnectorModuleInput[];
  controlNets?: ControlNetModuleInput[];
  characters?: MultiCharRegionInput[];
  relight?: RelightMode;
  relightRefImagePath?: string;
  inpaintMaskImagePath?: string;
  enableFaceDetailer?: boolean;
  enableHandDetailer?: boolean;
  upscalerModel?: string;
  enable360Preview?: boolean;
  dualGpuSplit?: boolean;
  autoVaeFixSdxl?: boolean;
  prompt?: string;
  negativePrompt?: string;
  refImagePath?: string;
  useEmptyLatent?: boolean;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  batchSize?: number;
  seed?: number;
}

export interface GraphRequiredModel {
  category: string;
  filename: string;
  slug?: string;
}

export interface LoadedBaseRefs {
  architecture: ArchitectureFamily;
  model: NodeRef;
  clip?: NodeRef;
  vae: NodeRef;
  dualT4Split: boolean;
  defaultSteps: number;
  defaultCfg: number;
  defaultSampler: string;
  defaultScheduler: string;
  filenamePrefix: string;
  isAnime2D: boolean;
  isDiT: boolean;
}

/**
 * Stateful graph compiler context managing deterministic node IDs,
 * model dependency tracking, VRAM estimation, and T4 guardrails.
 */
export class GraphBuilderContext {
  public readonly nodes: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {};
  public readonly requiredModels: GraphRequiredModel[] = [];
  public readonly requiredNodes = new Set<string>();
  public readonly guardrails: string[] = [];
  public readonly warnings: string[] = [];
  public recommendedProfile: WorkerProfileId = "IMAGE_CORE";
  public vramEstimateGb = 7.4;

  private nextId = 1;
  private readonly assetLookup: Map<string, string>;

  constructor(slugByFilename?: Map<string, string>) {
    this.assetLookup = slugByFilename ?? new Map<string, string>();
  }

  public addNode(classType: string, inputs: Record<string, unknown>): string {
    const id = String(this.nextId++);
    this.nodes[id] = { class_type: classType, inputs };
    this.requiredNodes.add(classType);
    return id;
  }

  public ref(nodeId: string, outputIndex = 0): NodeRef {
    return [nodeId, outputIndex];
  }

  public registerModel(category: string, filename?: string): void {
    if (!filename) return;
    const clean = filename.trim();
    if (!clean) return;
    if (!this.requiredModels.some((m) => m.category === category && m.filename === clean)) {
      this.requiredModels.push({
        category,
        filename: clean,
        slug: this.assetLookup.get(clean.toLowerCase()),
      });
    }
  }

  public addGuardrail(message: string): void {
    if (!this.guardrails.includes(message)) {
      this.guardrails.push(message);
    }
  }

  public addWarning(message: string): void {
    if (!this.warnings.includes(message)) {
      this.warnings.push(message);
    }
  }

  public addVram(deltaGb: number): void {
    this.vramEstimateGb = Number((this.vramEstimateGb + deltaGb).toFixed(2));
  }
}
