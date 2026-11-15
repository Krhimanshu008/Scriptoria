import type { NextRequest, NextResponse } from "next/server";

import { forwardToFastAPI } from "@/lib/bridge/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{
    bookId: string;
  }>;
}

export async function GET(
  req: NextRequest,
  props: RouteParams
): Promise<NextResponse> {
  const { bookId } = await props.params;
  return forwardToFastAPI({
    req,
    method: "GET",
    upstreamPath: `/api/v1/compiler/characters/${encodeURIComponent(bookId)}`,
  });
}
