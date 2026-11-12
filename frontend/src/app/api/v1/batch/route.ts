import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const batches = await prisma.batchJob.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        tasks: {
          orderBy: { sequenceIndex: "asc" },
          select: {
            id: true,
            sceneKey: true,
            trackType: true,
            workerProfile: true,
            baseCheckpoint: true,
            assignedTarget: true,
            status: true,
            outputFilesJson: true,
            errorMessage: true,
          },
        },
      },
    });

    return NextResponse.json({
      batches: batches.map((b) => ({
        id: b.id,
        title: b.title,
        sourceApp: b.sourceApp,
        status: b.status,
        totalTasks: b.totalTasks,
        completedTasks: b.completedTasks,
        failedTasks: b.failedTasks,
        strategy: b.strategyJson ? JSON.parse(b.strategyJson) : null,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
        tasks: b.tasks.map((t) => ({
          ...t,
          outputs: t.outputFilesJson ? JSON.parse(t.outputFilesJson) : [],
        })),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load batch jobs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Batch id required" }, { status: 400 });
    }
    await prisma.batchJob.deleteMany({
      where: { id, userId: auth.userId },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete batch";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

