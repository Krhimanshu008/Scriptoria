import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { tickBatchScheduler } from "@/lib/batch/scheduler";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const { batchId } = await params;
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const action = String(body.action || "").trim().toLowerCase();

    if (!["pause", "resume", "retry_failed"].includes(action)) {
      return NextResponse.json(
        { error: "action must be one of: pause, resume, retry_failed." },
        { status: 400 }
      );
    }

    const batch = await prisma.batchJob.findFirst({
      where: { id: batchId, userId: auth.userId },
      include: { tasks: { orderBy: { sequenceIndex: "asc" } } },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch job not found." }, { status: 404 });
    }

    if (action === "pause") {
      const updated = await prisma.batchJob.update({
        where: { id: batch.id },
        data: { status: "PAUSED" },
      });
      await appendSystemLog({
        userId: auth.userId,
        category: "ACTION",
        level: "WARN",
        message: `Paused batch '${batch.title}' (${batch.id}).`,
      });
      return NextResponse.json({ ok: true, action, status: updated.status });
    }

    if (action === "retry_failed") {
      const resetRes = await prisma.batchTask.updateMany({
        where: {
          batchId: batch.id,
          status: { in: ["FAILED", "BLOCKED"] },
        },
        data: {
          status: "PENDING",
          assignedTarget: null,
          attempts: 0,
          errorMessage: null,
        },
      });
      await prisma.batchJob.update({
        where: { id: batch.id },
        data: {
          status: "QUEUED",
          failedTasks: 0,
        },
      });
      await appendSystemLog({
        userId: auth.userId,
        category: "ACTION",
        level: "INFO",
        message: `Re-queued ${resetRes.count} failed/blocked task(s) in batch '${batch.title}'.`,
      });
      return NextResponse.json({
        ok: true,
        action,
        requeuedCount: resetRes.count,
        status: "QUEUED",
      });
    }

    // action === "resume"
    const hasPending = batch.tasks.some((t) => t.status === "PENDING");
    const hasProcessing = batch.tasks.some((t) => t.status === "PROCESSING");
    const resumedStatus = hasProcessing ? "RUNNING" : hasPending ? "QUEUED" : "COMPLETED";
    await prisma.batchJob.update({
      where: { id: batch.id },
      data: { status: resumedStatus },
    });

    if (hasPending) {
      await tickBatchScheduler(auth.userId, batch.id).catch(() => null);
    }
    return NextResponse.json({ ok: true, action, status: resumedStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to control batch job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
