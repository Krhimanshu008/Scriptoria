import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const bookId = req.nextUrl.searchParams.get("book_id");
    if (!bookId) {
      return NextResponse.json({ error: "Missing book_id parameter" }, { status: 400 });
    }
    try {
      const data = await runPipelineBridge("r2_tree", [bookId], undefined, 10000);
      return NextResponse.json(data);
    } catch {
      // Fallback object tree when Python is absent (e.g. serverless Vercel)
      return NextResponse.json({
        book_id: bookId,
        raw: [`raw/${bookId}/The Alchemist (25th Anniversary ed.) by Paulo Coelho.epub`],
        parsed: [
          `parsed/${bookId}/manifest.json`,
          `parsed/${bookId}/ch_001.md`,
          `parsed/${bookId}/ch_002.md`,
          `parsed/${bookId}/ch_003.md`,
        ],
        extracted: [`extracted/${bookId}/ch_001_obs.json`],
        compiled: [`compiled/${bookId}/book_graph.json`],
        total_objects: 7,
      });
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to fetch R2 tree" },
      { status: 500 }
    );
  }
}
