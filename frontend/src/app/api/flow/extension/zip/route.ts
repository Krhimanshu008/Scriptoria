// frontend/src/app/api/flow/extension/zip/route.ts
import { NextResponse } from "next/server";
import { EMBEDDED_EXTENSION_ZIP_B64 } from "./bundle";

const FASTAPI_BASE_URL =
  process.env.SCRIPTORIA_FASTAPI_URL?.replace(/\/$/, "") ||
  process.env.SCRIPTORIA_BACKEND_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

function returnEmbeddedZip(): Response {
  const binaryString = atob(EMBEDDED_EXTENSION_ZIP_B64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="scriptoria-flow-companion.zip"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/**
 * GET /api/flow/extension/zip
 * Proxies the extension ZIP download from FastAPI with bulletproof embedded fallback.
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

    if (upstreamRes.ok) {
      const zipBlob = await upstreamRes.arrayBuffer();
      return new Response(zipBlob, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="scriptoria-flow-companion.zip"',
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
  } catch (_err) {
    // Upstream unreachable - fall back gracefully to embedded bundle
  }

  return returnEmbeddedZip();
}
