import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { compileResourceAwareWorkflow, type WorkflowBuildSpec } from "@/lib/workflow/compiler";
import { saveCompiledWorkflowTemplate } from "@/lib/workflow/registry";
import { recommendWorkflowStacks, type RecommendWorkflowInput } from "@/lib/workflow/recommender";
import { callLlmJson, resolveCandidateLlmConfigs } from "@/lib/agent/llm-client";
import { ensureModelReadyOnVm } from "@/lib/catalog/ensure-helper";
import { enqueueHeadlessBatchJobForStudio } from "@/lib/batch/studio-headless";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      action?: "compile" | "optimize_with_ai" | "architect" | "save_template" | "compile_and_run";
      spec?: WorkflowBuildSpec;
      goal?: string;
      architectInput?: RecommendWorkflowInput;
      autoSave?: boolean;
      target?: string;
      templateName?: string;
      templateDescription?: string;
    };

    const action = body.action || "compile";
    const spec: WorkflowBuildSpec = body.spec || { pipeline: "sdxl_txt2img" };

    // AI Workflow Architect: recommends stack + designs modular graph + optionally refines via LLM & saves
    if (action === "architect") {
      const recInput: RecommendWorkflowInput = {
        ...(body.architectInput || {}),
        goal: body.goal || body.architectInput?.goal || body.spec?.prompt || "anime story scene",
      };
      const rec = await recommendWorkflowStacks(user.userId, recInput);
      const top = rec.recommendations[0];
      if (!top) {
        return NextResponse.json({ error: "No matching workflow stack found." }, { status: 400 });
      }

      let designedSpec: WorkflowBuildSpec = {
        ...top.recommendedSpec,
        ...(body.spec || {}),
      };
      let reasoning = `Selected ${top.title} (${top.whyRecommended.join(" ")})`;

      const llmCandidates = await resolveCandidateLlmConfigs(user.userId).catch(() => []);
      if (llmCandidates.length > 0 && body.goal) {
        const refined = await callLlmJson<{ specUpdates?: Partial<WorkflowBuildSpec>; reasoning?: string }>({
          userId: user.userId,
          systemPrompt:
            "Given a recommended Kaggle T4 WorkflowBuildSpec JSON and a user's visual goal, return optional fine-tuning JSON { specUpdates: { prompt?, negativePrompt?, width?, height?, steps?, cfg? }, reasoning: string }.",
          userPrompt: JSON.stringify({ goal: body.goal, recommendedSpec: designedSpec }),
        }).catch(() => null);
        if (refined?.data?.specUpdates) {
          designedSpec = { ...designedSpec, ...refined.data.specUpdates };
          if (refined.data.reasoning) reasoning = refined.data.reasoning;
        }
      }

      const compiled = await compileResourceAwareWorkflow(user.userId, designedSpec, body.target);
      let saved: { id: string; slug: string; name: string } | null = null;
      if (body.autoSave) {
        saved = await saveCompiledWorkflowTemplate({
          userId: user.userId,
          name: body.templateName || `Architect · ${top.title.split("(")[0].trim()}`,
          description: body.templateDescription || reasoning,
          compiled,
          inputDefaults: {
            width: designedSpec.width || 1024,
            height: designedSpec.height || 1024,
          },
        });
      }

      return NextResponse.json({
        ok: true,
        inferredIntent: rec.inferredIntent,
        topRecommendation: top,
        alternatives: rec.recommendations.slice(1),
        designedSpec,
        reasoning,
        compiled,
        ...(saved ? { savedTemplateId: saved.id, slug: saved.slug } : {}),
      });
    }

    // Optional AI optimization pass before compiling
    if (action === "optimize_with_ai") {
      const optimized = await callLlmJson<{ spec: WorkflowBuildSpec; reasoning: string }>({
        userId: user.userId,
        systemPrompt:
          "You optimize ComfyUI workflows for 16 GB Tesla T4 GPUs. Given a WorkflowBuildSpec JSON, tune steps, cfg, samplerName, scheduler, resolution (width/height), and vaeModel (`sdxl_vae_fp16_fix.safetensors` for SDXL/Illustrious) for best quality without OOM. Return `{ spec: { ... }, reasoning: string }`.",
        userPrompt: JSON.stringify(spec),
      });

      if (!optimized) {
        return NextResponse.json(
          { error: "Configure an AI Provider LLM Key in Settings → Key Readiness first." },
          { status: 400 }
        );
      }
      const compiled = await compileResourceAwareWorkflow(
        user.userId,
        { ...spec, ...optimized.data.spec },
        body.target
      );
      return NextResponse.json({
        ok: true,
        optimizedSpec: { ...spec, ...optimized.data.spec },
        reasoning: optimized.data.reasoning,
        compiled,
      });
    }

    const compiled = await compileResourceAwareWorkflow(user.userId, spec, body.target);

    if (action === "save_template") {
      const saved = await saveCompiledWorkflowTemplate({
        userId: user.userId,
        name: String(body.templateName || `Custom · ${compiled.pipeline}`).trim(),
        description: body.templateDescription,
        compiled,
        inputDefaults: { width: spec.width || 1024, height: spec.height || 1024 },
      });

      return NextResponse.json({ ok: true, compiled, savedTemplateId: saved.id, slug: saved.slug });
    }

    if (action === "compile_and_run") {
      const target = body.target || "gpu0";
      const vm = await prisma.vmInstance.findUnique({
        where: { userId_target: { userId: user.userId, target } },
      });
      if (!vm || vm.status !== "ONLINE") {
        return NextResponse.json(
          { error: `GPU ${target.toUpperCase()} is offline. Boot it via Kaggle Launcher first.` },
          { status: 400 }
        );
      }

      // Safe Headless Mode (no Cloudflare/Caddy proxy): enqueue outbound batch task + linked Job
      if (!vm.publicUrl) {
        const queued = await enqueueHeadlessBatchJobForStudio({
          userId: user.userId,
          vm,
          prompt: spec.prompt || spec.dialogueText || `[Creator] ${compiled.pipeline}`,
          negativePrompt: spec.negativePrompt || null,
          checkpoint: spec.baseModel || compiled.pipeline,
          width: spec.width || 1024,
          height: spec.height || 1024,
          steps: spec.steps || 20,
          cfg: spec.cfg || 6.0,
          seed: String(spec.seed || 0),
          workerProfile: vm.workerProfile,
          requiredModels: compiled.requiredModels,
          graph: compiled.graph,
        });

        await appendSystemLog({
          userId: user.userId,
          vmInstanceId: vm.id,
          category: "COMFYUI",
          level: "INFO",
          message: `Queued ${compiled.pipeline} job ${queued.jobId} for Safe Headless worker on ${target} (no tunnel).`,
        });

        return NextResponse.json({
          ok: true,
          status: "PROCESSING",
          headless: true,
          jobId: queued.jobId,
          batchId: queued.batchId,
          compiled,
        });
      }

      // Ensure required models are cached/streaming before dispatch
      const ensureResults = [];
      for (const reqModel of compiled.requiredModels) {
        try {
          const r = await ensureModelReadyOnVm({
            userId: user.userId,
            vm,
            slug: reqModel.slug,
            filename: reqModel.filename,
            category: reqModel.category,
          });
          ensureResults.push(r);
        } catch (err) {
          return NextResponse.json(
            {
              error: `Model ensure failed for ${reqModel.filename}: ${
                err instanceof Error ? err.message : "unknown error"
              }`,
              compiled,
            },
            { status: 400 }
          );
        }
      }

      const started = ensureResults.filter((r) => r.status === "started");
      if (started.length > 0) {
        return NextResponse.json({
          ok: true,
          status: "TRANSFERRING_MODELS",
          message: `Streaming ${started.length} model(s) into ${target.toUpperCase()} /tmp/models first; run again once complete.`,
          ensureResults,
          compiled,
        });
      }

      const job = await prisma.job.create({
        data: {
          userId: user.userId,
          vmInstanceId: vm.id,
          target,
          prompt: spec.prompt || spec.dialogueText || `[Creator] ${compiled.pipeline}`,
          negativePrompt: spec.negativePrompt || null,
          checkpoint: spec.baseModel || compiled.pipeline,
          width: spec.width || 1024,
          height: spec.height || 1024,
          steps: spec.steps || 20,
          cfg: spec.cfg || 6.0,
          seed: String(spec.seed || 0),
          status: "PROCESSING",
        },
      });

      const comfyClient = new ComfyClient(vm);
      await comfyClient.stageGraphReferenceImages(compiled.graph);
      const { prompt_id } = await comfyClient.queuePrompt(compiled.graph, job.id);
      await prisma.job.update({ where: { id: job.id }, data: { promptId: prompt_id } });

      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "COMFYUI",
        level: "SUCCESS",
        message: `Compiled & queued ${compiled.pipeline} job ${job.id} on ${target}.`,
      });

      return NextResponse.json({
        ok: true,
        status: "PROCESSING",
        jobId: job.id,
        promptId: prompt_id,
        compiled,
      });
    }

    return NextResponse.json({ ok: true, compiled });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow compile failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

