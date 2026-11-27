import { prisma } from "@/lib/db/prisma";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";
import { appendSystemLog } from "@/lib/logs/logger";
import type { MediaArtifactV1, MediaJobResultV1 } from "@/types/media-contract";

export interface JobOutputFile {
  filename: string;
  gdriveFileId: string;
  gdrivePath: string;
  storageUri?: string;
  previewUrl: string;
}

export interface PolledJobStatusResult {
  httpStatus: number;
  jobId: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  target?: string;
  promptId?: string | null;
  outputs: JobOutputFile[];
  artifacts: MediaArtifactV1[];
  errorMessage?: string | null;
  executionTimeMs?: number | null;
  elapsedMs?: number;
  queueRunning?: number;
  queuePending?: number;
}

function outputsToArtifacts(outputs: JobOutputFile[]): MediaArtifactV1[] {
  return outputs.map((o) => {
    const ext = o.filename.split(".").pop()?.toLowerCase() || "";
    const modality: MediaArtifactV1["modality"] =
      ext === "mp3" || ext === "wav" || ext === "flac" || ext === "ogg"
        ? "AUDIO"
        : ext === "mp4" || ext === "webm" || ext === "gif"
        ? "VIDEO"
        : "IMAGE";
    return {
      modality,
      filename: o.filename,
      gdriveFileId: o.gdriveFileId || undefined,
      gdrivePath: o.gdrivePath || undefined,
      storageUri: o.storageUri || (o.gdrivePath ? `gdrive://${o.gdrivePath}` : undefined),
      previewUrl: o.previewUrl || (o.gdriveFileId ? `/api/outputs/${o.gdriveFileId}` : undefined),
    };
  });
}

export async function pollAndSyncWorkflowJob(
  userId: string,
  jobId: string
): Promise<PolledJobStatusResult | null> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId },
  });

  if (!job) return null;

  if (job.status === "COMPLETED" || job.status === "FAILED") {
    const outputs = job.outputFiles ? (JSON.parse(job.outputFiles) as JobOutputFile[]) : [];
    return {
      httpStatus: 200,
      jobId: job.id,
      status: job.status === "COMPLETED" ? "COMPLETED" : "FAILED",
      target: job.target,
      promptId: job.promptId,
      outputs,
      artifacts: outputsToArtifacts(outputs),
      errorMessage: job.errorMessage,
      executionTimeMs: job.executionTimeMs,
    };
  }

  if (!job.promptId) {
    return {
      httpStatus: 200,
      jobId: job.id,
      status: job.status === "QUEUED" ? "QUEUED" : "PROCESSING",
      target: job.target,
      promptId: null,
      outputs: [],
      artifacts: [],
      elapsedMs: Date.now() - job.createdAt.getTime(),
    };
  }

  const vm = await prisma.vmInstance.findUnique({
    where: { userId_target: { userId, target: job.target } },
  });
  if (!vm || !vm.publicUrl || vm.status === "OFFLINE") {
    return {
      httpStatus: 200,
      jobId: job.id,
      status: "FAILED",
      target: job.target,
      promptId: job.promptId,
      outputs: [],
      artifacts: [],
      errorMessage: `Target VM ${job.target} went offline.`,
    };
  }

  const client = new ComfyClient(vm);
  const check = await client.checkPromptHistory(job.promptId);

  if (check.error) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: check.error, completedAt: new Date() },
    });
    return {
      httpStatus: 200,
      jobId: job.id,
      status: "FAILED",
      target: job.target,
      promptId: job.promptId,
      outputs: [],
      artifacts: [],
      errorMessage: check.error,
    };
  }

  if (!check.finished || check.images.length === 0) {
    const queue = await client.getQueueSummary();
    return {
      httpStatus: 200,
      jobId: job.id,
      status: "PROCESSING",
      target: job.target,
      promptId: job.promptId,
      outputs: [],
      artifacts: [],
      elapsedMs: Date.now() - job.createdAt.getTime(),
      queueRunning: queue.runningCount,
      queuePending: queue.pendingCount,
    };
  }

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
    userId,
    vmInstanceId: vm.id,
    category: "COMFYUI",
    level: "SUCCESS",
    message: `Job ${job.id} completed on ${job.target} (${Math.round(executionTimeMs / 1000)}s) & synced ${syncedOutputs.length} file(s) to Google Drive.`,
  });

  return {
    httpStatus: 200,
    jobId: job.id,
    status: "COMPLETED",
    target: job.target,
    promptId: job.promptId,
    outputs: syncedOutputs,
    artifacts: outputsToArtifacts(syncedOutputs),
    executionTimeMs,
  };
}

export function toMediaJobResultV1(res: PolledJobStatusResult): MediaJobResultV1 {
  return {
    version: "1.0",
    jobId: res.jobId,
    status: res.status,
    target: res.target,
    promptId: res.promptId || undefined,
    executionTimeMs: res.executionTimeMs ?? undefined,
    elapsedMs: res.elapsedMs,
    queueRunning: res.queueRunning,
    queuePending: res.queuePending,
    artifacts: res.artifacts,
    error: res.errorMessage || undefined,
    statusUrl: `/api/v1/render/${encodeURIComponent(res.jobId)}`,
  };
}
