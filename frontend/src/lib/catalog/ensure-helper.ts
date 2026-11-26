import { prisma } from "@/lib/db/prisma";
import { resolveAllModelDownloadSources } from "@/lib/catalog/source-resolver";
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

  const gdriveCred = await getUserGDriveCredential(userId).catch(() => null);
  const rcloneCategory = asset.subdir ? `${asset.category}/${asset.subdir}` : asset.category;

  if (preferSource !== "gdrive" && (asset.id || asset.hfRepoId || asset.civitaiModelId || asset.civitaiVersionId || asset.directUrl)) {
    const sources = await resolveAllModelDownloadSources(userId, asset);
    if (sources.length > 0) {
      const primary = sources[0];
      try {
        const shouldBackup = Boolean(asset.id && backupToGdrive && asset.backupStatus !== "BACKED_UP");
        const fetchRes = await VmGateway.callJson<{
          status: string;
          alreadyCached?: boolean;
          jobId?: string;
        }>(vm, "/fetch-url", {
          method: "POST",
          targetPort: vm.useRouteLess ? 9999 : vm.internalPort,
          body: JSON.stringify({
            url: primary.url,
            mirrors: sources.map((s) => ({
              url: s.url,
              authHeader: s.authHeader || "",
              expectedSizeBytes: s.expectedSizeBytes || 0,
              sha256: s.sha256 || "",
              sourceKind: s.sourceKind,
            })),
            allowGdriveFallback: Boolean(gdriveCred && preferSource !== "direct"),
            category: asset.category,
            subdir: asset.subdir,
            filename: asset.filename,
            expectedSizeBytes: primary.expectedSizeBytes || 0,
            sha256: primary.sha256 || "",
            authHeader: primary.authHeader || "",
            backupToGdrive: shouldBackup,
            assetSlug: asset.slug,
          }),
          timeoutMs: 15000,
        });

        if (fetchRes.alreadyCached) {
          return {
            status: "skipped",
            alreadyCached: true,
            source: primary.sourceKind,
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

        const sourceTrail = sources.map((s) => s.sourceKind.toUpperCase()).join(" -> ");
        await appendSystemLog({
          userId,
          vmInstanceId: vm.id,
          category: "RCLONE",
          level: "INFO",
          message: `Multi-mirror fetch [${sourceTrail}${gdriveCred && preferSource !== "direct" ? " -> GDRIVE" : ""}] started for ${asset.filename} -> ${vm.target}${shouldBackup ? " (+ 5TB Drive backup)" : ""}.`,
        });

        return {
          status: "started",
          transport: "sidecar-fetch",
          source: primary.sourceKind,
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

  if (!gdriveCred) {
    throw new Error("No direct download source succeeded and Google Drive credential is missing.");
  }

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
