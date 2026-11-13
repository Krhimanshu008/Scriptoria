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
    const workerId = String(body.workerId || "unknown-worker");
    const rawCapabilities: unknown = body.capabilities;
    const capabilities: string[] = Array.isArray(rawCapabilities)
      ? rawCapabilities.map((c) => String(c))
      : [];

    const now = new Date();
    const leaseCutoff = new Date(now.getTime() - 5 * 60 * 1000); // 5-minute lease

    // 1. Lease Reaper: Reset stale processing tasks belonging to this user
    await prisma.batchTask.updateMany({
      where: {
        batch: { userId: auth.userId },
        status: "PROCESSING",
        updatedAt: { lt: leaseCutoff },
      },
      data: {
        status: "PENDING",
        assignedTarget: null,
      },
    });

    // 2. Find next pending task matching capabilities
    const whereClause: {
      batch: { userId: string; status: { in: string[] } };
      status: string;
      workerProfile?: { in: string[] };
    } = {
      batch: {
        userId: auth.userId,
        status: { in: ["QUEUED", "RUNNING"] },
      },
      status: "PENDING",
    };

    if (capabilities.length > 0) {
      whereClause.workerProfile = { in: capabilities };
    }

    const nextTask = await prisma.batchTask.findFirst({
      where: whereClause,
      orderBy: [{ sequenceIndex: "asc" }, { createdAt: "asc" }],
      include: {
        batch: {
          select: {
            id: true,
            title: true,
            sourceApp: true,
          },
        },
      },
    });

    if (!nextTask) {
      return NextResponse.json({
        task: null,
        message: "No queued tasks matching capabilities",
      });
    }

    // 3. Atomically assign task to worker
    const claimed = await prisma.batchTask.update({
      where: { id: nextTask.id },
      data: {
        status: "PROCESSING",
        assignedTarget: workerId,
        updatedAt: now,
      },
    });

    // Mark parent batch as RUNNING if it was QUEUED
    await prisma.batchJob.updateMany({
      where: {
        id: nextTask.batchId,
        status: "QUEUED",
      },
      data: {
        status: "RUNNING",
      },
    });

    let inputParams: Record<string, unknown> = {};
    if (claimed.inputParamsJson) {
      try {
        inputParams = JSON.parse(claimed.inputParamsJson);
      } catch {}
    }

    let compiledGraph: unknown = null;
    if (claimed.compiledGraphJson) {
      try {
        compiledGraph = JSON.parse(claimed.compiledGraphJson);
      } catch {}
    }

    return NextResponse.json({
      task: {
        id: claimed.id,
        batchId: claimed.batchId,
        batchTitle: nextTask.batch.title,
        sequenceIndex: claimed.sequenceIndex,
        sceneKey: claimed.sceneKey,
        trackType: claimed.trackType,
        workerProfile: claimed.workerProfile,
        workflowSlug: claimed.workflowSlug,
        baseCheckpoint: claimed.baseCheckpoint,
        inputParams,
        compiledGraph,
      },
      leaseSeconds: 300,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to claim task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

