import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getWorkerAuthContext } from "@/lib/auth/api-token";
import { getAuthUser } from "@/lib/auth/session";

const KIT_ROOTS: Record<string, string[]> = {
  ch214: [
    "Others/LOTM/outputs/faceless-volume-2/Faceless Reference Images",
    "Others/LOTM/outputs/faceless-volume-2/Reference Images",
  ],
};

function resolveKitRoot(kit: string): string | null {
  const candidates = KIT_ROOTS[kit];
  if (!candidates) return null;
  const cwd = process.cwd();
  const baseDirs = [cwd, path.resolve(cwd, ".."), path.resolve(cwd, "../..")];
  for (const base of baseDirs) {
    for (const rel of candidates) {
      const full = path.resolve(base, rel);
      if (fs.existsSync(/*turbopackIgnore: true*/ full) && fs.statSync(/*turbopackIgnore: true*/ full).isDirectory()) {
        return full;
      }
    }
  }
  return null;
}

/**
 * Authenticated binary asset stream allowing Kaggle GPU workers (tunneled or Safe Headless)
 * and dashboard previews to fetch reference plates (e.g. ref://ch214/Characters/KLEIN.png) once
 * and cache them inside ComfyUI/input/.
 */
export async function GET(req: NextRequest) {
  const workerAuth = await getWorkerAuthContext(req);
  const dashUser = workerAuth ? null : await getAuthUser(req);
  if (!workerAuth && !dashUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const kit = String(req.nextUrl.searchParams.get("kit") || "").trim();
  const relPath = String(req.nextUrl.searchParams.get("path") || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();

  if (!kit || !relPath || relPath.includes("..")) {
    return NextResponse.json({ error: "Invalid kit or path parameter." }, { status: 400 });
  }

  const root = resolveKitRoot(kit);
  if (!root) {
    return NextResponse.json({ error: `Reference kit '${kit}' is not available on disk.` }, { status: 404 });
  }

  const resolvedFile = path.resolve(root, relPath);
  const normalizedRoot = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolvedFile.startsWith(normalizedRoot)) {
    return NextResponse.json({ error: "Forbidden path traversal." }, { status: 403 });
  }

  if (!fs.existsSync(/*turbopackIgnore: true*/ resolvedFile) || !fs.statSync(/*turbopackIgnore: true*/ resolvedFile).isFile()) {
    return NextResponse.json({ error: `Reference image not found: ${relPath}` }, { status: 404 });
  }

  const ext = path.extname(resolvedFile).toLowerCase();
  const contentType =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".webp"
      ? "image/webp"
      : "image/png";

  const data = fs.readFileSync(/*turbopackIgnore: true*/ resolvedFile);
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
