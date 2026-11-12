import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getDecryptedCredential, saveUserCredential } from "@/lib/crypto/credentials";
import {
  getGoogleAccountEmail,
  getUserGDriveCredential,
  mintGDriveAccessToken,
  upsertColabNotebookInDrive,
  type GDriveTokenPayload,
} from "@/lib/gdrive/client";
import { getOrCreateColabRunnerToken } from "@/lib/orchestrator/colab-runner";
import { buildColabLauncherNotebookJson } from "@/lib/orchestrator/notebook-builder";
import { resolveWebhookBaseUrl } from "@/lib/orchestrator/vm-helpers";
import { appendSystemLog } from "@/lib/logs/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ target: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  const { target } = await params;
  const vm = await prisma.vmInstance.findUnique({
    where: { userId_target: { userId: user.userId, target } },
  });

  if (!vm || vm.provider !== "colab") {
    return NextResponse.json({ error: "Colab target not found." }, { status: 404 });
  }

  const modeJson = req.nextUrl.searchParams.get("mode") === "json";

  const [colabCred, metaCred, gdriveCred] = await Promise.all([
    getDecryptedCredential(user.userId, "colab", vm.accountAlias),
    getDecryptedCredential(user.userId, "colab-meta", vm.target),
    getUserGDriveCredential(user.userId),
  ]);

  const colabEmail = colabCred?.username || null;
  let existingFileId: string | null =
    metaCred?.secret ||
    (typeof colabCred?.metadata?.driveFileId === "string"
      ? colabCred.metadata.driveFileId
      : null);

  let driveAccessToken: string | null = null;
  let hasFullDriveScope = false;

  // Prefer the Colab Google account's own OAuth token if it authorized drive/drive.file scope
  if (colabCred?.secret) {
    try {
      const parsed = JSON.parse(colabCred.secret) as GDriveTokenPayload & { scope?: string };
      if (parsed.scope?.includes("drive") && (parsed.refresh_token || parsed.access_token)) {
        driveAccessToken = await mintGDriveAccessToken(parsed);
        hasFullDriveScope = parsed.scope
          .split(/\s+/)
          .includes("https://www.googleapis.com/auth/drive");
      }
    } catch {
      // ignore invalid colab oauth json
    }
  }

  // Fallback to main GDrive credential when account matches (e.g. acc1) or no conflicting secondary email
  if (!driveAccessToken && gdriveCred) {
    try {
      const mainToken = await mintGDriveAccessToken(gdriveCred.parsed);
      const ownerEmail = await getGoogleAccountEmail(mainToken);
      if (
        !colabEmail ||
        (ownerEmail && ownerEmail.toLowerCase() === colabEmail.toLowerCase())
      ) {
        driveAccessToken = mainToken;
        hasFullDriveScope = true;
      }
    } catch {
      // ignore if main gdrive token unavailable
    }
  }

  let synced = false;
  let syncError: string | null = null;

  if (driveAccessToken) {
    try {
      const appWebhookUrl = resolveWebhookBaseUrl(req);
      const runnerToken = await getOrCreateColabRunnerToken(user.userId, vm.target);
      const notebookJson = buildColabLauncherNotebookJson({
        appWebhookUrl,
        target: vm.target,
        runnerToken,
      });

      const baseFolderParts = (gdriveCred?.baseFolder || "Scriptoria")
        .split("/")
        .filter(Boolean);

      const upserted = await upsertColabNotebookInDrive({
        accessToken: driveAccessToken,
        filename: `scriptoria-${vm.target}-runner.ipynb`,
        notebookJson,
        existingFileId,
        folderSegments: hasFullDriveScope ? [...baseFolderParts, "notebooks"] : undefined,
        hasFullDriveScope,
      });

      existingFileId = upserted.fileId;
      synced = true;

      await saveUserCredential(user.userId, {
        provider: "colab-meta",
        accountAlias: vm.target,
        username: colabEmail || vm.target,
        rawSecret: existingFileId,
        authType: "drive_file_id",
        metadata: {
          driveFileId: existingFileId,
          syncedAt: new Date().toISOString(),
        },
      });

      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "COLAB",
        level: "SUCCESS",
        message: `${
          upserted.updated ? "Refreshed" : "Uploaded"
        } self-renewing Colab notebook (${existingFileId}) in Google Drive for ${vm.target}.`,
      });
    } catch (err) {
      syncError = err instanceof Error ? err.message : "Drive sync failed";
      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "COLAB",
        level: "WARN",
        message: `Skipped auto-sync for ${vm.target}: ${syncError}`,
      });
    }
  }

  const colabTargetUrl = existingFileId
    ? `https://colab.research.google.com/drive/${encodeURIComponent(existingFileId)}`
    : "https://colab.research.google.com/#create=true";

  const finalLaunchUrl = colabEmail
    ? `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(
        colabEmail
      )}&continue=${encodeURIComponent(colabTargetUrl)}`
    : colabTargetUrl;

  if (modeJson) {
    return NextResponse.json({
      url: finalLaunchUrl,
      fileId: existingFileId,
      synced,
      syncError,
    });
  }

  return NextResponse.redirect(finalLaunchUrl);
}
