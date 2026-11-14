import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { character_ids = [], tick = 1 } = await req.json();
    const data = await runPipelineBridge(
      "rag_timeline_state",
      [id, JSON.stringify(character_ids), String(tick)],
      undefined,
      15000
    );
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to query timeline state" },
      { status: 500 }
    );
  }
}
