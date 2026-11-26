import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { ComfyClient } from "@/lib/orchestrator/comfy-client";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ target: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const { target } = await context.params;
    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: auth.userId, target } },
    });

    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json(
        { error: `GPU '${target}' is not ONLINE. Boot it in VM Cluster first.` },
        { status: 400 }
      );
    }

    const contentType = req.headers.get("content-type") || "";
    let bytes: Uint8Array;
    let filename = `ref_${Date.now()}.png`;
    let mimeType = "image/png";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") ?? form.get("image");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Expected 'file' field in multipart upload." }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "Image exceeds 20 MB limit." }, { status: 400 });
      }
      mimeType = file.type || "image/png";
      filename = file.name || filename;
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const body = (await req.json().catch(() => ({}))) as {
        dataUrl?: string;
        filename?: string;
      };
      if (!body.dataUrl || typeof body.dataUrl !== "string") {
        return NextResponse.json({ error: "Missing 'file' upload or 'dataUrl' payload." }, { status: 400 });
      }
      const m = body.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) {
        return NextResponse.json({ error: "Invalid base64 image dataUrl." }, { status: 400 });
      }
      mimeType = m[1];
      const buf = Buffer.from(m[2], "base64");
      if (buf.byteLength > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "Image exceeds 20 MB limit." }, { status: 400 });
      }
      bytes = buf;
      filename = body.filename || filename;
    }

    const client = new ComfyClient(vm);
    const uploaded = await client.uploadInputImage(bytes, filename, mimeType, true);
    const resolvedName = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;

    return NextResponse.json({
      ok: true,
      target,
      filename: resolvedName,
      rawName: uploaded.name,
      subfolder: uploaded.subfolder || "",
      type: uploaded.type || "input",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
