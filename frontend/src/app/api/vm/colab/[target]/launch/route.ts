import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { getDecryptedCredential, saveUserCredential } from "@/lib/crypto/credentials";
import {
  getGoogleAccountEmail,
  getUserGDriveCredential,
  mintGDriveAccessToken,
  shareDriveFileWithUser,
  upsertColabNotebookInDrive,
  type GDriveTokenPayload,
} from "@/lib/gdrive/client";
import { getOrCreateColabRunnerToken } from "@/lib/orchestrator/colab-runner";
import { buildColabLauncherNotebookJson } from "@/lib/orchestrator/notebook-builder";
import { resolveReachableWebhookBaseUrl } from "@/lib/orchestrator/webhook-tunnel";
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
  const webhook = await resolveReachableWebhookBaseUrl(req);

  if (webhook.mode === "unreachable") {
    const reason = webhook.reason || "No reachable public callback URL found for Colab.";
    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "ERROR",
      level: "ERROR",
      message: `Colab launch blocked (${vm.target}): ${reason}`,
    });
    if (modeJson) {
      return NextResponse.json(
        { error: reason, url: null, fileId: null, synced: false, syncError: reason },
        { status: 400 }
      );
    }
    return NextResponse.redirect(
      new URL(`/?colabError=${encodeURIComponent(reason)}`, req.nextUrl.origin)
    );
  }

  const [colabCred, metaCred, gdriveCred] = await Promise.all([
    getDecryptedCredential(user.userId, "colab", vm.accountAlias),
    getDecryptedCredential(user.userId, "colab-meta", vm.target),
    getUserGDriveCredential(user.userId),
  ]);

  const colabEmail = colabCred?.username?.trim() || null;
  const metaObj = (metaCred?.metadata || {}) as {
    driveFileId?: string;
    ownerEmail?: string;
    sharedWithEmail?: string;
    manualBind?: boolean;
  };

  let existingFileId: string | null =
    metaCred?.secret ||
    (typeof metaObj.driveFileId === "string" ? metaObj.driveFileId : null) ||
    (typeof colabCred?.metadata?.driveFileId === "string"
      ? String(colabCred.metadata.driveFileId)
      : null);

  // Invalidate non-manual fileId if it belongs to a different unshared Google account
  if (existingFileId && !metaObj.manualBind && colabEmail) {
    const emailLower = colabEmail.toLowerCase();
    const metaOwner = typeof metaObj.ownerEmail === "string" ? metaObj.ownerEmail.toLowerCase() : null;
    const metaShared =
      typeof metaObj.sharedWithEmail === "string" ? metaObj.sharedWithEmail.toLowerCase() : null;
    if ((metaOwner || metaShared) && metaOwner !== emailLower && metaShared !== emailLower) {
      existingFileId = null;
    } else if (!metaOwner && !metaShared && vm.accountAlias === "acc2") {
      // Legacy acc2 fileId created without ownership tracking may belong privately to acc1
      existingFileId = null;
    }
  }

  let driveAccessToken: string | null = null;
  let hasFullDriveScope = false;
  let syncMode: "owner" | "shared" = "owner";
  let driveOwnerEmail: string | null = colabEmail;

  // 1. Prefer the Colab Google account's own OAuth token if it authorized drive/drive.file scope
  if (colabCred?.secret) {
    try {
      const parsed = JSON.parse(colabCred.secret) as GDriveTokenPayload & { scope?: string };
      if (parsed.scope?.includes("drive") && (parsed.refresh_token || parsed.access_token)) {
        driveAccessToken = await mintGDriveAccessToken(parsed);
        hasFullDriveScope = parsed.scope
          .split(/\s+/)
          .includes("https://www.googleapis.com/auth/drive");
        syncMode = "owner";
        driveOwnerEmail = colabEmail;
      }
    } catch {
      // ignore non-JSON manual links or invalid OAuth payload
    }
  }

  // 2. Fallback to main Vault GDrive credential (owns for acc1, ACL-shares writer access for acc2)
  if (!driveAccessToken && gdriveCred) {
    try {
      const mainToken = await mintGDriveAccessToken(gdriveCred.parsed);
      const ownerEmail = await getGoogleAccountEmail(mainToken);
      driveAccessToken = mainToken;
      hasFullDriveScope = true;
      driveOwnerEmail = ownerEmail;
      syncMode =
        !colabEmail || (ownerEmail && ownerEmail.toLowerCase() === colabEmail.toLowerCase())
          ? "owner"
          : "shared";
    } catch {
      // ignore if main gdrive token unavailable
    }
  }

  let synced = false;
  let syncError: string | null = null;

  if (driveAccessToken) {
    try {
      const runnerToken = await getOrCreateColabRunnerToken(user.userId, vm.target);
      const notebookJson = buildColabLauncherNotebookJson({
        appWebhookUrl: webhook.url,
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

      if (syncMode === "shared" && colabEmail) {
        await shareDriveFileWithUser(driveAccessToken, existingFileId, colabEmail);
      }

      synced = true;

      await saveUserCredential(user.userId, {
        provider: "colab-meta",
        accountAlias: vm.target,
        username: colabEmail || vm.target,
        rawSecret: existingFileId,
        authType: "drive_file_id",
        metadata: {
          driveFileId: existingFileId,
          ownerEmail: driveOwnerEmail,
          sharedWithEmail: syncMode === "shared" ? colabEmail : null,
          syncMode,
          manualBind: Boolean(metaObj.manualBind),
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
        } self-renewing Colab notebook (${existingFileId}) for ${vm.target} (${
          syncMode === "shared" && colabEmail ? `shared with ${colabEmail}` : "owner Drive"
        }, callback=${webhook.mode}).`,
      });
    } catch (err) {
      syncError = err instanceof Error ? err.message : "Drive sync failed";
      // Never reuse an unshared existingFileId if ACL sharing failed for a secondary account
      if (syncMode === "shared" && !metaObj.manualBind) {
        existingFileId = null;
      }
      await appendSystemLog({
        userId: user.userId,
        vmInstanceId: vm.id,
        category: "COLAB",
        level: "WARN",
        message: `Auto-sync skipped for ${vm.target}: ${syncError}`,
      });
    }
  } else {
    syncError = "Google Drive credential in Vault is required to auto-sync Colab notebooks.";
  }

  if (!existingFileId) {
    const errMsg =
      syncError || `Could not prepare ${vm.target} notebook in Drive. Download .ipynb from Setup.`;
    if (modeJson) {
      return NextResponse.json(
        { error: errMsg, url: null, fileId: null, synced: false, syncError: errMsg },
        { status: 400 }
      );
    }
    return NextResponse.redirect(
      new URL(`/?colabError=${encodeURIComponent(errMsg)}`, req.nextUrl.origin)
    );
  }

  const colabTarget = new URL(
    `https://colab.research.google.com/drive/${encodeURIComponent(existingFileId)}`
  );
  if (colabEmail) {
    colabTarget.searchParams.set("authuser", colabEmail);
  }

  const finalLaunchUrl = colabEmail
    ? `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(
        colabEmail
      )}&continue=${encodeURIComponent(colabTarget.toString())}`
    : colabTarget.toString();

  if (modeJson) {
    return NextResponse.json({
      url: finalLaunchUrl,
      fileId: existingFileId,
      synced,
      syncMode,
      webhookUrl: webhook.url,
      webhookMode: webhook.mode,
      syncError,
    });
  }

  return NextResponse.redirect(finalLaunchUrl);
}
