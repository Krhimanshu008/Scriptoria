import { prisma } from "@/lib/db/prisma";
import { prepareWorkerModel, fetchSessionKey } from "./worker-model";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
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
  sizeBytes?: number;
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

  await ensureDbSchemaReady();
  if (vm.status !== "ONLINE") {
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
      reviewedSha256: null,
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

  const hasDrive = Boolean(gdriveCred?.parsed.access_token || gdriveCred?.parsed.refresh_token);
  if (!vm.publicUrl) {
    const boot = JSON.parse(vm.bootMetadataJson || "{}");
    if (!vm.vmSecret || !boot.modelFetch || !vm.lastHeartbeat || Date.now() - vm.lastHeartbeat.getTime() > 120_000) {
      throw new Error("This headless worker is unavailable for model fetches. Start an updated worker.");
    }
    if (!asset.id) throw new Error("Add this file to the Models catalog first.");
    if (preferSource === "gdrive" && !hasDrive) throw new Error("Drive is disconnected.");
    const job = await prisma.modelFetch.create({ data: {
      vmId: vm.id, sessionKey: fetchSessionKey(vm.vmSecret), assetId: asset.id,
      sourceMode: preferSource, backup: backupToGdrive && hasDrive,
    } });
    return { status: "started", transport: "sidecar-fetch", source: "worker", fetchJobId: "worker-" + job.id,
      sizeBytes: asset.sizeBytes || undefined,
      file: asset.filename, category: asset.category, target: vm.target };
  }
  if (preferSource !== "gdrive" || vm.provider === "kaggle") {
    const request = await prepareWorkerModel(userId, vm.provider, asset, { hasDrive, sourceMode: preferSource, backup: backupToGdrive });
    const sources = request.mirrors;
    const primary = sources[0];
    try {
      const fetchRes = await VmGateway.callJson<{
        status: string; alreadyCached?: boolean; jobId?: string;
      }>(vm, "/fetch-url", {
        method: "POST", targetPort: vm.useRouteLess ? 9999 : vm.internalPort,
        body: JSON.stringify(request), timeoutMs: 15000,
      });

      if (fetchRes.alreadyCached) {
        return {
          status: "skipped",
          alreadyCached: true,
          source: primary?.sourceKind || "gdrive",
          file: asset.filename,
          category: asset.category,
          target: vm.target,
        };
      }

      const sourceTrail = sources.map((s) => s.sourceKind.toUpperCase()).join(" -> ");
      await appendSystemLog({
        userId,
        vmInstanceId: vm.id,
        category: "RCLONE",
        level: "INFO",
        message: `Multi-mirror fetch [${sourceTrail}${gdriveCred && preferSource !== "direct" ? " -> GDRIVE" : ""}] started for ${asset.filename} -> ${vm.target}${request.backupToGdrive ? " (+ 5TB Drive backup)" : ""}.`,
      });

      return {
        status: "started",
        transport: "sidecar-fetch",
        source: primary?.sourceKind || "gdrive",
        fetchJobId: fetchRes.jobId ?? null,
        sizeBytes: request.expectedSizeBytes || asset.sizeBytes || undefined,
        file: asset.filename,
        category: asset.category,
        target: vm.target,
      };
    } catch (directErr) {
      if (vm.provider === "kaggle" || preferSource === "direct" || !hasDrive) throw directErr;
    }
  }

  if (!hasDrive || !gdriveCred) {
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
