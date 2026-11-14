import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { suite } = await req.json().catch(() => ({ suite: undefined }));
    const args = suite ? [suite] : [];
    const result = await runPipelineBridge("run_tests", args, undefined, 60000);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to execute tests", passed: false },
      { status: 500 }
    );
  }
}
