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
    const errorMessage = String(body.errorMessage || "Task execution failed");
    const retryEligible = body.retryEligible !== false;

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

    const maxAttempts = 3;
    const currentAttempts = task.attempts + 1;

    if (retryEligible && currentAttempts < maxAttempts) {
      // Re-queue task for another worker to attempt
      await prisma.batchTask.update({
        where: { id: taskId },
        data: {
          status: "PENDING",
          assignedTarget: null,
          attempts: currentAttempts,
          errorMessage: `Attempt ${currentAttempts} failed: ${errorMessage}`,
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({
        ok: true,
        requeued: true,
        attempts: currentAttempts,
        maxAttempts,
      });
    }

    // Permanently fail task
    await prisma.batchTask.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        assignedTarget: workerId,
        attempts: currentAttempts,
        errorMessage,
        updatedAt: new Date(),
      },
    });

    const updatedBatch = await prisma.batchJob.update({
      where: { id: task.batchId },
      data: {
        failedTasks: { increment: 1 },
      },
    });

    if (updatedBatch.completedTasks + updatedBatch.failedTasks >= updatedBatch.totalTasks) {
      await prisma.batchJob.update({
        where: { id: task.batchId },
        data: {
          status: updatedBatch.completedTasks > 0 ? "PARTIAL" : "FAILED",
          updatedAt: new Date(),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      requeued: false,
      status: "FAILED",
      errorMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record task failure";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

