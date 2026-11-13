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
    const target = body.target ? String(body.target) : null;
    const status = String(body.status || "ONLINE");
    const vramUsedGb = typeof body.vramUsedGb === "number" ? body.vramUsedGb : null;
    const vramTotalGb = typeof body.vramTotalGb === "number" ? body.vramTotalGb : null;
    const gpuName = body.gpuName ? String(body.gpuName) : null;

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

