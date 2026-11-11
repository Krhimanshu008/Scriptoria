import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getUserGDriveCredential, listModelsInGDriveApi } from "@/lib/gdrive/client";
import { GDriveModelStreamer } from "@/lib/orchestrator/rclone-client";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const category = req.nextUrl.searchParams.get("category") || "checkpoints";
    const target = req.nextUrl.searchParams.get("target");

    const gdriveCred = await getUserGDriveCredential(user.userId);
    if (!gdriveCred) {
      return NextResponse.json(
        { error: "No Google Drive credential configured in Settings Vault." },
        { status: 400 }
      );
    }

    // Prefer direct Drive API if refresh credentials exist (works even when VMs are OFFLINE)
    try {
      const result = await listModelsInGDriveApi(user.userId, category);
      return NextResponse.json({ ...result, source: "gdrive-api" });
    } catch (apiErr) {
      // Fallback: if an active VM is online, query via Rclone RC (:5572)
      const vmWhere = target
        ? { userId: user.userId, target, status: "ONLINE" }
        : { userId: user.userId, status: "ONLINE" };
      const onlineVm = await prisma.vmInstance.findFirst({ where: vmWhere });
      if (onlineVm && onlineVm.publicUrl) {
        const files = await GDriveModelStreamer.listModelsInDriveViaVm(
          onlineVm,
          gdriveCred.baseFolder,
          category
        );
        return NextResponse.json({
          baseFolder: gdriveCred.baseFolder,
          category,
          files,
          source: `vm-rclone:${onlineVm.target}`,
        });
      }
      throw apiErr;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list Google Drive models";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

