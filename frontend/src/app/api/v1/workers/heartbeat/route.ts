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
    const workerId = String(body.workerId || "unknown-worker");
    const explicitTarget = body.target ? String(body.target).trim() : "";
    const inferredMatch = workerId.match(/(?:^|[-_])(gpu\d+|gcgpu\d*|tpu\d+)(?:$|[-_])/i);
    const target = explicitTarget || (inferredMatch ? inferredMatch[1].toLowerCase() : null);
    const status = String(body.status || "ONLINE");
    const vramUsedGb = typeof body.vramUsedGb === "number" ? body.vramUsedGb : null;
    const vramTotalGb = typeof body.vramTotalGb === "number" ? body.vramTotalGb : null;
    const gpuName = body.gpuName ? String(body.gpuName) : null;

    if (auth.worker && (!auth.worker.targets.includes(workerId) || (target && !auth.worker.targets.includes(target)))) {
      return NextResponse.json({ error: "Target outside worker session." }, { status: 403 });
    }
    if (typeof body.taskId === "string" && body.taskId) {
      const renewed = await prisma.batchTask.updateMany({
        where: { id: body.taskId, batch: { userId: auth.userId }, status: "PROCESSING", assignedTarget: workerId },
        data: { updatedAt: new Date() },
      });
      return NextResponse.json({ ok: renewed.count === 1 }, { status: renewed.count ? 200 : 409 });
    }
    if (target) {
      await prisma.vmInstance.updateMany({
        where: {
          userId: auth.userId,
          target,
        },
        data: {
          status,
          vramUsedGb: vramUsedGb ?? undefined,
          vramTotalGb: vramTotalGb ?? undefined,
          gpuName: gpuName ?? undefined,
          lastHeartbeat: new Date(),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      workerId,
      timestamp: Date.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Heartbeat error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

