import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { query, max_narrative_seq = 9999, top_k = 5 } = await req.json();
    const data = await runPipelineBridge(
      "rag_hybrid_search",
      [id, query, String(max_narrative_seq), String(top_k)],
      undefined,
      15000
    );
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to execute hybrid search" },
      { status: 500 }
    );
  }
}
