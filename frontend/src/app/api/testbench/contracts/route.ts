import { NextResponse, type NextRequest } from "next/server";

import { forwardToFastAPI } from "@/lib/bridge/server-client";
import { EXPECTED_CONTRACT_HASH } from "@/types/testbench-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const upstreamRes = await forwardToFastAPI({
    req,
    method: "GET",
    upstreamPath: "/api/v1/testbench/contracts",
  });

  // If live FastAPI responds successfully, return its manifest
  if (upstreamRes.status < 500) {
    return upstreamRes;
  }

  // Graceful standalone fallback when FastAPI backend is offline (e.g. serverless Vercel preview)
  const traceId = upstreamRes.headers.get("x-trace-id") || crypto.randomUUID();
  return NextResponse.json(
    {
      ok: true,
      contract_hash: EXPECTED_CONTRACT_HASH,
      schema_version: "1.0.0",
      openapi_version: "3.1.0",
      trace_id: traceId,
      source: "nextjs_canonical_manifest",
      limits: {
        max_payload_bytes: 10_485_760,
        max_text_chars: 2_000_000,
        max_chapters_per_document: 1_000,
        request_timeout_ms: 30_000,
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
