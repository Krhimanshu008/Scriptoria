import { NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function POST() {
  const t0 = Date.now();
  try {
    await prisma.vmInstance.findMany({ take: 1 });
    return NextResponse.json({
      success: true,
      latency_ms: Date.now() - t0,
      database: "turso-libsql",
      status: "ONLINE",
    });
  } catch (err: any) {
    try {
      const data = await runPipelineBridge("turso_ping", [], undefined, 10000);
      return NextResponse.json(data);
    } catch {
      return NextResponse.json(
        { success: false, error: err.message || "Failed to ping Turso" },
        { status: 200 }
      );
    }
  }
}
