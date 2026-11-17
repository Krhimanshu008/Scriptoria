// frontend/src/app/api/flow/extension/zip/route.ts
import { NextResponse } from "next/server";

const FASTAPI_BASE_URL =
  process.env.SCRIPTORIA_BACKEND_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

/**
 * GET /api/flow/extension/zip
 * Proxies the extension ZIP download from the FastAPI backend.
 */
export async function GET(): Promise<Response> {
  try {
    const upstreamRes = await fetch(
      `${FASTAPI_BASE_URL}/api/v1/flow-bridge/extension/download-zip`,
      {
        method: "GET",
        headers: { Accept: "application/zip" },
        cache: "no-store",
      }
    );

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      return NextResponse.json(
        { error: "Failed to download extension package", detail: errText },
        { status: upstreamRes.status }
      );
    }

    const zipBlob = await upstreamRes.arrayBuffer();
    return new Response(zipBlob, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="scriptoria-flow-companion.zip"',
        "Cache-Control": "no-cache",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "FastAPI server unreachable", detail: err?.message || String(err) },
      { status: 502 }
    );
  }
}
