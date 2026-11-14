import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const bookId = req.nextUrl.searchParams.get("book_id") || undefined;
    const args = bookId ? [bookId] : [];
    const health = await runPipelineBridge("health", args, undefined, 20000);
    return NextResponse.json(health);
  } catch (err: any) {
    return NextResponse.json(
      {
        r2: { connected: false, error: err.message },
        supabase: { connected: false, error: err.message },
        turso: { connected: false, error: err.message },
        vm_swarm: { online: false, error: err.message },
        error: err.message || "Failed to fetch pipeline health",
      },
      { status: 200 }
    );
  }
}
