import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { parseWorkflowParamsFromBody } from "@/lib/orchestrator/workflow-presets";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const parsed = parseWorkflowParamsFromBody(body);

    if (!parsed.prompt && !parsed.customWorkflowJson) {
      return NextResponse.json(
        { error: "Prompt text or custom workflow JSON is required." },
        { status: 400 }
      );
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target: parsed.target } },
    });
    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({ error: `GPU ${parsed.target} is not online.` }, { status: 400 });
    }

    const client = new ComfyClient(vm);
    let checkpoint = parsed.requestedCheckpoint || "custom-workflow";

    if (!parsed.customWorkflowJson) {
      if (!parsed.requestedCheckpoint) {
        const catalog = await client.getCatalog(parsed.target);
        const ckpts = catalog.models.checkpoints;
        if (!ckpts.length) {
          return NextResponse.json(
            { error: "No checkpoints are loaded on this GPU yet. Stream a checkpoint in the Models tab first." },
            { status: 400 }
          );
        }
        checkpoint =
          parsed.preset && ckpts.includes(parsed.preset.recommendedCheckpoint)
            ? parsed.preset.recommendedCheckpoint
            : ckpts[0];
      } else {
        checkpoint = parsed.requestedCheckpoint;
      }
    }

    const job = await prisma.job.create({
      data: {
        userId: user.userId,
        vmInstanceId: vm.id,
        target: parsed.target,
        prompt: parsed.prompt || `[Custom Workflow] ${parsed.preset?.name || "API JSON"}`,
        negativePrompt: parsed.negativePrompt,
        checkpoint,
        width: parsed.width,
        height: parsed.height,
        steps: parsed.steps,
        cfg: parsed.cfg,
        seed: String(parsed.seed),
        status: "PROCESSING",
      },
    });

    const graph =
      parsed.customWorkflowJson ??
      ComfyClient.buildStandardPromptGraph({
        prompt: parsed.prompt,
        negativePrompt: parsed.negativePrompt,
        checkpoint,
        width: parsed.width,
        height: parsed.height,
        steps: parsed.steps,
        cfg: parsed.cfg,
        samplerName: parsed.samplerName,
        scheduler: parsed.scheduler,
        hiresPass: parsed.hiresPass,
        batchSize: parsed.batchSize,
        loraName: parsed.loraName || undefined,
        loraStrength: parsed.loraStrength,
        seed: parsed.seed,
        target: parsed.target,
      });

    try {
      const { prompt_id } = await client.queuePrompt(graph, job.id);
      await prisma.job.update({
        where: { id: job.id },
        data: { promptId: prompt_id },
      });

      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "COMFYUI",
        level: "INFO",
        message: `Queued ${parsed.preset ? `[${parsed.preset.name}]` : "job"} ${job.id} on ${parsed.target} using ${checkpoint} (${parsed.samplerName}/${parsed.scheduler}, batch=${parsed.batchSize}).`,
      });

      return NextResponse.json({
        jobId: job.id,
        promptId: prompt_id,
        status: "PROCESSING",
        checkpoint,
        seed: String(parsed.seed),
      });
    } catch (queueErr) {
      const errMsg = queueErr instanceof Error ? queueErr.message : "Failed to queue prompt";
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMessage: errMsg },
      });
      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "ERROR",
        level: "ERROR",
        message: `ComfyUI dispatch error on ${parsed.target}: ${errMsg}`,
      });
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
