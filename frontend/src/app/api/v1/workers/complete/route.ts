import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getWorkerAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";

export async function POST(req: NextRequest) {
  try {
    const auth = await getWorkerAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = await req.json().catch(() => ({}));
    const taskId = String(body.taskId || "");
    const workerId = String(body.workerId || "unknown-worker");
    const rawOutputFiles = Array.isArray(body.outputFiles) ? body.outputFiles : [];
    const metrics: unknown = body.metrics || null;

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    // Normalize outputs so storage URIs / Drive IDs are preserved cleanly without bloating SQLite/Turso with multi-MB base64 blobs
    const normalizedOutputs = rawOutputFiles.map((item: unknown) => {
      if (!item || typeof item !== "object") return item;
      const obj = { ...(item as Record<string, unknown>) };
      const gdriveFileId = typeof obj.gdriveFileId === "string" ? obj.gdriveFileId : "";
      const storageUri = typeof obj.storageUri === "string" ? obj.storageUri : "";
      if (gdriveFileId && !obj.previewUrl) {
        obj.previewUrl = `/api/outputs/${encodeURIComponent(gdriveFileId)}`;
      }
      if ((gdriveFileId || storageUri || obj.previewUrl) && typeof obj.base64 === "string") {
        delete obj.base64;
      } else if (typeof obj.base64 === "string" && obj.base64.length > 262_144) {
        obj.base64Omitted = true;
        delete obj.base64;
      }
      return obj;
    });

    const task = await prisma.batchTask.findFirst({
      where: {
        id: taskId,
        batch: { userId: auth.userId },
      },
      include: {
        batch: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // 1. Update task to COMPLETED
    const updatedTask = await prisma.batchTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        assignedTarget: workerId,
        outputFilesJson: JSON.stringify(normalizedOutputs),
        errorMessage: null,
        updatedAt: new Date(),
      },
    });

    // If linked to an interactive Studio Job (headless mode), update Job row so UI polling resolves
    if (task.jobId) {
      await prisma.job
        .updateMany({
          where: { id: task.jobId, userId: auth.userId },
          data: {
            status: "COMPLETED",
            outputFiles: JSON.stringify(normalizedOutputs),
            errorMessage: null,
          },
        })
        .catch(() => null);
    }

    // 2. Increment completed count on parent batch
    const updatedBatch = await prisma.batchJob.update({
      where: { id: task.batchId },
      data: {
        completedTasks: { increment: 1 },
      },
    });

    // 3. If all tasks finished, mark batch COMPLETED
    if (updatedBatch.completedTasks + updatedBatch.failedTasks >= updatedBatch.totalTasks) {
      await prisma.batchJob.update({
        where: { id: task.batchId },
        data: {
          status: updatedBatch.failedTasks > 0 ? "PARTIAL" : "COMPLETED",
          updatedAt: new Date(),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      taskId: updatedTask.id,
      status: "COMPLETED",
      batchStatus: updatedBatch.status,
      metrics,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to complete task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

