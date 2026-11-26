import { prisma } from "@/lib/db/prisma";
import type { VmInstance, WorkflowTemplate } from "@prisma/client";
import { ensureUserCatalogSeeded } from "@/lib/catalog/seed-catalog";
import {
  compileResourceAwareWorkflow,
  detectPipelineFromModalityAndModel,
  type RequiredModelRef,
  type WorkflowBuildSpec,
} from "@/lib/workflow/compiler";
import { sanitizeModelCategory } from "@/lib/orchestrator/rclone-client";
import type {
  MediaJobRequestV1,
  MediaModality,
  WorkflowInputFieldV1,
  WorkflowManifestV1,
} from "@/types/media-contract";

export function normalizeInputSchema(
  rawSchema: Record<string, unknown>
): Record<string, WorkflowInputFieldV1> {
  const out: Record<string, WorkflowInputFieldV1> = {};
  for (const [key, val] of Object.entries(rawSchema || {})) {
    if (val && typeof val === "object" && !Array.isArray(val) && "type" in val) {
      const typed = val as Partial<WorkflowInputFieldV1>;
      out[key] = {
        type: typed.type || "string",
        required: typed.required,
        default: typed.default,
        description: typed.description,
      };
      continue;
    }
    if (val === "string" || val === "number" || val === "integer" || val === "boolean") {
      out[key] = {
        type: val,
        required: key === "prompt" || key === "checkpoint",
      };
      continue;
    }
    if (typeof val === "number") {
      out[key] = {
        type: Number.isInteger(val) ? "integer" : "number",
        default: val,
      };
      continue;
    }
    if (typeof val === "boolean") {
      out[key] = { type: "boolean", default: val };
      continue;
    }
    out[key] = { type: "string", default: val ?? undefined };
  }
  return out;
}

const NODE_MODEL_KEY_CATEGORY: Record<string, string> = {
  ckpt_name: "checkpoints",
  unet_name: "diffusion_models",
  vae_name: "vae",
  lora_name: "loras",
  clip_name: "text_encoders",
  clip_name1: "text_encoders",
  clip_name2: "text_encoders",
  clip_name3: "text_encoders",
  clip_name4: "text_encoders",
  control_net_name: "controlnet",
  lllite_name: "controlnet",
  ipadapter_file: "ipadapter",
  adapter_name: "ipadapter",
  model_name: "upscale_models",
  name: "model_patches",
};

export function extractModelRefsFromGraph(graph: Record<string, unknown>): RequiredModelRef[] {
  const seen = new Map<string, RequiredModelRef>();
  for (const node of Object.values(graph || {})) {
    if (!node || typeof node !== "object") continue;
    const n = node as { class_type?: string; inputs?: Record<string, unknown> };
    const cls = String(n.class_type || "");
    const inputs = n.inputs;
    if (!inputs || typeof inputs !== "object") continue;

    for (const [field, rawVal] of Object.entries(inputs)) {
      if (typeof rawVal !== "string") continue;
      const trimmed = rawVal.trim();
      if (!trimmed || trimmed.startsWith("{{")) continue;
      let category = NODE_MODEL_KEY_CATEGORY[field];
      if (!category) continue;
      if (field === "clip_name" && cls.toLowerCase().includes("clipvision")) {
        category = "clip_vision";
      }
      if (field === "model_name" && trimmed.endsWith(".gguf")) {
        category = "unet";
      }
      if (field === "model_name" && cls.toLowerCase().includes("lbm")) {
        category = "lbm";
      }
      if (/\.(safetensors|ckpt|gguf|pt|pth|onnx|bin)$/i.test(trimmed)) {
        const key = `${category}:${trimmed}`;
        if (!seen.has(key)) {
          seen.set(key, { category: sanitizeModelCategory(category), filename: trimmed });
        }
      }
    }
  }
  return Array.from(seen.values());
}

export function extractRequiredNodesFromGraph(graph: Record<string, unknown>): string[] {
  const nodes = new Set<string>();
  for (const node of Object.values(graph || {})) {
    if (!node || typeof node !== "object") continue;
    const cls = (node as { class_type?: unknown }).class_type;
    if (typeof cls === "string" && cls.trim()) {
      nodes.add(cls.trim());
    }
  }
  return Array.from(nodes);
}

export function toWorkflowManifestV1(
  tpl: WorkflowTemplate,
  includeGraph = false
): WorkflowManifestV1 {
  let requiredModels: Array<string | RequiredModelRef> = [];
  let requiredNodes: string[] = [];
  let rawSchema: Record<string, unknown> = {};
  let graph: Record<string, unknown> | undefined;

  try {
    const parsed = JSON.parse(tpl.requiredModelsJson);
    if (Array.isArray(parsed)) requiredModels = parsed;
  } catch {}
  try {
    const parsed = JSON.parse(tpl.requiredNodesJson);
    if (Array.isArray(parsed)) requiredNodes = parsed.map(String);
  } catch {}
  try {
    const parsed = JSON.parse(tpl.inputSchemaJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      rawSchema = parsed as Record<string, unknown>;
    }
  } catch {}
  if (includeGraph) {
    try {
      const parsed = JSON.parse(tpl.apiGraphTemplateJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        graph = parsed as Record<string, unknown>;
      }
    } catch {}
  }

  const modality = (tpl.modality?.toUpperCase() || "IMAGE") as MediaModality;
  return {
    version: "1.0",
    slug: tpl.slug,
    name: tpl.name,
    modality,
    categoryTag: tpl.categoryTag,
    targetProfile: tpl.targetProfile,
    description: tpl.description,
    vramRequiredGb: tpl.vramRequiredGb,
    requiredModels,
    requiredNodes,
    inputSchema: normalizeInputSchema(rawSchema),
    outputSpec: {
      modality,
      expectedFormat:
        modality === "AUDIO"
          ? "audio/flac"
          : modality === "VIDEO"
          ? "video/mp4"
          : "image/png",
    },
    isSeeded: tpl.isSeeded,
    ...(includeGraph && graph ? { apiGraphTemplate: graph } : {}),
  };
}

export async function listUserWorkflowManifests(
  userId: string,
  filters?: { modality?: string; profile?: string; includeGraphs?: boolean }
): Promise<WorkflowManifestV1[]> {
  await ensureUserCatalogSeeded(userId);
  const where: Record<string, unknown> = { userId };
  if (filters?.modality) where.modality = filters.modality.toUpperCase();
  if (filters?.profile) where.targetProfile = filters.profile;

  const rows = await prisma.workflowTemplate.findMany({
    where,
    orderBy: [{ isSeeded: "desc" }, { name: "asc" }],
  });

  return rows.map((r) => toWorkflowManifestV1(r, Boolean(filters?.includeGraphs)));
}

export function substituteGraphPlaceholders(
  nodeOrValue: unknown,
  vars: Record<string, unknown>
): unknown {
  if (typeof nodeOrValue === "string") {
    const exactMatch = nodeOrValue.match(/^\{\{([a-zA-Z0-9_]+)\}\}$/);
    if (exactMatch) {
      const v = vars[exactMatch[1]];
      if (v !== undefined) return v;
      return nodeOrValue;
    }
    return nodeOrValue.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (full, key) => {
      const v = vars[key];
      return v !== undefined && v !== null ? String(v) : full;
    });
  }
  if (Array.isArray(nodeOrValue)) {
    return nodeOrValue.map((item) => substituteGraphPlaceholders(item, vars));
  }
  if (nodeOrValue && typeof nodeOrValue === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(nodeOrValue)) {
      out[k] = substituteGraphPlaceholders(v, vars);
    }
    return out;
  }
  return nodeOrValue;
}

export interface CompiledStandaloneRequest {
  workflowSlug: string;
  modality: "IMAGE" | "AUDIO" | "VIDEO" | "MULTIMODAL";
  targetProfile: string;
  requiredModels: RequiredModelRef[];
  requiredNodes: string[];
  warnings: string[];
  graph: Record<string, unknown>;
  resolvedInputs: Record<string, unknown>;
  baseCheckpoint: string;
  promptSummary: string;
}

async function resolveModelRefsFromStrings(
  userId: string,
  rawRefs: Array<string | RequiredModelRef>,
  extractedFromGraph: RequiredModelRef[]
): Promise<RequiredModelRef[]> {
  const byFilename = new Map<string, RequiredModelRef>();
  for (const m of extractedFromGraph) {
    byFilename.set(m.filename, m);
  }

  const slugOrNames = rawRefs
    .map((r) => (typeof r === "string" ? r : r.slug || r.filename))
    .filter(Boolean);

  if (slugOrNames.length > 0) {
    const assets = await prisma.modelAsset.findMany({
      where: {
        userId,
        OR: [{ slug: { in: slugOrNames } }, { filename: { in: slugOrNames } }],
      },
      select: { slug: true, category: true, filename: true },
    });
    for (const a of assets) {
      byFilename.set(a.filename, {
        category: sanitizeModelCategory(a.category),
        filename: a.filename,
        slug: a.slug,
      });
    }
  }

  for (const r of rawRefs) {
    if (typeof r !== "string" && r.filename && !byFilename.has(r.filename)) {
      byFilename.set(r.filename, {
        category: sanitizeModelCategory(r.category || "checkpoints"),
        filename: r.filename,
        slug: r.slug,
      });
    }
  }

  return Array.from(byFilename.values());
}

export async function compileStandaloneMediaRequest(
  userId: string,
  req: MediaJobRequestV1
): Promise<CompiledStandaloneRequest> {
  const inputs = { ...(req.inputs || {}) };
  const seed =
    typeof req.seed === "number"
      ? req.seed
      : typeof inputs.seed === "number"
      ? inputs.seed
      : Math.floor(Math.random() * 2_000_000_000);
  inputs.seed = seed;

  if (req.workflowSlug) {
    await ensureUserCatalogSeeded(userId);
    const tpl = await prisma.workflowTemplate.findFirst({
      where: { userId, slug: req.workflowSlug },
    });
    if (!tpl) {
      throw new Error(`Workflow manifest '${req.workflowSlug}' not found.`);
    }

    const manifest = toWorkflowManifestV1(tpl, true);
    const mergedVars: Record<string, unknown> = {
      width: 1024,
      height: 1024,
      steps: 24,
      cfg: 6.0,
      batchSize: 1,
      samplerName: "euler_ancestral",
      scheduler: "normal",
      negativePrompt: "",
    };

    for (const [k, field] of Object.entries(manifest.inputSchema)) {
      if (field.default !== undefined) mergedVars[k] = field.default;
    }
    Object.assign(mergedVars, inputs);

    // Resolve {{checkpoint}} default automatically from requiredModels if caller omitted it
    const templateModels: Array<string | RequiredModelRef> = manifest.requiredModels;
    const extractedPre = extractModelRefsFromGraph(manifest.apiGraphTemplate || {});
    const resolvedModels = await resolveModelRefsFromStrings(userId, templateModels, extractedPre);

    if (!mergedVars.checkpoint) {
      const ckptCandidate = resolvedModels.find(
        (m) => m.category === "checkpoints" || m.category === "diffusion_models" || m.category === "unet"
      );
      if (ckptCandidate) mergedVars.checkpoint = ckptCandidate.filename;
    }

    const missingRequired = Object.entries(manifest.inputSchema)
      .filter(([key, spec]) => spec.required && (mergedVars[key] === undefined || mergedVars[key] === ""))
      .map(([key]) => key);
    if (missingRequired.length > 0) {
      throw new Error(`Missing required workflow inputs: ${missingRequired.join(", ")}`);
    }

    const compiledGraph = substituteGraphPlaceholders(
      manifest.apiGraphTemplate || {},
      mergedVars
    ) as Record<string, unknown>;

    const finalModels = await resolveModelRefsFromStrings(
      userId,
      templateModels,
      extractModelRefsFromGraph(compiledGraph)
    );

    return {
      workflowSlug: tpl.slug,
      modality: manifest.modality,
      targetProfile: manifest.targetProfile,
      requiredModels: finalModels,
      requiredNodes: manifest.requiredNodes,
      warnings: [],
      graph: compiledGraph,
      resolvedInputs: mergedVars,
      baseCheckpoint: String(mergedVars.checkpoint || finalModels[0]?.filename || tpl.slug),
      promptSummary: String(mergedVars.prompt || mergedVars.dialogueText || `[Workflow] ${tpl.name}`),
    };
  }

  // Fallback / Direct declarative WorkflowBuildSpec path
  const pipeline =
    req.pipeline ||
    req.spec?.pipeline ||
    detectPipelineFromModalityAndModel(
      typeof inputs.modality === "string" ? inputs.modality : undefined,
      typeof inputs.checkpoint === "string" ? inputs.checkpoint : req.spec?.baseModel
    );

  const buildSpec: WorkflowBuildSpec = {
    ...(req.spec || {}),
    pipeline,
    prompt: typeof inputs.prompt === "string" ? inputs.prompt : req.spec?.prompt,
    negativePrompt:
      typeof inputs.negativePrompt === "string" ? inputs.negativePrompt : req.spec?.negativePrompt,
    baseModel:
      typeof inputs.checkpoint === "string"
        ? inputs.checkpoint
        : typeof inputs.baseModel === "string"
        ? inputs.baseModel
        : req.spec?.baseModel,
    width: typeof inputs.width === "number" ? inputs.width : req.spec?.width,
    height: typeof inputs.height === "number" ? inputs.height : req.spec?.height,
    steps: typeof inputs.steps === "number" ? inputs.steps : req.spec?.steps,
    cfg: typeof inputs.cfg === "number" ? inputs.cfg : req.spec?.cfg,
    samplerName:
      typeof inputs.samplerName === "string" ? inputs.samplerName : req.spec?.samplerName,
    scheduler: typeof inputs.scheduler === "string" ? inputs.scheduler : req.spec?.scheduler,
    batchSize: typeof inputs.batchSize === "number" ? inputs.batchSize : req.spec?.batchSize,
    seed,
    stylePreset: typeof inputs.stylePreset === "string" ? (inputs.stylePreset as WorkflowBuildSpec["stylePreset"]) : req.spec?.stylePreset,
    dualGpuSplit: typeof inputs.dualGpuSplit === "boolean" ? inputs.dualGpuSplit : req.spec?.dualGpuSplit,
    enableFaceDetailer: typeof inputs.enableFaceDetailer === "boolean" ? inputs.enableFaceDetailer : req.spec?.enableFaceDetailer,
    upscalerModel: typeof inputs.upscalerModel === "string" ? inputs.upscalerModel : req.spec?.upscalerModel,
    dialogueText:
      typeof inputs.dialogueText === "string" ? inputs.dialogueText : req.spec?.dialogueText,
    voice: typeof inputs.voice === "string" ? inputs.voice : req.spec?.voice,
    speed: typeof inputs.speed === "number" ? inputs.speed : req.spec?.speed,
    sfxPrompt: typeof inputs.sfxPrompt === "string" ? inputs.sfxPrompt : req.spec?.sfxPrompt,
    bgmMood: typeof inputs.bgmMood === "string" ? inputs.bgmMood : req.spec?.bgmMood,
    durationSec: typeof inputs.durationSec === "number" ? inputs.durationSec : req.spec?.durationSec,
    refImagePath:
      typeof inputs.refImagePath === "string"
        ? inputs.refImagePath
        : typeof inputs.imageUrl === "string"
        ? inputs.imageUrl
        : req.spec?.refImagePath,
    refAudioPath:
      typeof inputs.refAudioPath === "string" ? inputs.refAudioPath : req.spec?.refAudioPath,
    videoPath: typeof inputs.videoPath === "string" ? inputs.videoPath : req.spec?.videoPath,
  };

  const compiled = await compileResourceAwareWorkflow(userId, buildSpec, req.target);
  return {
    workflowSlug: `pipeline:${compiled.pipeline}`,
    modality: compiled.modality,
    targetProfile: compiled.recommendedProfile,
    requiredModels: compiled.requiredModels,
    requiredNodes: compiled.requiredNodes,
    warnings: compiled.warnings,
    graph: compiled.graph,
    resolvedInputs: inputs,
    baseCheckpoint: compiled.requiredModels[0]?.filename || compiled.pipeline,
    promptSummary: buildSpec.prompt || buildSpec.dialogueText || `[Pipeline] ${compiled.pipeline}`,
  };
}

export async function pickBestOnlineVmForProfile(
  userId: string,
  targetProfile: string,
  explicitTarget?: string
): Promise<VmInstance> {
  if (explicitTarget && explicitTarget !== "auto") {
    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId, target: explicitTarget } },
    });
    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      throw new Error(`Target GPU '${explicitTarget}' is not ONLINE.`);
    }
    return vm;
  }

  const onlineVms = await prisma.vmInstance.findMany({
    where: { userId, status: "ONLINE", publicUrl: { not: "" } },
  });

  const comfyVms = onlineVms.filter(
    (v) => !v.workerProfile.startsWith("LLM_") && !v.target.startsWith("tpu")
  );
  if (comfyVms.length === 0) {
    throw new Error("No ONLINE ComfyUI GPU workers available. Boot a VM in VM Cluster first.");
  }

  comfyVms.sort((a, b) => {
    const aExact = a.workerProfile === targetProfile ? 1 : 0;
    const bExact = b.workerProfile === targetProfile ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return (a.vramUsedGb ?? 99) - (b.vramUsedGb ?? 99);
  });

  return comfyVms[0];
}

export async function saveCompiledWorkflowTemplate(params: {
  userId: string;
  name: string;
  slug?: string;
  description?: string;
  compiled: {
    pipeline: string;
    modality: string;
    recommendedProfile: string;
    vramEstimateGb: number;
    requiredModels: RequiredModelRef[];
    requiredNodes: string[];
    graph: Record<string, unknown>;
  };
  inputDefaults?: Record<string, unknown>;
}): Promise<{ id: string; slug: string; name: string }> {
  const cleanName = String(params.name || `Custom · ${params.compiled.pipeline}`).trim();
  const rawSlug = params.slug || `custom-${cleanName}`;
  const slug = rawSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `custom-${Date.now()}`;

  const desc =
    params.description?.trim() ||
    `Custom modular ${params.compiled.pipeline} template (${params.compiled.vramEstimateGb} GB T4)`;

  const requiredModelsJson = JSON.stringify(
    params.compiled.requiredModels.map((m) => m.slug || m.filename)
  );
  const requiredNodesJson = JSON.stringify(params.compiled.requiredNodes);
  const apiGraphTemplateJson = JSON.stringify(params.compiled.graph);
  const inputSchemaJson = JSON.stringify({
    prompt: "string",
    width: 1024,
    height: 1024,
    ...(params.inputDefaults || {}),
  });

  const saved = await prisma.workflowTemplate.upsert({
    where: { userId_slug: { userId: params.userId, slug } },
    update: {
      name: cleanName,
      modality: params.compiled.modality,
      categoryTag: params.compiled.pipeline,
      targetProfile: params.compiled.recommendedProfile,
      description: desc,
      vramRequiredGb: params.compiled.vramEstimateGb,
      requiredModelsJson,
      requiredNodesJson,
      apiGraphTemplateJson,
      inputSchemaJson,
    },
    create: {
      userId: params.userId,
      slug,
      name: cleanName,
      modality: params.compiled.modality,
      categoryTag: params.compiled.pipeline,
      targetProfile: params.compiled.recommendedProfile,
      description: desc,
      vramRequiredGb: params.compiled.vramEstimateGb,
      requiredModelsJson,
      requiredNodesJson,
      apiGraphTemplateJson,
      inputSchemaJson,
      isSeeded: false,
    },
    select: { id: true, slug: true, name: true },
  });

  return saved;
}
