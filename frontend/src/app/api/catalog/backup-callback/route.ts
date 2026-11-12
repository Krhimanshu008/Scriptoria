import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import { verifyVmRegistrationToken } from "@/lib/auth/session";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = String(body.token || "");
    const payload = verifyVmRegistrationToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid VM token" }, { status: 401 });
    }

    await ensureDbSchemaReady();

    const slug = String(body.slug || "").trim();
    const status = String(body.status || "BACKED_UP").toUpperCase();
    const gdrivePath = body.gdrivePath ? String(body.gdrivePath) : null;
    const gdriveFileId = body.gdriveFileId ? String(body.gdriveFileId) : null;
    const sizeBytes = body.sizeBytes != null ? Number(body.sizeBytes) : undefined;
    const errorMsg = body.error ? String(body.error) : null;

    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    await prisma.modelAsset.updateMany({
      where: { userId: payload.userId, slug },
      data: {
        backupStatus: status,
        ...(gdrivePath ? { gdrivePath } : {}),
        ...(gdriveFileId ? { gdriveFileId } : {}),
        ...(sizeBytes && sizeBytes > 0 ? { sizeBytes } : {}),
        lastVerifiedAt: status === "BACKED_UP" ? new Date() : undefined,
      },
    });

    await appendSystemLog({
      userId: payload.userId,
      category: "RCLONE",
      level: status === "BACKED_UP" ? "SUCCESS" : status === "FAILED" ? "WARN" : "INFO",
      message:
        status === "BACKED_UP"
          ? `5TB Drive backup verified for '${slug}' -> ${gdrivePath || "Drive"}.`
          : `Drive backup status for '${slug}': ${status}${errorMsg ? ` (${errorMsg})` : ""}`,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Callback error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

