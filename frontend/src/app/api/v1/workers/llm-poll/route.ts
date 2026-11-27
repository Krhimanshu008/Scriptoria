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
    const workerId = String(body.workerId || auth.worker?.targets?.[0] || "unknown-worker");
    if (auth.worker && !auth.worker.targets.includes(workerId)) {
      return NextResponse.json({ error: "Target outside worker session." }, { status: 403 });
    }

    const now = new Date();
    const staleCutoff = new Date(now.getTime() - 90_000);

    // Reap stalled LLM relay requests > 90s
    await prisma.llmRelayRequest.updateMany({
      where: {
        userId: auth.userId,
        status: "PROCESSING",
        updatedAt: { lt: staleCutoff },
      },
      data: { status: "PENDING", assignedTarget: null },
    });

    const allowedTargets = auth.worker?.targets?.length ? auth.worker.targets : [workerId];
    const candidates = await prisma.llmRelayRequest.findMany({
      where: {
        userId: auth.userId,
        status: "PENDING",
        OR: [{ targetVm: null }, { targetVm: { in: allowedTargets } }],
      },
      orderBy: { createdAt: "asc" },
      take: 5,
    });

    for (const c of candidates) {
      const claim = await prisma.llmRelayRequest.updateMany({
        where: { id: c.id, status: "PENDING" },
        data: { status: "PROCESSING", assignedTarget: workerId, updatedAt: now },
      });
      if (claim.count > 0) {
        let requestPayload: Record<string, unknown> = {};
        try {
          requestPayload = JSON.parse(c.requestPayloadJson);
        } catch {}
        return NextResponse.json({
          request: {
            id: c.id,
            targetService: c.targetService,
            requestPayload,
          },
        });
      }
    }

    return NextResponse.json({ request: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to poll LLM relay";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
