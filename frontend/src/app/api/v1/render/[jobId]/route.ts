import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { pollAndSyncWorkflowJob, toMediaJobResultV1 } from "@/lib/workflow/job-status";
import type { MediaArtifactV1, MediaJobResultV1 } from "@/types/media-contract";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const { jobId } = await params;

    // 1. Check real-time Job table first
    const realtime = await pollAndSyncWorkflowJob(auth.userId, jobId);
    if (realtime) {
      return NextResponse.json(toMediaJobResultV1(realtime), { status: realtime.httpStatus });
    }

    // 2. Fallback: check pull-queue BatchTask ID (`mode: "queue"`)
    const task = await prisma.batchTask.findFirst({
      where: { id: jobId, batch: { userId: auth.userId } },
    });
    if (!task) {
      return NextResponse.json({ error: `Render job '${jobId}' not found.` }, { status: 404 });
    }

    let artifacts: MediaArtifactV1[] = [];
    if (task.outputFilesJson) {
      try {
        const parsed = JSON.parse(task.outputFilesJson) as Array<Record<string, unknown>>;
        if (Array.isArray(parsed)) {
          artifacts = parsed.map((o) => {
            const rawMod = String(o.modality || "IMAGE").toUpperCase();
            const modality: MediaArtifactV1["modality"] =
              rawMod === "AUDIO" || rawMod === "VIDEO" ? rawMod : "IMAGE";
            const gdriveFileId = typeof o.gdriveFileId === "string" ? o.gdriveFileId : undefined;
            const gdrivePath = typeof o.gdrivePath === "string" ? o.gdrivePath : undefined;
            return {
              modality,
              filename: String(o.filename || "output"),
              gdriveFileId,
              gdrivePath,
              storageUri:
                typeof o.storageUri === "string"
                  ? o.storageUri
                  : gdrivePath
                  ? `gdrive://${gdrivePath}`
                  : undefined,
              previewUrl:
                typeof o.previewUrl === "string"
                  ? o.previewUrl
                  : gdriveFileId
                  ? `/api/outputs/${encodeURIComponent(gdriveFileId)}`
                  : undefined,
              sizeBytes: typeof o.sizeBytes === "number" ? o.sizeBytes : undefined,
              sha256: typeof o.sha256 === "string" ? o.sha256 : undefined,
            };
          });
        }
      } catch {
        artifacts = [];
      }
    }

    const mappedStatus: MediaJobResultV1["status"] =
      task.status === "COMPLETED"
        ? "COMPLETED"
        : task.status === "FAILED"
        ? "FAILED"
        : task.status === "PROCESSING"
        ? "PROCESSING"
        : "QUEUED";

    const payload: MediaJobResultV1 = {
      version: "1.0",
      jobId: task.id,
      batchId: task.batchId,
      taskId: task.id,
      status: mappedStatus,
      target: task.assignedTarget || undefined,
      workerProfile: task.workerProfile,
      workflowSlug: task.workflowSlug || undefined,
      artifacts,
      error: task.errorMessage || undefined,
      statusUrl: `/api/v1/render/${encodeURIComponent(task.id)}`,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to inspect render status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
