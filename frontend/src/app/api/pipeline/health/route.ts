import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const bookId = req.nextUrl.searchParams.get("book_id") || undefined;
    const args = bookId ? [bookId] : [];
    const health = await runPipelineBridge("health", args, undefined, 10000);
    return NextResponse.json(health);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to fetch pipeline health" },
      { status: 500 }
    );
  }
}
