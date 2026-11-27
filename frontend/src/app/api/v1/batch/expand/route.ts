import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { createBatchFromSpec } from "@/lib/batch/scheduler";
import type {
  BatchExecutionMode,
  CanonicalSceneSpec,
  CanonicalVisualTrackSpec,
  ScriptoriaSceneSpecV1,
} from "@/lib/batch/ingestion-spec";

interface ExpandPromptItem {
  title?: string;
  prompt: string;
  negativePrompt?: string;
  baseModel?: string;
  seed?: number;
  refImagePath?: string;
}

interface ExpandMatrixConfig {
  prompts?: string[];
  baseModels?: string[];
  cfgValues?: number[];
  stepsValues?: number[];
  loraVariants?: Array<{ filename: string; strength?: number }>;
  seedCount?: number;
  baseSeed?: number;
}

function cleanStrArr(val: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(val)) return fallback;
  return val.map((v) => String(v || "").trim()).filter(Boolean);
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const mode = String(body.mode || "prompt_list") as
      | "prompt_list"
      | "matrix"
      | "character_ip_set"
      | "folder_i2i";
    const title = String(body.title || `Studio Batch (${mode})`).trim() || "Studio Batch";
    const executionMode = (String(body.executionMode || "dual_parallel").trim() ||
      "dual_parallel") as BatchExecutionMode;
    const dryRun = body.dryRun === true;
    const maxTasks = Math.min(120, Math.max(1, Number(body.maxTasks) || 64));

    const baseSpec = (
      body.baseSpec && typeof body.baseSpec === "object" ? body.baseSpec : {}
    ) as Partial<CanonicalVisualTrackSpec>;

    const baseVisual: CanonicalVisualTrackSpec = {
      prompt: baseSpec.prompt || "masterpiece, dramatic anime story scene",
      negativePrompt: baseSpec.negativePrompt,
      pipeline: baseSpec.pipeline || "sdxl_txt2img",
      architecture: baseSpec.architecture,
      stylePreset: baseSpec.stylePreset,
      baseModel: baseSpec.baseModel || "Illustrious-XL-v2.0.safetensors",
      vaeModel: baseSpec.vaeModel,
      textEncoder1: baseSpec.textEncoder1,
      textEncoder2: baseSpec.textEncoder2,
      loras: baseSpec.loras,
      ipConnectors: baseSpec.ipConnectors,
      controlNets: baseSpec.controlNets,
      characters: baseSpec.characters,
      relight: baseSpec.relight,
      relightRefImagePath: baseSpec.relightRefImagePath,
      inpaintMaskImagePath: baseSpec.inpaintMaskImagePath,
      upscalerModel: baseSpec.upscalerModel,
      enableFaceDetailer: baseSpec.enableFaceDetailer,
      enableHandDetailer: baseSpec.enableHandDetailer,
      enable360Preview: baseSpec.enable360Preview,
      dualGpuSplit: executionMode === "dual_split" ? true : baseSpec.dualGpuSplit,
      width: baseSpec.width || 1024,
      height: baseSpec.height || 1024,
      steps: baseSpec.steps,
      cfg: baseSpec.cfg,
      samplerName: baseSpec.samplerName,
      scheduler: baseSpec.scheduler,
      batchSize: 1,
      refImagePath: baseSpec.refImagePath,
    };

    const scenes: CanonicalSceneSpec[] = [];

    if (mode === "prompt_list") {
      const items = Array.isArray(body.items) ? (body.items as ExpandPromptItem[]) : [];
      const rawLines: ExpandPromptItem[] =
        items.length > 0
          ? items
          : cleanStrArr(body.prompts).map((p, idx) => ({
              title: `Shot ${idx + 1}`,
              prompt: p,
            }));

      for (let i = 0; i < Math.min(rawLines.length, maxTasks); i++) {
        const it = rawLines[i];
        if (!it?.prompt?.trim()) continue;
        scenes.push({
          sceneKey: `batch-${String(i + 1).padStart(3, "0")}`,
          title: it.title || `Shot ${i + 1}`,
          tracks: {
            visual: {
              ...baseVisual,
              prompt: it.prompt.trim(),
              negativePrompt: it.negativePrompt ?? baseVisual.negativePrompt,
              baseModel: it.baseModel || baseVisual.baseModel,
              seed: typeof it.seed === "number" ? it.seed : baseVisual.seed,
              refImagePath: it.refImagePath || baseVisual.refImagePath,
            },
          },
        });
      }
    } else if (mode === "matrix") {
      const matrix = (body.matrix && typeof body.matrix === "object" ? body.matrix : {}) as ExpandMatrixConfig;
      const prompts = cleanStrArr(matrix.prompts, [baseVisual.prompt]);
      const models = cleanStrArr(matrix.baseModels, [baseVisual.baseModel || "Illustrious-XL-v2.0.safetensors"]);
      const cfgs =
        Array.isArray(matrix.cfgValues) && matrix.cfgValues.length > 0
          ? matrix.cfgValues.map(Number).filter(Number.isFinite)
          : [baseVisual.cfg ?? 6];
      const stepsList =
        Array.isArray(matrix.stepsValues) && matrix.stepsValues.length > 0
          ? matrix.stepsValues.map(Number).filter(Number.isFinite)
          : [baseVisual.steps ?? 24];
      const loraVars =
        Array.isArray(matrix.loraVariants) && matrix.loraVariants.length > 0
          ? matrix.loraVariants
          : [null];
      const seedCount = Math.min(8, Math.max(1, Number(matrix.seedCount) || 1));
      const baseSeed = Number.isFinite(Number(matrix.baseSeed))
        ? Number(matrix.baseSeed)
        : Math.floor(Math.random() * 1_000_000_000);

      let idx = 0;
      outer: for (const ckpt of models) {
        for (const loraVar of loraVars) {
          for (const promptText of prompts) {
            for (const cfgVal of cfgs) {
              for (const stepVal of stepsList) {
                for (let s = 0; s < seedCount; s++) {
                  if (scenes.length >= maxTasks) break outer;
                  idx++;
                  const mergedLoras = loraVar
                    ? [
                        ...(baseVisual.loras || []).filter((l) => l.filename !== loraVar.filename),
                        { filename: loraVar.filename, strength: loraVar.strength ?? 0.8 },
                      ]
                    : baseVisual.loras;
                  scenes.push({
                    sceneKey: `mx-${String(idx).padStart(3, "0")}`,
                    title: `${ckpt.split(".")[0].slice(0, 14)} · cfg${cfgVal} · st${stepVal} · s${s + 1}`,
                    tracks: {
                      visual: {
                        ...baseVisual,
                        baseModel: ckpt,
                        loras: mergedLoras,
                        prompt: promptText,
                        cfg: cfgVal,
                        steps: stepVal,
                        seed: seedCount > 1 ? baseSeed + s * 101 : baseVisual.seed,
                      },
                    },
                  });
                }
              }
            }
          }
        }
      }
    } else if (mode === "character_ip_set") {
      const refImage = String(body.referenceImage || baseVisual.refImagePath || "").trim();
      const ipMode = String(body.ipConnectorMode || "noob_ipa_mk1") as NonNullable<
        CanonicalVisualTrackSpec["ipConnectors"]
      >[number]["mode"];
      const ipWeight = typeof body.ipWeight === "number" ? body.ipWeight : 0.72;
      const poses = cleanStrArr(body.poses, [
        "front bust portrait looking at viewer, soft rim light",
        "three-quarter dynamic action pose, wind blowing hair",
        "full body character standing turnaround sheet",
        "dramatic backlit silhouette closeup, intense expression",
      ]);

      for (let i = 0; i < Math.min(poses.length, maxTasks); i++) {
        const pose = poses[i];
        const nextIp = refImage
          ? [
              {
                mode: ipMode,
                refImagePath: refImage,
                weight: ipWeight,
                startAt: 0,
                endAt: 0.9,
              },
            ]
          : baseVisual.ipConnectors;
        scenes.push({
          sceneKey: `char-${String(i + 1).padStart(2, "0")}`,
          title: `Pose ${i + 1}`,
          tracks: {
            visual: {
              ...baseVisual,
              refImagePath: refImage || baseVisual.refImagePath,
              ipConnectors: nextIp,
              prompt: `${baseVisual.prompt}, ${pose}`,
            },
          },
        });
      }
    } else if (mode === "folder_i2i") {
      const rawItems = Array.isArray(body.items)
        ? (body.items as Array<{ imagePath: string; label?: string; prompt?: string }>)
        : [];
      for (let i = 0; i < Math.min(rawItems.length, maxTasks); i++) {
        const item = rawItems[i];
        if (!item?.imagePath?.trim()) continue;
        scenes.push({
          sceneKey: `img-${String(i + 1).padStart(3, "0")}`,
          title: item.label || `Image ${i + 1}`,
          tracks: {
            visual: {
              ...baseVisual,
              refImagePath: item.imagePath.trim(),
              prompt: item.prompt?.trim() || baseVisual.prompt,
            },
          },
        });
      }
    }

    if (scenes.length === 0) {
      return NextResponse.json(
        { error: "No valid batch items or prompts supplied." },
        { status: 400 }
      );
    }

    const spec: ScriptoriaSceneSpecV1 = {
      specVersion: "1.0",
      sourceApp: "studio-batch",
      title,
      executionMode,
      baseSpec: baseVisual as unknown as Record<string, unknown>,
      defaults: {
        stylePreset: baseVisual.stylePreset,
        baseModel: baseVisual.baseModel,
        width: baseVisual.width,
        height: baseVisual.height,
      },
      scenes,
      normalizedBy: "canonical",
    };

    const result = await createBatchFromSpec({
      userId: auth.userId,
      spec,
      dryRun,
    });

    return NextResponse.json({
      ok: true,
      dryRun,
      mode,
      executionMode,
      sceneCount: scenes.length,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to expand studio batch";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
