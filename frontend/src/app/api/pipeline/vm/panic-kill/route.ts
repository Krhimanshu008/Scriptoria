import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const res = await runPipelineBridge("panic_kill", [], undefined, 10000);
    return NextResponse.json(res);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to dispatch panic kill" },
      { status: 500 }
    );
  }
}
