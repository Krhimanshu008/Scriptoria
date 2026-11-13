import { prisma } from "@/lib/db/prisma";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { ensureUserCatalogSeeded } from "@/lib/catalog/seed-catalog";
import { compileResourceAwareWorkflow, type WorkflowBuildSpec } from "@/lib/workflow/compiler";
import { ensureModelReadyOnVm } from "@/lib/catalog/ensure-helper";
import { normalizeExternalPayload } from "@/lib/batch/ingestion-spec";
import { createBatchFromSpec, tickBatchScheduler } from "@/lib/batch/scheduler";
import { appendSystemLog } from "@/lib/logs/logger";
import type { LlmToolDefinition } from "@/lib/agent/llm-client";

export const AGENT_TOOL_DEFINITIONS: LlmToolDefinition[] = [
  {
    name: "get_cluster_state",
    description:
      "Inspect all GPUs (gpu0..gpu7, gcgpu, gcgpu1), online status, worker profiles, free VRAM, cached /tmp checkpoints, and recent batch jobs.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "Scope of GPUs to inspect: 'all' or 'online'",
        },
      },
    },
  },
  {
    name: "search_catalog",
    description:
      "Search the user's Master Model Catalog (Image, Audio, Video checkpoints, LoRAs, VAEs, TTS, upscalers) and saved WorkflowTemplates.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword filter (optional)" },
        modality: {
          type: "string",
          description: "IMAGE, AUDIO, VIDEO, SHARED, or ALL",
        },
      },
    },
  },
  {
    name: "compose_and_validate_workflow",
    description:
      "Compile a declarative multi-modal ComfyUI workflow spec with 16 GB T4 VRAM budget estimation and automatic sdxl_vae_fp16_fix injection.",
    parameters: {
      type: "object",
      properties: {
        pipeline: {
          type: "string",
          description:
            "sdxl_txt2img | sdxl_detailer_upscale | flux_gguf | qwen_edit | audio_kokoro | audio_f5 | audio_mmaudio | audio_stable | video_ltx | video_latentsync",
        },
        baseModel: { type: "string" },
        vaeModel: { type: "string" },
        prompt: { type: "string" },
        negativePrompt: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        steps: { type: "number" },
        cfg: { type: "number" },
        dialogueText: { type: "string" },
        voice: { type: "string" },
        target: { type: "string" },
      },
      required: ["pipeline"],
    },
  },
  {
    name: "ensure_models_ready",
    description:
      "Ensure one or more catalog models are cached in /tmp/models on an ONLINE GPU (pulls fast from HF/Civitai with 5TB Drive backup or Drive fallback).",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "gpu0 | gpu1 | gpu2 | gpu3 | gpu4 | gpu5 | gpu6 | gpu7 | gcgpu | gcgpu1" },
        modelFilenamesOrSlugs: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["target", "modelFilenamesOrSlugs"],
    },
  },
  {
    name: "run_compiled_workflow",
    description:
      "Dispatch a compiled workflow spec directly to an ONLINE GPU and queue it in ComfyUI.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "Target ONLINE GPU (e.g. gpu0, gcgpu)" },
        pipeline: {
          type: "string",
          description:
            "sdxl_txt2img | sdxl_detailer_upscale | flux_gguf | qwen_edit | audio_kokoro | audio_f5 | audio_mmaudio | audio_stable | video_ltx | video_latentsync",
        },
        baseModel: { type: "string", description: "Checkpoint / UNet / Audio model filename" },
        prompt: { type: "string", description: "Positive prompt or dialogue text" },
        width: { type: "number", description: "Width in px (e.g. 1024)" },
        height: { type: "number", description: "Height in px (e.g. 1024)" },
        steps: { type: "number", description: "Sampling steps" },
        cfg: { type: "number", description: "CFG scale" },
      },
      required: ["target", "pipeline"],
    },
  },
  {
    name: "create_multi_gpu_batch",
    description:
      "Create and optimize a multi-GPU batch across all available GPUs from raw story text, chapter Markdown, or structured scenes, coalescing models to prevent swaps.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        rawText: { type: "string", description: "Chapter prose, shot list, or structured description" },
        adapterHints: { type: "string", description: "Style, checkpoint, or voice guidance" },
      },
      required: ["title", "rawText"],
    },
  },
  {
    name: "dispatch_multi_gpu_prompt",
    description:
      "Simultaneously dispatch an image generation prompt to multiple GPUs (e.g. ['gpu0', 'gpu1'] or ['all']) in parallel with randomized seeds.",
    parameters: {
      type: "object",
      properties: {
        targets: {
          type: "array",
          items: { type: "string" },
          description: "List of targets e.g. ['gpu0', 'gpu1'] or ['all']",
        },
        prompt: { type: "string", description: "Positive prompt" },
        negativePrompt: { type: "string", description: "Negative prompt" },
        pipeline: {
          type: "string",
          description: "sdxl_txt2img | flux_gguf | sdxl_detailer_upscale | wai_illustrious",
        },
        checkpoint: { type: "string", description: "Model checkpoint filename or slug" },
        width: { type: "number", description: "Width (default 1024)" },
        height: { type: "number", description: "Height (default 1024)" },
        steps: { type: "number", description: "Inference steps (default 25)" },
        cfg: { type: "number", description: "CFG scale (default 6.0)" },
      },
      required: ["prompt"],
    },
  },
];

export const MUTATING_AGENT_TOOLS = new Set([
  "ensure_models_ready",
  "run_compiled_workflow",
  "create_multi_gpu_batch",
  "dispatch_multi_gpu_prompt",
]);

export async function executeAgentTool(
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (name === "get_cluster_state") {
    const [vms, activeBatches] = await Promise.all([
      prisma.vmInstance.findMany({ where: { userId }, orderBy: { target: "asc" } }),
      prisma.batchJob.findMany({
        where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true, title: true, status: true, totalTasks: true, completedTasks: true },
      }),
    ]);

    const gpuSummaries = await Promise.all(
      vms.map(async (vm) => {
        let cachedCheckpoints: string[] = [];
        if (vm.status === "ONLINE" && vm.publicUrl) {
          try {
            const cat = await new ComfyClient(vm).getCatalog(vm.target);
            cachedCheckpoints = cat.models.checkpoints;
          } catch {
            cachedCheckpoints = [];
          }
        }
        return {
          target: vm.target,
          provider: vm.provider,
          status: vm.status,
          workerProfile: vm.workerProfile,
          vramFreeGb: Number(((vm.vramTotalGb ?? 16) - (vm.vramUsedGb ?? 0)).toFixed(1)),
          vramTotalGb: vm.vramTotalGb ?? 16,
          cachedCheckpoints,
        };
      })
    );

    return { gpus: gpuSummaries, activeBatches };
  }

  if (name === "search_catalog") {
    await ensureUserCatalogSeeded(userId);
    const q = String(args.query || "").trim().toLowerCase();
    const modality = String(args.modality || "ALL").toUpperCase();

    const [models, workflows] = await Promise.all([
      prisma.modelAsset.findMany({
        where: {
          userId,
          ...(modality !== "ALL" ? { modality } : {}),
        },
        select: {
          slug: true,
          displayName: true,
          modality: true,
          category: true,
          filename: true,
          vramEstimateGb: true,
          compatibleBase: true,
          backupStatus: true,
        },
        take: 60,
      }),
      prisma.workflowTemplate.findMany({
        where: { userId },
        select: {
          slug: true,
          name: true,
          modality: true,
          targetProfile: true,
          vramRequiredGb: true,
        },
        take: 25,
      }),
    ]);

    const filtered = q
      ? models.filter(
          (m) =>
            m.displayName.toLowerCase().includes(q) ||
            m.filename.toLowerCase().includes(q) ||
            m.compatibleBase.toLowerCase().includes(q) ||
            m.category.toLowerCase().includes(q)
        )
      : models;

    return { models: filtered.slice(0, 25), workflows };
  }

  if (name === "compose_and_validate_workflow") {
    const spec: WorkflowBuildSpec = {
      pipeline: (String(args.pipeline || "sdxl_txt2img") as WorkflowBuildSpec["pipeline"]),
      baseModel: args.baseModel ? String(args.baseModel) : undefined,
      vaeModel: args.vaeModel ? String(args.vaeModel) : undefined,
      prompt: args.prompt ? String(args.prompt) : undefined,
      negativePrompt: args.negativePrompt ? String(args.negativePrompt) : undefined,
      width: typeof args.width === "number" ? args.width : undefined,
      height: typeof args.height === "number" ? args.height : undefined,
      steps: typeof args.steps === "number" ? args.steps : undefined,
      cfg: typeof args.cfg === "number" ? args.cfg : undefined,
      dialogueText: args.dialogueText ? String(args.dialogueText) : undefined,
      voice: args.voice ? String(args.voice) : undefined,
    };
    const compiled = await compileResourceAwareWorkflow(
      userId,
      spec,
      args.target ? String(args.target) : undefined
    );
    return {
      pipeline: compiled.pipeline,
      modality: compiled.modality,
      recommendedProfile: compiled.recommendedProfile,
      requiredModels: compiled.requiredModels,
      vramEstimateGb: compiled.vramEstimateGb,
      vramStatus: compiled.vramStatus,
      t4GuardrailsApplied: compiled.t4GuardrailsApplied,
      warnings: compiled.warnings,
    };
  }

  if (name === "ensure_models_ready") {
    const target = String(args.target || "gpu0");
    const items = Array.isArray(args.modelFilenamesOrSlugs)
      ? args.modelFilenamesOrSlugs.map(String)
      : [];
    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId, target } },
    });
    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return { error: `VM ${target} is not online. Boot it from VM Cluster first.` };
    }
    const results = [];
    for (const ref of items.slice(0, 5)) {
      const res = await ensureModelReadyOnVm({
        userId,
        vm,
        slug: ref,
        filename: ref,
      });
      results.push(res);
    }
    return { ok: true, results };
  }

  if (name === "run_compiled_workflow") {
    const target = String(args.target || "gpu0");
    const spec: WorkflowBuildSpec =
      args.spec && typeof args.spec === "object"
        ? (args.spec as WorkflowBuildSpec)
        : {
            pipeline: (String(args.pipeline || "sdxl_txt2img") as WorkflowBuildSpec["pipeline"]),
            baseModel: args.baseModel ? String(args.baseModel) : undefined,
            prompt: args.prompt ? String(args.prompt) : undefined,
            width: typeof args.width === "number" ? args.width : undefined,
            height: typeof args.height === "number" ? args.height : undefined,
            steps: typeof args.steps === "number" ? args.steps : undefined,
            cfg: typeof args.cfg === "number" ? args.cfg : undefined,
          };
    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId, target } },
    });
    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return { error: `GPU ${target} is offline. Boot it in VM Cluster first.` };
    }
    const compiled = await compileResourceAwareWorkflow(userId, spec, target);

    for (const reqModel of compiled.requiredModels) {
      const r = await ensureModelReadyOnVm({
        userId,
        vm,
        slug: reqModel.slug,
        filename: reqModel.filename,
        category: reqModel.category,
      });
      if (r.status === "started") {
        return {
          status: "TRANSFERRING_MODELS",
          message: `Streaming required model ${reqModel.filename} onto ${target}; re-run once complete.`,
        };
      }
    }

    const job = await prisma.job.create({
      data: {
        userId,
        vmInstanceId: vm.id,
        target,
        prompt: spec.prompt || spec.dialogueText || `[Agent] ${compiled.pipeline}`,
        negativePrompt: spec.negativePrompt || null,
        checkpoint: spec.baseModel || compiled.pipeline,
        width: spec.width || 1024,
        height: spec.height || 1024,
        steps: spec.steps || 20,
        cfg: spec.cfg || 6.0,
        seed: String(spec.seed || Math.floor(Math.random() * 1_000_000_000)),
        status: "PROCESSING",
      },
    });

    const { prompt_id } = await new ComfyClient(vm).queuePrompt(compiled.graph, job.id);
    await prisma.job.update({ where: { id: job.id }, data: { promptId: prompt_id } });
    await appendSystemLog({
      userId,
      vmInstanceId: vm.id,
      category: "COMFYUI",
      level: "SUCCESS",
      message: `Agentic Co-Director queued job ${job.id} (${compiled.pipeline}) on ${target}.`,
    });

    return { ok: true, jobId: job.id, promptId: prompt_id, target, pipeline: compiled.pipeline };
  }

  if (name === "create_multi_gpu_batch") {
    const spec = await normalizeExternalPayload(userId, {
      sourceApp: "agent-studio",
      title: String(args.title || "AI Co-Director Batch"),
      rawText: String(args.rawText || ""),
      adapterHints: args.adapterHints ? String(args.adapterHints) : undefined,
    });
    const plan = await createBatchFromSpec({ userId, spec, dryRun: false });
    if (plan.batchId) {
      const tick = await tickBatchScheduler(userId, plan.batchId).catch(() => null);
      return {
        ok: true,
        batchId: plan.batchId,
        coalesceSummary: plan.coalesceSummary,
        dispatchedOnFirstTick: tick?.dispatched ?? [],
      };
    }
    return plan;
  }

  if (name === "dispatch_multi_gpu_prompt") {
    const rawTargets = Array.isArray(args.targets) ? args.targets.map(String) : ["all"];
    let targetList: string[] = [];

    const allOnlineVms = await prisma.vmInstance.findMany({
      where: {
        userId,
        status: "ONLINE",
        workerProfile: {
          notIn: ["LLM_QWEN_VLM", "LLM_QWEN_TEXT_TURBO", "LLM_QWEN_MOE_35B", "LLM_QWEN_FAST_8B", "TPU_QWEN27B_V5E"],
        },
      },
    });

    if (allOnlineVms.length === 0) {
      return { error: "No image generation GPUs are currently ONLINE. Boot them in VM Cluster first." };
    }

    if (rawTargets.includes("all")) {
      targetList = allOnlineVms.map((v) => v.target);
    } else {
      targetList = rawTargets.filter((t) => allOnlineVms.some((v) => v.target === t));
    }

    if (targetList.length === 0) {
      return { error: `None of the requested targets (${rawTargets.join(", ")}) are online.` };
    }

    const baseSeed = Math.floor(Math.random() * 10000000);
    const results = [];

    for (let i = 0; i < targetList.length; i++) {
      const tgt = targetList[i];
      const vm = allOnlineVms.find((v) => v.target === tgt)!;
      const seed = String(baseSeed + i);
      const spec: WorkflowBuildSpec = {
        pipeline: (String(args.pipeline || "sdxl_txt2img") as WorkflowBuildSpec["pipeline"]),
        baseModel: args.checkpoint ? String(args.checkpoint) : undefined,
        prompt: String(args.prompt),
        negativePrompt: args.negativePrompt ? String(args.negativePrompt) : undefined,
        width: typeof args.width === "number" ? args.width : 1024,
        height: typeof args.height === "number" ? args.height : 1024,
        steps: typeof args.steps === "number" ? args.steps : 25,
        cfg: typeof args.cfg === "number" ? args.cfg : 6.0,
      };

      try {
        const compiled = await compileResourceAwareWorkflow(userId, spec, tgt);
        const job = await prisma.job.create({
          data: {
            userId,
            vmInstanceId: vm.id,
            target: tgt,
            prompt: spec.prompt || "[Multi-GPU Prompt]",
            negativePrompt: spec.negativePrompt || null,
            checkpoint: spec.baseModel || compiled.pipeline,
            width: spec.width || 1024,
            height: spec.height || 1024,
            steps: spec.steps || 25,
            cfg: spec.cfg || 6.0,
            seed,
            status: "PENDING",
          },
        });

        const comfy = new ComfyClient(vm);
        const { prompt_id } = await comfy.queuePrompt(compiled.graph, job.id);
        await prisma.job.update({
          where: { id: job.id },
          data: { promptId: prompt_id, status: "PROCESSING" },
        });

        results.push({
          target: tgt,
          jobId: job.id,
          promptId: prompt_id,
          seed,
          status: "QUEUED",
        });
      } catch (err) {
        results.push({
          target: tgt,
          error: err instanceof Error ? err.message : "Failed to queue",
          status: "FAILED",
        });
      }
    }

    return {
      message: `Dispatched prompt across ${results.length} GPU(s) in parallel.`,
      dispatchedCount: results.length,
      results,
    };
  }

  return { error: `Unknown tool '${name}'` };
}

