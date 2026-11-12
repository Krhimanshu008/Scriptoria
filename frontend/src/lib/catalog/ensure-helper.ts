import { prisma } from "@/lib/db/prisma";
import { resolveFastModelDownloadSource } from "@/lib/catalog/source-resolver";
import { getUserGDriveCredential } from "@/lib/gdrive/client";
import { GDriveModelStreamer } from "@/lib/orchestrator/rclone-client";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import { appendSystemLog } from "@/lib/logs/logger";
import type { VmInstance } from "@prisma/client";

export interface EnsureModelResult {
  status: "skipped" | "started";
  transport?: "sidecar-fetch" | "rclone";
  source: string;
  alreadyCached?: boolean;
  fetchJobId?: string | null;
  rcloneJobId?: number | null;
  file: string;
  category: string;
  target: string;
}

/**
 * Shared programmatic model ensure helper:
 * 1) Checks /tmp/models via Sidecar `/fetch-url` (direct HF/Civitai aria2c + optional 5TB Drive backup)
 * 2) Falls back to Google Drive Rclone HTTP/1.1 streaming if direct URL unavailable/failed
 */
export async function ensureModelReadyOnVm(params: {
  userId: string;
  vm: VmInstance;
  slug?: string;
  modelId?: string;
  filename?: string;
  category?: string;
  backupToGdrive?: boolean;
  preferSource?: "auto" | "direct" | "gdrive";
}): Promise<EnsureModelResult> {
  const { userId, vm, slug, modelId, filename, category, backupToGdrive = true, preferSource = "auto" } =
    params;

  if (vm.status !== "ONLINE" || !vm.publicUrl) {
    throw new Error(`VM ${vm.target} is not online.`);
  }

  let asset = await prisma.modelAsset.findFirst({
    where: {
      userId,
      ...(modelId
        ? { id: modelId }
        : slug
        ? { slug }
        : filename
        ? { filename }
        : { id: "__none__" }),
    },
  });

  if (!asset && filename && category) {
    asset = {
      id: "",
      userId,
      slug: filename,
      displayName: filename,
      modality: "IMAGE",
      category,
      subdir: "",
      filename,
      sizeBytes: null,
      vramEstimateGb: 0,
      compatibleBase: "SDXL",
      requiredCustomNodesJson: null,
      recommendedConfigJson: null,
      hfRepoId: null,
      hfFilePath: null,
      civitaiModelId: null,
      civitaiVersionId: null,
      directUrl: null,
      sha256: null,
      gdrivePath: null,
      gdriveFileId: null,
      backupStatus: "BACKED_UP",
      isSeeded: false,
      lastVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  if (!asset) {
    throw new Error("Catalog model not found.");
  }

  if (preferSource !== "gdrive" && asset.id) {
    const source = await resolveFastModelDownloadSource(userId, asset);
    if (source) {
      try {
        const shouldBackup = backupToGdrive && asset.backupStatus !== "BACKED_UP";
        const fetchRes = await VmGateway.callJson<{
          status: string;
          alreadyCached?: boolean;
          jobId?: string;
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
          return {
            status: "skipped",
            alreadyCached: true,
            source: source.sourceKind,
            file: asset.filename,
            category: asset.category,
            target: vm.target,
          };
        }

        if (shouldBackup && asset.id) {
          await prisma.modelAsset.update({
            where: { id: asset.id },
            data: { backupStatus: "BACKING_UP" },
          });
        }

        await appendSystemLog({
          userId,
          vmInstanceId: vm.id,
          category: "RCLONE",
          level: "INFO",
          message: `Direct ${source.sourceKind.toUpperCase()} fetch started for ${asset.filename} -> ${vm.target}${shouldBackup ? " (+ 5TB Drive backup)" : ""}.`,
        });

        return {
          status: "started",
          transport: "sidecar-fetch",
          source: source.sourceKind,
          fetchJobId: fetchRes.jobId ?? null,
          file: asset.filename,
          category: asset.category,
          target: vm.target,
        };
      } catch (directErr) {
        if (preferSource === "direct") {
          throw directErr;
        }
      }
    }
  }

  const gdriveCred = await getUserGDriveCredential(userId);
  if (!gdriveCred) {
    throw new Error("No direct download source succeeded and Google Drive credential is missing.");
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
    userId,
    vmInstanceId: vm.id,
    category: "RCLONE",
    level: "INFO",
    message: `Drive fallback stream started for ${asset.filename} -> ${vm.target} (job=${res.jobid}).`,
  });

  return {
    status: "started",
    transport: "rclone",
    source: "gdrive",
    rcloneJobId: res.jobid ?? null,
    file: asset.filename,
    category: asset.category,
    target: vm.target,
  };
}
