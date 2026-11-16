import { NextResponse, type NextRequest } from "next/server";
import { forwardToFastAPI } from "@/lib/bridge/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  return forwardToFastAPI({
    req,
    method: "POST",
    upstreamPath: "/api/v1/storyboard/audio/upload",
  });
}
