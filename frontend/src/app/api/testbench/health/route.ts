import { NextResponse, type NextRequest } from "next/server";

import { forwardToFastAPI } from "@/lib/bridge/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const upstreamRes = await forwardToFastAPI({
    req,
    method: "GET",
    upstreamPath: "/api/v1/testbench/health",
  });

  // If live FastAPI responds (e.g. 200 or custom 4xx), return directly
  if (upstreamRes.status < 500) {
    return upstreamRes;
  }

  // If FastAPI backend is unreachable, return informative offline status instead of crashing with raw 503
  const traceId = upstreamRes.headers.get("x-trace-id") || crypto.randomUUID();
  return NextResponse.json(
    {
      ok: false,
      status: "offline",
      service: "scriptoria-backend",
      version: "1.0.0",
      trace_id: traceId,
      message: "FastAPI backend is offline or unreachable on port 8000.",
      timestamp: new Date().toISOString(),
      dependencies: {
        sqlite_fts: {
          name: "sqlite_fts",
          status: "offline",
          latency_ms: 0,
          detail: "FastAPI engine offline (run uvicorn app.main:app --port 8000)",
        },
        vram_coordinator: {
          name: "vram_coordinator",
          status: "offline",
          latency_ms: 0,
          detail: "FastAPI engine offline (run uvicorn app.main:app --port 8000)",
        },
      },
    },
    {
      status: 200,
      headers: {
        "X-Trace-ID": traceId,
        "Cache-Control": "no-store",
      },
    }
  );
}
