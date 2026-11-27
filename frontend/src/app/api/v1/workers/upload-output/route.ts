import { NextRequest, NextResponse } from "next/server";
import { getWorkerAuthContext } from "@/lib/auth/api-token";
import { saveLocalOutputFile } from "@/lib/orchestrator/local-vault";

const MAX_LOCAL_OUTPUT_BYTES = 50 * 1024 * 1024;

/**
 * Fallback full-resolution output persistence for workers when Google Drive is unavailable.
 * Stores artifacts in the persistent `/app/data/outputs` volume scoped by authenticated `userId`.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getWorkerAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workerId = req.headers.get("x-worker-id")?.trim() || "";
    if (auth.worker && workerId && !auth.worker.targets.includes(workerId)) {
      return NextResponse.json({ error: "Target outside worker session." }, { status: 403 });
    }

    const rawHeaderName = req.headers.get("x-filename") || "output.png";
    let filename = "output.png";
    try {
      filename = decodeURIComponent(rawHeaderName);
    } catch {
      filename = rawHeaderName;
    }

    const arrayBuf = await req.arrayBuffer();
    if (!arrayBuf || arrayBuf.byteLength === 0) {
      return NextResponse.json({ error: "Empty output payload." }, { status: 400 });
    }
    if (arrayBuf.byteLength > MAX_LOCAL_OUTPUT_BYTES) {
      return NextResponse.json({ error: "Output exceeds 50 MB Local Vault limit." }, { status: 413 });
    }

    const saved = await saveLocalOutputFile(auth.userId, filename, Buffer.from(arrayBuf));
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to persist local output backup";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
