import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = await req.json().catch(() => ({}));
    const taskId = String(body.taskId || "");
    const workerId = String(body.workerId || "unknown-worker");
    const outputFiles: unknown = body.outputFiles || [];
    const metrics: unknown = body.metrics || null;

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

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
        outputFilesJson: JSON.stringify(outputFiles),
        errorMessage: null,
        updatedAt: new Date(),
      },
    });

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

