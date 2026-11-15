import type { NextRequest, NextResponse } from "next/server";

import { forwardToFastAPI } from "@/lib/bridge/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  return forwardToFastAPI({
    req,
    method: "POST",
    upstreamPath: "/api/v1/scorecard/e2e-run",
    timeoutMs: 60_000,
  });
}
