import { NextResponse, type NextRequest } from "next/server";
import { forwardToFastAPI } from "@/lib/bridge/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("book_id") || "";
  const chapterIndex = url.searchParams.get("chapter_index") || "1";

  return forwardToFastAPI({
    req,
    method: "GET",
    upstreamPath: `/api/v1/storyboard/get?book_id=${encodeURIComponent(bookId)}&chapter_index=${encodeURIComponent(chapterIndex)}`,
    timeoutMs: 15_000,
  });
}
