import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; idx: string }> }
) {
  try {
    const { id, idx } = await params;
    const data = await runPipelineBridge("audit_chapter", [id, idx], undefined, 15000);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to audit chapter" },
      { status: 500 }
    );
  }
}
