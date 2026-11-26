import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { ensureModelReadyOnVm } from "@/lib/catalog/ensure-helper";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { appendSystemLog } from "@/lib/logs/logger";
import {
  compileStandaloneMediaRequest,
  pickBestOnlineVmForProfile,
} from "@/lib/workflow/registry";
import type { MediaJobRequestV1, MediaJobResultV1 } from "@/types/media-contract";

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = (await req.json().catch(() => ({}))) as MediaJobRequestV1;
    const compiled = await compileStandaloneMediaRequest(auth.userId, body);
    const mode = body.mode === "queue" ? "queue" : "realtime";

    if (mode === "queue") {
      const batch = await prisma.batchJob.create({
        data: {
          userId: auth.userId,
          title: body.title || compiled.promptSummary.slice(0, 80),
          sourceApp: "standalone-v1-render",
          totalTasks: 1,
          status: "QUEUED",
        },
      });

      const task = await prisma.batchTask.create({
        data: {
          batchId: batch.id,
          sequenceIndex: 0,
          sceneKey: body.sceneKey || "scene-1",
          trackType: compiled.modality,
          workerProfile: compiled.targetProfile,
          workflowSlug: compiled.workflowSlug,
          baseCheckpoint: compiled.baseCheckpoint,
          inputParamsJson: JSON.stringify(compiled.resolvedInputs),
          compiledGraphJson: JSON.stringify(compiled.graph),
          status: "PENDING",
        },
      });

      const result: MediaJobResultV1 = {
        version: "1.0",
        jobId: task.id,
        batchId: batch.id,
        taskId: task.id,
        status: "QUEUED",
        workerProfile: compiled.targetProfile,
        workflowSlug: compiled.workflowSlug,
        artifacts: [],
        warnings: compiled.warnings,
        statusUrl: `/api/v1/render/${encodeURIComponent(task.id)}`,
      };
      return NextResponse.json(result, { status: 202 });
    }

    const vm = await pickBestOnlineVmForProfile(auth.userId, compiled.targetProfile, body.target);

    if (body.ensureModels !== false && compiled.requiredModels.length > 0) {
      const ensureResults = [];
      for (const reqModel of compiled.requiredModels) {
        const res = await ensureModelReadyOnVm({
          userId: auth.userId,
          vm,
          slug: reqModel.slug,
          filename: reqModel.filename,
          category: reqModel.category,
        });
        ensureResults.push(res);
      }

      const started = ensureResults.filter((r) => r.status === "started");
      if (started.length > 0) {
        const transferring: MediaJobResultV1 = {
          version: "1.0",
          jobId: "",
          status: "TRANSFERRING_MODELS",
          target: vm.target,
          workerProfile: vm.workerProfile,
          workflowSlug: compiled.workflowSlug,
          artifacts: [],
          warnings: compiled.warnings,
          ensureResults,
          statusUrl: "/api/v1/render",
        };
        return NextResponse.json(transferring, { status: 202 });
      }
    }

    const seed = String(compiled.resolvedInputs.seed ?? Math.floor(Math.random() * 2_000_000_000));
    const width = Number(compiled.resolvedInputs.width ?? 1024);
    const height = Number(compiled.resolvedInputs.height ?? 1024);
    const steps = Number(compiled.resolvedInputs.steps ?? 24);
    const cfg = Number(compiled.resolvedInputs.cfg ?? 6.0);

    const job = await prisma.job.create({
      data: {
        userId: auth.userId,
        vmInstanceId: vm.id,
        target: vm.target,
        prompt: compiled.promptSummary,
        negativePrompt: String(compiled.resolvedInputs.negativePrompt || ""),
        checkpoint: compiled.baseCheckpoint,
        width: Number.isFinite(width) ? width : 1024,
        height: Number.isFinite(height) ? height : 1024,
        steps: Number.isFinite(steps) ? steps : 24,
        cfg: Number.isFinite(cfg) ? cfg : 6.0,
        seed,
        status: "PROCESSING",
      },
    });

    try {
      const client = new ComfyClient(vm);
      const { prompt_id } = await client.queuePrompt(compiled.graph, job.id);
      await prisma.job.update({
        where: { id: job.id },
        data: { promptId: prompt_id },
      });

      await appendSystemLog({
        userId: auth.userId,
        vmInstanceId: vm.id,
        category: "COMFYUI",
        level: "INFO",
        message: `Standalone render API queued job ${job.id} (${compiled.workflowSlug}) on ${vm.target}.`,
      });

      const responsePayload: MediaJobResultV1 = {
        version: "1.0",
        jobId: job.id,
        status: "PROCESSING",
        target: vm.target,
        workerProfile: vm.workerProfile,
        workflowSlug: compiled.workflowSlug,
        promptId: prompt_id,
        artifacts: [],
        warnings: compiled.warnings,
        statusUrl: `/api/v1/render/${encodeURIComponent(job.id)}`,
      };
      return NextResponse.json(responsePayload);
    } catch (dispatchErr) {
      const errMsg =
        dispatchErr instanceof Error ? dispatchErr.message : "Failed dispatching prompt to ComfyUI";
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMessage: errMsg, completedAt: new Date() },
      });
      return NextResponse.json({ error: errMsg, jobId: job.id }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render dispatch failed";
    const status =
      message.includes("not found")
        ? 404
        : message.includes("Missing required") || message.includes("ONLINE")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
