import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; idx: string }> }
) {
  try {
    const { id, idx } = await params;
    const body = await req.json().catch(() => ({}));
    const optionsJson = JSON.stringify(body);
    const data = await runPipelineBridge("extract_chapter", [id, idx, optionsJson], undefined, 30000);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to extract chapter" },
      { status: 500 }
    );
  }
}
