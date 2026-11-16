import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const sUrl = process.env.SUPABASE_URL;
  const sKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  // Direct Supabase REST fetch for serverless/Vercel (no Python dependency)
  if (sUrl && sKey) {
    try {
      const res = await fetch(`${sUrl}/rest/v1/books_catalog?select=*&order=created_at.desc`, {
        headers: {
          apikey: sKey,
          Authorization: `Bearer ${sKey}`,
        },
        cache: "no-store",
      });
      if (res.ok) {
        const books = await res.json();
        return NextResponse.json({ books: Array.isArray(books) ? books : [] });
      }
    } catch (err) {
      console.warn("Direct Supabase fetch failed, trying pipeline bridge:", err);
    }
  }

  try {
    const data = await runPipelineBridge("books_list", [], undefined, 10000);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { books: [], error: err.message || "Failed to list books" },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string) || "Untitled Book";
    const author = (formData.get("author") as string) || "Unknown";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // 1. Forward directly to FastAPI backend service if available (Docker / multi-container stack)
    const fastApiUrl = process.env.SCRIPTORIA_FASTAPI_URL;
    if (fastApiUrl) {
      const uploadPayload = new FormData();
      uploadPayload.append("file", file, file.name);
      uploadPayload.append("title", title);
      uploadPayload.append("author", author);

      const upstreamRes = await fetch(`${fastApiUrl}/api/v1/bridge/upload-book`, {
        method: "POST",
        body: uploadPayload,
        signal: AbortSignal.timeout(60000),
      });

      if (upstreamRes.ok) {
        const data = await upstreamRes.json();
        return NextResponse.json(data);
      }
      const errData = await upstreamRes.json().catch(() => ({}));
      throw new Error(
        errData.detail || errData.error || `FastAPI book upload returned HTTP ${upstreamRes.status}`
      );
    }

    // 2. Local dev fallback using os.tmpdir() (safe on Windows, Linux, macOS with non-root permissions)
    const bookId = crypto.randomUUID();
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const tmpDir = path.join(os.tmpdir(), "scriptoria_uploads");
    await mkdir(tmpDir, { recursive: true });
    const localPath = path.join(tmpDir, `${bookId}_${file.name}`);
    await writeFile(localPath, buffer);

    // Upload via pipeline_bridge
    const res = await runPipelineBridge(
      "r2_upload_book",
      [localPath, title, author],
      undefined,
      30000
    );

    return NextResponse.json(res);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to upload book" },
      { status: 500 }
    );
  }
}
