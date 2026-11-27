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
    const requestId = String(body.requestId || "");
    const workerId = String(body.workerId || "unknown-worker");
    const responseJson =
      body.response && typeof body.response === "object"
        ? JSON.stringify(body.response)
        : typeof body.responseJson === "string"
        ? body.responseJson
        : null;
    const errorMessage = body.errorMessage ? String(body.errorMessage) : null;
    const latencyMs =
      typeof body.latencyMs === "number" && Number.isFinite(body.latencyMs)
        ? Math.max(0, Math.round(body.latencyMs))
        : null;

    if (!requestId) {
      return NextResponse.json({ error: "requestId is required" }, { status: 400 });
    }

    const updated = await prisma.llmRelayRequest.updateMany({
      where: {
        id: requestId,
        userId: auth.userId,
        assignedTarget: workerId,
        status: "PROCESSING",
      },
      data: {
        status: errorMessage ? "FAILED" : "COMPLETED",
        responseJson,
        errorMessage,
        latencyMs,
        updatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Relay request not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to complete LLM relay";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
