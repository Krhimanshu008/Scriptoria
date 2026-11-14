import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const graphKey = `compiled/${id}/book_graph.json`;
    const data = await runPipelineBridge("r2_get", [graphKey], undefined, 10000);
    return NextResponse.json(data.json || data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to fetch book graph" },
      { status: 500 }
    );
  }
}
