import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { refreshAndPersistGDriveToken } from "@/lib/gdrive/client";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const provider = String(body.provider || "gdrive").trim().toLowerCase();
    const accountAlias = String(body.accountAlias || "default").trim();

    if (provider !== "gdrive") {
      return NextResponse.json(
        { error: "Token refresh is currently only supported for Google Drive (gdrive)." },
        { status: 400 }
      );
    }

    const refreshed = await refreshAndPersistGDriveToken(user.userId, accountAlias, {
      clientId: body.clientId ? String(body.clientId).trim() : undefined,
      clientSecret: body.clientSecret ? String(body.clientSecret).trim() : undefined,
      refreshToken: body.refreshToken ? String(body.refreshToken).trim() : undefined,
    });

    const detail = `${refreshed.email} · ${refreshed.used} / ${refreshed.limit} used · Base: ${refreshed.baseFolder}`;

    await appendSystemLog({
      userId: user.userId,
      category: "SYSTEM",
      level: "SUCCESS",
      message: `Refreshed Google Drive OAuth token for account '${accountAlias}' (${refreshed.email}).`,
    });

    return NextResponse.json({
      ok: true,
      detail,
      meta: {
        email: refreshed.email,
        used: refreshed.used,
        limit: refreshed.limit,
        baseFolder: refreshed.baseFolder,
        expiresAt: refreshed.expiresAt,
        refreshedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh token";
    return NextResponse.json({ ok: false, error: message, detail: message }, { status: 400 });
  }
}
