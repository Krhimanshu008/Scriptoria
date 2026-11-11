import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const target = String(body.target || "gpu0");
    const prompt = String(body.prompt || "").trim();
    const negativePrompt = body.negativePrompt
      ? String(body.negativePrompt)
      : "bad quality, blurry, deformed";
    const requestedCheckpoint = body.checkpoint ? String(body.checkpoint).trim() : "";
    const width = Number(body.width) || 1024;
    const height = Number(body.height) || 1024;
    const steps = Number(body.steps) || 25;
    const cfg = Number(body.cfg) || 6.0;
    const seed = body.seed ? Number(body.seed) : Math.floor(100_000 + Math.random() * 999_000_000);

    if (!prompt) {
      return NextResponse.json({ error: "Prompt text is required." }, { status: 400 });
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({ error: `GPU ${target} is not online.` }, { status: 400 });
    }

    const client = new ComfyClient(vm);
    let checkpoint = requestedCheckpoint;
    if (!checkpoint) {
      const catalog = await client.getCatalog(target);
      const ckpts = catalog.models.checkpoints;
      if (!ckpts.length) {
        return NextResponse.json(
          { error: "No checkpoints are loaded on this GPU yet. Stream a checkpoint in the Models tab first." },
          { status: 400 }
        );
      }
      checkpoint = ckpts[0];
    }

    const job = await prisma.job.create({
      data: {
        userId: user.userId,
        vmInstanceId: vm.id,
        target,
        prompt,
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

    const graph = ComfyClient.buildStandardPromptGraph({
      prompt,
      negativePrompt,
      checkpoint,
      width,
      height,
      steps,
      cfg,
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
        message: `Queued job ${job.id} on ${target} using ${checkpoint} (prompt_id: ${prompt_id}).`,
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

