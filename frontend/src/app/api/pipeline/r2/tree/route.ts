import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const bookId = req.nextUrl.searchParams.get("book_id");
    if (!bookId) {
      return NextResponse.json({ error: "Missing book_id parameter" }, { status: 400 });
    }
    const data = await runPipelineBridge("r2_tree", [bookId], undefined, 10000);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to fetch R2 tree" },
      { status: 500 }
    );
  }
}
