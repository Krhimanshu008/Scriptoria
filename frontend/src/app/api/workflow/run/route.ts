import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { getPresetById } from "@/lib/orchestrator/workflow-presets";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const target = String(body.target || "gpu0");
    const preset = getPresetById(body.presetId ? String(body.presetId) : null);
    const customWorkflowJson =
      body.customWorkflowJson && typeof body.customWorkflowJson === "object"
        ? (body.customWorkflowJson as Record<string, unknown>)
        : null;

    const prompt = String(body.prompt || preset?.defaultPrompt || "").trim();
    const negativePrompt = body.negativePrompt
      ? String(body.negativePrompt)
      : preset?.defaultNegativePrompt || "bad quality, blurry, deformed";
    const requestedCheckpoint = body.checkpoint ? String(body.checkpoint).trim() : "";
    const width = Number(body.width) || preset?.width || 1024;
    const height = Number(body.height) || preset?.height || 1024;
    const steps = Number(body.steps) || preset?.steps || 25;
    const cfg = Number(body.cfg) || preset?.cfg || 6.0;
    const samplerName = String(body.samplerName || preset?.samplerName || "euler_ancestral");
    const scheduler = String(body.scheduler || preset?.scheduler || "normal");
    const hiresPass = Boolean(body.hiresPass ?? preset?.hiresPass);
    const seed = body.seed ? Number(body.seed) : Math.floor(100_000 + Math.random() * 999_000_000);

    if (!prompt && !customWorkflowJson) {
      return NextResponse.json({ error: "Prompt text or custom workflow JSON is required." }, { status: 400 });
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({ error: `GPU ${target} is not online.` }, { status: 400 });
    }

    const client = new ComfyClient(vm);
    let checkpoint = requestedCheckpoint || "custom-workflow";

    if (!customWorkflowJson) {
      if (!requestedCheckpoint) {
        const catalog = await client.getCatalog(target);
        const ckpts = catalog.models.checkpoints;
        if (!ckpts.length) {
          return NextResponse.json(
            { error: "No checkpoints are loaded on this GPU yet. Stream a checkpoint in the Models tab first." },
            { status: 400 }
          );
        }
        checkpoint =
          preset && ckpts.includes(preset.recommendedCheckpoint)
            ? preset.recommendedCheckpoint
            : ckpts[0];
      } else {
        checkpoint = requestedCheckpoint;
      }
    }

    const job = await prisma.job.create({
      data: {
        userId: user.userId,
        vmInstanceId: vm.id,
        target,
        prompt: prompt || `[Custom Workflow] ${preset?.name || "API JSON"}`,
        negativePrompt,
        checkpoint,
        width,
        height,
        steps,
        cfg,
        seed: String(seed),
        status: "PROCESSING",
      },
    });

    const graph =
      customWorkflowJson ??
      ComfyClient.buildStandardPromptGraph({
        prompt,
        negativePrompt,
        checkpoint,
        width,
        height,
        steps,
        cfg,
        samplerName,
        scheduler,
        hiresPass,
        seed,
        target,
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
        message: `Queued ${preset ? `[${preset.name}]` : "job"} ${job.id} on ${target} using ${checkpoint} (${samplerName}/${scheduler}).`,
      });

      return NextResponse.json({
        jobId: job.id,
        promptId: prompt_id,
        status: "PROCESSING",
        checkpoint,
        seed: String(seed),
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
        message: `ComfyUI dispatch error on ${target}: ${errMsg}`,
      });
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
