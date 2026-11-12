import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { resolveFastModelDownloadSource } from "@/lib/catalog/source-resolver";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import { GDriveModelStreamer } from "@/lib/orchestrator/rclone-client";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import { appendSystemLog } from "@/lib/logs/logger";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const target = String(body.target || "gpu0");
    const slug = body.slug ? String(body.slug).trim() : "";
    const modelId = body.modelId ? String(body.modelId).trim() : "";
    const backupToGdrive = body.backupToGdrive !== false;
    const preferSource = String(body.preferSource || "auto"); // "auto" | "direct" | "gdrive"

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({ error: `VM ${target} is not online.` }, { status: 400 });
    }

    const asset = await prisma.modelAsset.findFirst({
      where: {
        userId: user.userId,
        ...(modelId ? { id: modelId } : { slug }),
      },
    });
    if (!asset) {
      return NextResponse.json({ error: "Catalog model not found." }, { status: 404 });
    }

    // 1. Try fastest direct source (HuggingFace / Civitai / URL) via Sidecar /fetch-url
    if (preferSource !== "gdrive") {
      const source = await resolveFastModelDownloadSource(user.userId, asset);
      if (source) {
        try {
          const shouldBackup = backupToGdrive && asset.backupStatus !== "BACKED_UP";
          const fetchRes = await VmGateway.callJson<{
            status: string;
            alreadyCached?: boolean;
            jobId?: string;
            sizeBytes?: number;
          }>(vm, "/fetch-url", {
            method: "POST",
            targetPort: vm.useRouteLess ? 9999 : vm.internalPort,
            body: JSON.stringify({
              url: source.url,
              category: asset.category,
              subdir: asset.subdir,
              filename: asset.filename,
              expectedSizeBytes: source.expectedSizeBytes || 0,
              sha256: source.sha256 || "",
              authHeader: source.authHeader || "",
              backupToGdrive: shouldBackup,
              assetSlug: asset.slug,
            }),
            timeoutMs: 15000,
          });

          if (fetchRes.alreadyCached) {
            return NextResponse.json({
              status: "skipped",
              alreadyCached: true,
              source: source.sourceKind,
              file: asset.filename,
              category: asset.category,
              target,
            });
          }

          if (shouldBackup) {
            await prisma.modelAsset.update({
              where: { id: asset.id },
              data: { backupStatus: "BACKING_UP" },
            });
          }

          await appendSystemLog({
            userId: user.userId,
            vmInstanceId: vm.id,
            category: "RCLONE",
            level: "INFO",
            message: `Direct ${source.sourceKind.toUpperCase()} fetch started for ${asset.filename} -> ${target}${shouldBackup ? " (+ 5TB Drive backup)" : ""}.`,
          });

          return NextResponse.json({
            status: "started",
            transport: "sidecar-fetch",
            source: source.sourceKind,
            fetchJobId: fetchRes.jobId ?? null,
            file: asset.filename,
            category: asset.category,
            target,
          });
        } catch (directErr) {
          if (preferSource === "direct") {
            throw directErr;
          }
          // Fall back to Google Drive Rclone below if direct fetch failed
        }
      }
    }

    // 2. Fallback / Explicit Google Drive Rclone HTTP/1.1 streaming
    const gdriveCred = await getUserGDriveCredential(user.userId);
    if (!gdriveCred) {
      return NextResponse.json(
        { error: "No direct download source succeeded and Google Drive credential is missing." },
        { status: 400 }
      );
    }

    const rcloneCategory = asset.subdir ? `${asset.category}/${asset.subdir}` : asset.category;
    const res = await GDriveModelStreamer.startModelStream(
      vm,
      gdriveCred.baseFolder,
      rcloneCategory,
      asset.filename,
      { provider: vm.provider }
    );

    await appendSystemLog({
      userId: user.userId,
      vmInstanceId: vm.id,
      category: "RCLONE",
      level: "INFO",
      message: `Streaming ${asset.filename} from 5TB Google Drive -> ${target}.`,
    });

    return NextResponse.json({
      status: "started",
      transport: "rclone-gdrive",
      source: "gdrive",
      jobid: res.jobid ?? null,
      file: asset.filename,
      category: asset.category,
      target,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to ensure model on VM";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

