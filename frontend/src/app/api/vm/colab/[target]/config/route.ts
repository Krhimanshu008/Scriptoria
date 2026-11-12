import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { saveUserCredential } from "@/lib/crypto/credentials";
import {
  extractGoogleDriveFileId,
  getOrCreateColabRunnerToken,
} from "@/lib/orchestrator/colab-runner";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ target: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { target } = await params;
    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm || vm.provider !== "colab") {
      return NextResponse.json({ error: "Colab target not found." }, { status: 404 });
    }

    const body = await req.json();
    const action = String(body.action || "");

    if (action === "rotate_key") {
      await getOrCreateColabRunnerToken(user.userId, vm.target, true);
      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "COLAB",
        level: "WARN",
        message: `Rotated Colab runner key for ${vm.target}; previous standalone notebooks invalidated.`,
      });
      return NextResponse.json({ ok: true, action });
    }

    if (action === "set_drive_file") {
      const rawInput = String(body.driveUrlOrId || "").trim();
      if (!rawInput) {
        await prisma.credential.deleteMany({
          where: { userId: user.userId, provider: "colab-meta", accountAlias: vm.target },
        });
        return NextResponse.json({ ok: true, driveFileId: null });
      }

      const fileId = extractGoogleDriveFileId(rawInput);
      if (!fileId) {
        return NextResponse.json(
          { error: "Could not extract a valid Google Drive File ID from that URL." },
          { status: 400 }
        );
      }

      await saveUserCredential(user.userId, {
        provider: "colab-meta",
        accountAlias: vm.target,
        username: vm.accountAlias,
        rawSecret: fileId,
        authType: "drive_file_id",
        metadata: {
          driveFileId: fileId,
          updatedAt: new Date().toISOString(),
        },
      });

      return NextResponse.json({ ok: true, driveFileId: fileId });
    }

    return NextResponse.json({ error: "Unsupported config action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update Colab config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

