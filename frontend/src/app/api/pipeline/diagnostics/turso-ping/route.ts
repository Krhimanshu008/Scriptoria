import { NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const data = await runPipelineBridge("turso_ping", [], undefined, 10000);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to ping Turso" },
      { status: 500 }
    );
  }
}
