import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { compileResourceAwareWorkflow, type WorkflowBuildSpec } from "@/lib/workflow/compiler";
import { callLlmJson } from "@/lib/agent/llm-client";
import { ensureModelReadyOnVm } from "@/lib/catalog/ensure-helper";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      action?: "compile" | "optimize_with_ai" | "save_template" | "compile_and_run";
      spec?: WorkflowBuildSpec;
      target?: string;
      templateName?: string;
      templateDescription?: string;
    };

    const action = body.action || "compile";
    const spec: WorkflowBuildSpec = body.spec || { pipeline: "sdxl_txt2img" };

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
      const name = String(body.templateName || `Custom · ${compiled.pipeline}`).trim();
      const slug = `custom-${name}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);

      const saved = await prisma.workflowTemplate.upsert({
        where: { userId_slug: { userId: user.userId, slug } },
        update: {
          name,
          modality: compiled.modality,
          targetProfile: compiled.recommendedProfile,
          description:
            body.templateDescription?.trim() ||
            `Custom resource-aware ${compiled.pipeline} template (${compiled.vramEstimateGb} GB T4)`,
          vramRequiredGb: compiled.vramEstimateGb,
          requiredModelsJson: JSON.stringify(
            compiled.requiredModels.map((m) => m.slug || m.filename)
          ),
          requiredNodesJson: JSON.stringify(compiled.requiredNodes),
          apiGraphTemplateJson: JSON.stringify(compiled.graph),
          inputSchemaJson: JSON.stringify({ prompt: "string", width: spec.width || 1024, height: spec.height || 1024 }),
        },
        create: {
          userId: user.userId,
          slug,
          name,
          modality: compiled.modality,
          categoryTag: compiled.pipeline,
          targetProfile: compiled.recommendedProfile,
          description:
            body.templateDescription?.trim() ||
            `Custom resource-aware ${compiled.pipeline} template (${compiled.vramEstimateGb} GB T4)`,
          vramRequiredGb: compiled.vramEstimateGb,
          requiredModelsJson: JSON.stringify(
            compiled.requiredModels.map((m) => m.slug || m.filename)
          ),
          requiredNodesJson: JSON.stringify(compiled.requiredNodes),
          apiGraphTemplateJson: JSON.stringify(compiled.graph),
          inputSchemaJson: JSON.stringify({ prompt: "string", width: spec.width || 1024, height: spec.height || 1024 }),
          isSeeded: false,
        },
      });

      return NextResponse.json({ ok: true, compiled, savedTemplateId: saved.id, slug: saved.slug });
    }

    if (action === "compile_and_run") {
      const target = body.target || "gpu0";
      const vm = await prisma.vmInstance.findUnique({
        where: { userId_target: { userId: user.userId, target } },
      });
      if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
        return NextResponse.json(
          { error: `GPU ${target.toUpperCase()} is offline. Boot it on VM Cluster first.` },
          { status: 400 }
        );
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

      const { prompt_id } = await new ComfyClient(vm).queuePrompt(compiled.graph, job.id);
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

