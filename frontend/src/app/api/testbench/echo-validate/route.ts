import { NextResponse, type NextRequest } from "next/server";

import { forwardToFastAPI } from "@/lib/bridge/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const clonedReq = req.clone();
  const upstreamRes = await forwardToFastAPI({
    req,
    method: "POST",
    upstreamPath: "/api/v1/testbench/echo-validate",
  });

  if (upstreamRes.status < 500) {
    return upstreamRes;
  }

  // Standalone UTF-16 / Unicode parity fallback if FastAPI is offline
  try {
    const body = await clonedReq.json();
    const text = typeof body?.text === "string" ? body.text : "";
    const codepointLength = Array.from(text).length;
    const utf16Length = text.length;
    const utf8ByteLength = new TextEncoder().encode(text).byteLength;
    const traceId = upstreamRes.headers.get("x-trace-id") || crypto.randomUUID();

    return NextResponse.json(
      {
        ok: true,
        trace_id: traceId,
        echoed_text: text,
        codepoint_length: codepointLength,
        utf16_length: utf16Length,
        utf8_byte_length: utf8ByteLength,
        full_span: {
          codepoint_start: 0,
          codepoint_end: codepointLength,
          utf16_start: 0,
          utf16_end: utf16Length,
        },
        probe_span: null,
        metadata: {
          engine: "nextjs_standalone_parity",
          fastapi_online: false,
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
  } catch {
    return upstreamRes;
  }
}
