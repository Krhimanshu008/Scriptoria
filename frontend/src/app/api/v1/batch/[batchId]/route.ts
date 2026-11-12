import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthContext } from "@/lib/auth/api-token";
import { tickBatchScheduler } from "@/lib/batch/scheduler";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { batchId } = await params;
    const shouldTick = req.nextUrl.searchParams.get("tick") !== "false";

    if (shouldTick) {
      const { batch, dispatched } = await tickBatchScheduler(auth.userId, batchId);
      return NextResponse.json({
        batch: {
          id: batch.id,
          title: batch.title,
          sourceApp: batch.sourceApp,
          status: batch.status,
          totalTasks: batch.totalTasks,
          completedTasks: batch.completedTasks,
          failedTasks: batch.failedTasks,
          strategy: batch.strategyJson ? JSON.parse(batch.strategyJson) : null,
          createdAt: batch.createdAt.toISOString(),
          updatedAt: batch.updatedAt.toISOString(),
          tasks: batch.tasks.map((t) => ({
            id: t.id,
            sceneKey: t.sceneKey,
            trackType: t.trackType,
            workerProfile: t.workerProfile,
            baseCheckpoint: t.baseCheckpoint,
            assignedTarget: t.assignedTarget,
            status: t.status,
            outputs: t.outputFilesJson ? JSON.parse(t.outputFilesJson) : [],
            errorMessage: t.errorMessage,
          })),
        },
        dispatched,
      });
    }

    const batch = await prisma.batchJob.findFirst({
      where: { id: batchId, userId: auth.userId },
      include: { tasks: { orderBy: { sequenceIndex: "asc" } } },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }

    return NextResponse.json({
      batch: {
        ...batch,
        strategy: batch.strategyJson ? JSON.parse(batch.strategyJson) : null,
        tasks: batch.tasks.map((t) => ({
          ...t,
          outputs: t.outputFilesJson ? JSON.parse(t.outputFilesJson) : [],
        })),
      },
      dispatched: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to advance batch";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

