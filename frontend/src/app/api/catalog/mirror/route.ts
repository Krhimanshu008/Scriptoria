import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser, signVmRegistrationToken } from "@/lib/auth/session";
import { getDecryptedCredential } from "@/lib/crypto/credentials";
import { generateVmSecret } from "@/lib/crypto/vault";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import { resolveFastModelDownloadSource } from "@/lib/catalog/source-resolver";
import {
  buildCpuMirrorNotebookPythonCode,
  type CpuMirrorModelItem,
} from "@/lib/orchestrator/notebook-builder";
import { KaggleOrchestrator } from "@/lib/orchestrator/kaggle-client";
import { resolveReachableWebhookBaseUrl } from "@/lib/orchestrator/webhook-tunnel";
import { appendSystemLog } from "@/lib/logs/logger";

/**
 * Triggers a zero-GPU-quota CPU Kaggle worker that pulls unbacked-up catalog models
 * from HuggingFace / Civitai and backs them up into the user's 5 TB Google Drive.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const accountAlias = String(body.accountAlias || "acc1");
    const slugs = Array.isArray(body.slugs) ? body.slugs.map(String) : null;
    const limit = Math.min(20, Math.max(1, Number(body.limit || 8)));

    const [gdriveCred, kaggleCred] = await Promise.all([
      getUserGDriveCredential(user.userId),
      getDecryptedCredential(user.userId, "kaggle", accountAlias),
    ]);

    if (!gdriveCred) {
      return NextResponse.json(
        { error: "Configure Google Drive in Settings Vault first." },
        { status: 400 }
      );
    }
    if (!kaggleCred?.username || !kaggleCred?.secret) {
      return NextResponse.json(
        { error: `Missing Kaggle credentials for '${accountAlias}' in Settings Vault.` },
        { status: 400 }
      );
    }

    const webhook = await resolveReachableWebhookBaseUrl(req);
    if (webhook.mode === "unreachable") {
      return NextResponse.json(
        { error: webhook.reason || "No reachable public callback URL found." },
        { status: 400 }
      );
    }

    const assets = await prisma.modelAsset.findMany({
      where: {
        userId: user.userId,
        ...(slugs?.length ? { slug: { in: slugs } } : { backupStatus: { not: "BACKED_UP" } }),
      },
      take: limit,
    });

    const mirrorModels: CpuMirrorModelItem[] = [];
    for (const asset of assets) {
      const resolved = await resolveFastModelDownloadSource(user.userId, asset);
      if (!resolved) continue;
      mirrorModels.push({
        slug: asset.slug,
        category: asset.category,
        subdir: asset.subdir,
        filename: asset.filename,
        url: resolved.url,
        authHeader: resolved.authHeader,
        expectedSizeBytes: resolved.expectedSizeBytes,
        sha256: resolved.sha256,
      });
    }

    if (mirrorModels.length === 0) {
      return NextResponse.json({
        ok: true,
        queuedCount: 0,
        message: "All matching catalog models with remote URLs are already backed up.",
      });
    }

    const registrationJwt = signVmRegistrationToken({
      userId: user.userId,
      sessionGroup: `cpu-mirror-${accountAlias}`,
      targets: ["cpu-mirror"],
      vmSecret: generateVmSecret(),
    });

    const pythonCode = buildCpuMirrorNotebookPythonCode({
      appWebhookUrl: webhook.url,
      registrationJwt,
      gdriveTokenJson: gdriveCred.rawTokenJson,
      gdriveBaseFolder: gdriveCred.baseFolder,
      models: mirrorModels,
    });

    const pushRes = await KaggleOrchestrator.pushKernel({
      credentials: {
        username: kaggleCred.username,
        key: kaggleCred.secret,
        authType: kaggleCred.authType === "bearer" ? "bearer" : "basic",
      },
      kernelSlug: "scriptoria-5tb-drive-mirror",
      pythonCode,
      enableGpu: false,
    });

    await appendSystemLog({
      userId: user.userId,
      category: "KAGGLE",
      level: "SUCCESS",
      message: `Queued 0-GPU-Quota CPU Mirror job (${accountAlias}) for ${mirrorModels.length} model(s) -> 5TB Drive.`,
    });

    return NextResponse.json({
      ok: true,
      queuedCount: mirrorModels.length,
      models: mirrorModels.map((m) => m.filename),
      kernelUrl: pushRes.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start CPU Drive mirror";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

