import type { NextRequest, NextResponse } from "next/server";

import { forwardToFastAPI } from "@/lib/bridge/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    bookId: string;
  }>;
}

export async function GET(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { bookId } = await context.params;
  return forwardToFastAPI({
    req,
    method: "GET",
    upstreamPath: `/api/v1/rag/footprint/${encodeURIComponent(bookId)}`,
    timeoutMs: 15_000,
  });
}
