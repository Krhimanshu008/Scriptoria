import { NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const data = await runPipelineBridge("r2_smoke", [], undefined, 15000);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to execute R2 smoke test" },
      { status: 500 }
    );
  }
}
