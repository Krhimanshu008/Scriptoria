import { createHash } from "node:crypto";
import type { ModelAsset } from "@prisma/client";
import { resolveAllModelDownloadSources } from "./source-resolver";

export function fetchSessionKey(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export async function prepareWorkerModel(
  userId: string, provider: string, asset: ModelAsset,
  options: { sourceMode?: string; hasDrive: boolean; backup?: boolean },
) {
  const kaggle = provider === "kaggle";
  const sourceMode = options.sourceMode || "auto";
  if (kaggle && !asset.reviewedSha256) {
    throw new Error("Review this file for Kaggle in the Models catalog before use.");
  }
  if (sourceMode === "gdrive" && !options.hasDrive) {
    throw new Error("This model request selected Drive, which is disconnected.");
  }
  const pin = kaggle ? asset.reviewedSha256 : asset.sha256;
  const allowGdriveFallback = options.hasDrive && sourceMode !== "direct";
  let sourceError = "";
  const sources = sourceMode === "gdrive" ? [] : await resolveAllModelDownloadSources(
    userId, { ...asset, sha256: pin },
  ).catch((error: Error) => { sourceError = error.message; return []; });
  const mirrors = kaggle ? sources.filter((s) => s.sha256 === pin && s.sourceKind !== "direct") : sources;
  return {
    assetSlug: asset.slug, filename: asset.filename, category: asset.category, subdir: asset.subdir,
    mirrors, sha256: pin || mirrors[0]?.sha256 || "", expectedSizeBytes: mirrors[0]?.expectedSizeBytes || 0,
    backupToGdrive: Boolean(options.backup && options.hasDrive && asset.backupStatus !== "BACKED_UP"),
    allowGdriveFallback, sourceError: sourceError || (mirrors.length ? "" : "No eligible catalog source for " + asset.filename),
  };
}
