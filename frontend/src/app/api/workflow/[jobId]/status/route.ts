import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { appendSystemLog } from "@/lib/logs/logger";

export interface JobOutputFile {
  filename: string;
  gdriveFileId: string;
  gdrivePath: string;
  previewUrl: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;
    const job = await prisma.job.findFirst({
      where: { id: jobId, userId: user.userId },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    if (job.status === "COMPLETED" || job.status === "FAILED") {
      return NextResponse.json({
        jobId: job.id,
        status: job.status,
        outputs: job.outputFiles ? (JSON.parse(job.outputFiles) as JobOutputFile[]) : [],
        errorMessage: job.errorMessage,
        executionTimeMs: job.executionTimeMs,
      });
    }

    if (!job.promptId) {
      return NextResponse.json({ jobId: job.id, status: job.status, outputs: [] });
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target: job.target } },
    });
    if (!vm || !vm.publicUrl || vm.status === "OFFLINE") {
      return NextResponse.json(
        { jobId: job.id, status: "FAILED", errorMessage: `Target VM ${job.target} went offline.` },
        { status: 200 }
      );
    }

    const client = new ComfyClient(vm);
    const check = await client.checkPromptHistory(job.promptId);

    if (check.error) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMessage: check.error, completedAt: new Date() },
      });
      return NextResponse.json({
        jobId: job.id,
        status: "FAILED",
        outputs: [],
        errorMessage: check.error,
      });
    }

    if (!check.finished || check.images.length === 0) {
      const queue = await client.getQueueSummary();
      return NextResponse.json({
        jobId: job.id,
        status: "PROCESSING",
        outputs: [],
        elapsedMs: Date.now() - job.createdAt.getTime(),
        queueRunning: queue.runningCount,
        queuePending: queue.pendingCount,
      });
    }

    // Sync generated outputs from /tmp/outputs to Google Drive via port 9999 sidecar
    const syncedOutputs: JobOutputFile[] = [];
    for (const img of check.images) {
      const synced = await client.syncOutputToGDrive(img.filename, img.subfolder);
      syncedOutputs.push({
        filename: img.filename,
        gdriveFileId: synced.gdriveFileId,
        gdrivePath: synced.gdrivePath,
        previewUrl: synced.gdriveFileId ? `/api/outputs/${synced.gdriveFileId}` : "",
      });
    }

    const executionTimeMs = Date.now() - job.createdAt.getTime();
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        outputFiles: JSON.stringify(syncedOutputs),
        executionTimeMs,
        completedAt: new Date(),
      },
    });

    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "COMFYUI",
      level: "SUCCESS",
      message: `Job ${job.id} completed on ${job.target} (${Math.round(executionTimeMs / 1000)}s) & synced ${syncedOutputs.length} file(s) to Google Drive.`,
    });

    return NextResponse.json({
      jobId: job.id,
      status: "COMPLETED",
      outputs: syncedOutputs,
      executionTimeMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to poll job status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

