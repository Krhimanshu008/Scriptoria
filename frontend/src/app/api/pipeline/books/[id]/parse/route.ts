import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const options = await req.json().catch(() => ({}));
    const optsStr = JSON.stringify(options);
    const result = await runPipelineBridge("parse_book", [id, optsStr], undefined, 60000);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to parse book" },
      { status: 500 }
    );
  }
}
