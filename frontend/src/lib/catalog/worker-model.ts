import { createHash } from "node:crypto";
import type { ModelAsset } from "@prisma/client";
import { resolveAllModelDownloadSources } from "./source-resolver";

export function fetchSessionKey(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export async function prepareWorkerModel(
  userId: string,
  provider: string,
  asset: ModelAsset,
  options: { sourceMode?: string; hasDrive: boolean; backup?: boolean }
) {
  const kaggle = provider === "kaggle";
  const sourceMode = options.sourceMode || "auto";
  if (sourceMode === "gdrive" && !options.hasDrive) {
    throw new Error("This model request selected Drive, which is disconnected.");
  }
  const pin = (asset.reviewedSha256 || asset.sha256 || "").toLowerCase() || undefined;
  const allowGdriveFallback = options.hasDrive && sourceMode !== "direct";
  let sourceError = "";
  const sources =
    sourceMode === "gdrive"
      ? []
      : await resolveAllModelDownloadSources(userId, { ...asset, sha256: pin }).catch((error: Error) => {
          sourceError = error.message;
          return [];
        });
  const matchingMirrors = sources.filter((s) => !pin || !s.sha256 || s.sha256.toLowerCase() === pin);
  // On Kaggle prefer HuggingFace/Direct first, keeping SHA-256 verified Civitai as backup when HF/Drive fail
  const mirrors = kaggle
    ? [
        ...matchingMirrors.filter((s) => s.sourceKind !== "civitai"),
        ...matchingMirrors.filter((s) => s.sourceKind === "civitai" && Boolean(s.sha256)),
      ]
    : sources;
  return {
    assetSlug: asset.slug,
    filename: asset.filename,
    category: asset.category,
    subdir: asset.subdir,
    mirrors,
    sha256: pin || mirrors[0]?.sha256 || "",
    expectedSizeBytes: mirrors[0]?.expectedSizeBytes || asset.sizeBytes || 0,
    backupToGdrive: Boolean(options.backup && options.hasDrive && asset.backupStatus !== "BACKED_UP"),
    allowGdriveFallback,
    sourceError:
      sourceError ||
      (mirrors.length || allowGdriveFallback ? "" : "No eligible catalog source for " + asset.filename),
  };
}
